"""Forward an official CLI's interactive login through a private terminal."""
import fcntl
import os
import pty
import selectors
import signal
import struct
import subprocess
import sys
import termios

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 120, 0, 0))


def session():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)


child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, preexec_fn=session)
os.close(slave)


def stop(signum, frame):
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
selector = selectors.DefaultSelector()
selector.register(master, selectors.EVENT_READ)
selector.register(sys.stdin.fileno(), selectors.EVENT_READ)
buffer = b""
selected = False
try:
    while child.poll() is None:
        for key, _ in selector.select(0.5):
            if key.fd == master:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)
                buffer = (buffer + data)[-32000:]
                if b"\x1b[>c" in data:
                    os.write(master, b"\x1b[>0;0;0c")
                if b"\x1b[6n" in data:
                    os.write(master, b"\x1b[1;1R")
                if not selected and b"Google OAuth" in buffer:
                    os.write(master, b"\r")
                    selected = True
            else:
                data = os.read(sys.stdin.fileno(), 8192)
                if data:
                    os.write(master, data.replace(b"\n", b"\r"))
                else:
                    selector.unregister(sys.stdin.fileno())
finally:
    stop(None, None)
    try:
        child.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    os.close(master)
sys.exit(child.returncode if child.returncode is not None and child.returncode >= 0 else 1)
