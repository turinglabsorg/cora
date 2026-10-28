import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { posix } from "node:path";

const OUTPUT_LIMIT = 24000;

export function runProcess(command, args, { input, timeoutMs = 60000, maxBytes = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let timedOut = false;
    let truncated = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) stdout.push(chunk);
      else truncated = true;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: error.message, timedOut, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8"), timedOut, truncated });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function clip(text, limit = OUTPUT_LIMIT) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.6);
  return `${value.slice(0, head)}\n…[${value.length - limit} caratteri tagliati]…\n${value.slice(-(limit - head))}`;
}

const KEY_LINE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]{20,}( [^\r\n]{0,200})?$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Plain public keys only: lines with options (from=, command=, restrict…) are left out. */
export function plainKeys(text) {
  return [...new Set(String(text || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => KEY_LINE.test(line)))];
}

export function slug(name) {
  return String(name).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "box";
}

export class Boxes {
  /** `access(agent)` gives the box's SSH port on the host and the public keys allowed in. */
  constructor({ docker, image, timezone, access = () => ({}) }) {
    this.docker = docker;
    this.image = image;
    this.timezone = timezone;
    this.access = access;
    this.pending = new Map();
    this.imageCache = { at: 0, id: null };
  }

  name(agentId) { return `cora-box-${agentId}`; }

  volume(agentId) { return `cora-home-${agentId}`; }

  /** Tailscale state and SSH host keys: they survive upgrades like the home does. */
  sysVolume(agentId) { return `cora-sys-${agentId}`; }

  async imageId() {
    if (Date.now() - this.imageCache.at < 15000) return this.imageCache.id;
    const result = await runProcess(this.docker, ["image", "inspect", this.image, "--format", "{{.Id}}"], { timeoutMs: 20000 });
    const id = result.code === 0 ? result.stdout.toString("utf8").trim() : null;
    this.imageCache = { at: Date.now(), id };
    return id;
  }

  async imageExists() {
    return Boolean(await this.imageId());
  }

  async inspect(agentId) {
    const result = await runProcess(this.docker, [
      "inspect", this.name(agentId), "--format", "{{json .State}}\t{{json .NetworkSettings.Ports}}\t{{.Image}}\t{{range .Mounts}}{{.Destination}},{{end}}",
    ], { timeoutMs: 20000 });
    if (result.code !== 0) return { exists: false, running: false, port: null, status: "missing" };
    const [stateJson, portsJson, image = "", mounts = ""] = result.stdout.toString("utf8").trim().split("\t");
    const state = JSON.parse(stateJson || "{}");
    let port = null;
    let sshPort = null;
    try {
      const ports = JSON.parse(portsJson || "{}");
      if (ports?.["6080/tcp"]?.[0]?.HostPort) port = Number(ports["6080/tcp"][0].HostPort);
      if (ports?.["22/tcp"]?.[0]?.HostPort) sshPort = Number(ports["22/tcp"][0].HostPort);
    } catch {}
    const current = await this.imageId();
    const outdated = Boolean(current && image && image !== current) || !mounts.split(",").includes("/var/lib/cora") || !sshPort;
    return { exists: true, running: Boolean(state.Running), port, sshPort, outdated, status: state.Status || "unknown", startedAt: state.StartedAt };
  }

  /**
   * Make sure the desktop runs. A box built from an older image is recreated
   * when it is not running, or always with `upgrade` (cora does that when it
   * starts, so a deploy with a new image upgrades every desktop). Volumes stay.
   */
  ensure(agent, { upgrade = false } = {}) {
    if (this.pending.has(agent.id)) return this.pending.get(agent.id);
    const job = this.ensureNow(agent, { upgrade }).finally(() => this.pending.delete(agent.id));
    this.pending.set(agent.id, job);
    return job;
  }

  async ensureNow(agent, { upgrade = false } = {}) {
    const current = await this.inspect(agent.id);
    if (current.exists && current.running && !(upgrade && current.outdated)) return current;
    if (current.exists && !current.outdated) {
      const started = await runProcess(this.docker, ["start", this.name(agent.id)], { timeoutMs: 60000 });
      if (started.code !== 0) throw new Error(`docker start failed: ${started.stderr.trim().slice(0, 300)}`);
      await this.syncAccess(agent).catch(() => {});
      return this.inspect(agent.id);
    }
    if (current.exists) await runProcess(this.docker, ["rm", "-f", this.name(agent.id)], { timeoutMs: 60000 });
    return this.create(agent);
  }

  /** Recreate the box from the current image now, keeping its volumes. */
  upgrade(agent) {
    return this.ensure(agent, { upgrade: true });
  }

  async create(agent) {
    if (!(await this.imageExists())) throw new Error(`the desktop image ${this.image} is not built`);
    const { sshPort } = this.access(agent);
    const created = await runProcess(this.docker, [
      "run", "-d",
      "--name", this.name(agent.id),
      "--hostname", slug(agent.name),
      "--restart", "unless-stopped",
      "--shm-size", "1g",
      "--memory", "2g",
      "--cpus", "2",
      "-p", "127.0.0.1::6080",
      "-e", `TZ=${this.timezone}`,
      ...(sshPort ? ["-p", `127.0.0.1:${sshPort}:22`] : []),
      "-v", `${this.volume(agent.id)}:/home/agent`,
      "-v", `${this.sysVolume(agent.id)}:/var/lib/cora`,
      "--label", `cora.agent=${agent.id}`,
      this.image,
    ], { timeoutMs: 120000 });
    if (created.code !== 0) throw new Error(`docker run failed: ${created.stderr.trim().slice(0, 300)}`);
    await this.syncAccess(agent).catch(() => {});
    return this.inspect(agent.id);
  }

  /** Write the allowed SSH keys and keep Tailscale SSH on when the box is on the tailnet. */
  async syncAccess(agent) {
    const { keys = [] } = this.access(agent);
    await runProcess(this.docker, this.execArgs(agent.id, ["sh", "-c", "umask 022 && cat > /etc/ssh/cora_authorized_keys.new && mv /etc/ssh/cora_authorized_keys.new /etc/ssh/cora_authorized_keys"], { root: true }), {
      input: keys.length ? `${keys.join("\n")}\n` : "", timeoutMs: 20000,
    });
    this.keepTailscaleSsh(agent).catch(() => {});
  }

  /** tailscaled needs a moment after a start; once the box is on the tailnet, Tailscale SSH stays on. */
  async keepTailscaleSsh(agent) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const status = await this.tailscale(agent.id);
      if (status.state === "Running") {
        await this.tailscaleSet(agent);
        return;
      }
      if (status.state !== "NoState" && status.state !== "Starting" && status.state !== "unavailable") return;
      await sleep(1000);
    }
  }

  async tailscale(agentId) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["tailscale", "status", "--json"], { root: true }), { timeoutMs: 15000 });
    let data;
    try {
      data = JSON.parse(result.stdout.toString("utf8"));
    } catch {
      return { state: "unavailable", error: (result.stderr || "").trim().slice(0, 200) };
    }
    const self = data.Self || {};
    return {
      state: data.BackendState || "unknown",
      authUrl: data.AuthURL || "",
      host: self.HostName || "",
      dnsName: String(self.DNSName || "").replace(/\.$/, ""),
      ips: self.TailscaleIPs || [],
      online: Boolean(self.Online),
    };
  }

  tailscaleSet(agent) {
    return runProcess(this.docker, this.execArgs(agent.id, ["tailscale", "set", "--ssh", `--hostname=${slug(agent.name)}`], { root: true }), { timeoutMs: 20000 });
  }

  /** Put the box on the tailnet with Tailscale SSH; returns the login link when the owner has to approve it. */
  async tailscaleConnect(agent) {
    let status = await this.tailscale(agent.id);
    if (status.state === "Running") {
      await this.tailscaleSet(agent);
      return this.tailscale(agent.id);
    }
    if (status.authUrl) return status;
    await runProcess(this.docker, this.execArgs(agent.id, ["tailscale", "up", "--ssh", `--hostname=${slug(agent.name)}`, "--accept-dns=false", "--timeout=10s"], { root: true }), { timeoutMs: 25000 });
    for (let attempt = 0; attempt < 16; attempt += 1) {
      status = await this.tailscale(agent.id);
      if (status.authUrl || status.state === "Running") break;
      await sleep(500);
    }
    return status;
  }

  async stop(agentId) {
    const result = await runProcess(this.docker, ["stop", "-t", "5", this.name(agentId)], { timeoutMs: 60000 });
    if (result.code !== 0) throw new Error(`docker stop failed: ${result.stderr.trim().slice(0, 300)}`);
  }

  async restart(agentId) {
    const result = await runProcess(this.docker, ["restart", "-t", "5", this.name(agentId)], { timeoutMs: 90000 });
    if (result.code !== 0) throw new Error(`docker restart failed: ${result.stderr.trim().slice(0, 300)}`);
  }

  async remove(agentId, { volume = false } = {}) {
    await runProcess(this.docker, ["rm", "-f", this.name(agentId)], { timeoutMs: 60000 });
    if (volume) await runProcess(this.docker, ["volume", "rm", "-f", this.volume(agentId), this.sysVolume(agentId)], { timeoutMs: 60000 });
  }

  execArgs(agentId, argv, { root = false } = {}) {
    const user = root ? ["-u", "root"] : ["-u", "agent", "-w", "/home/agent", "-e", "HOME=/home/agent", "-e", "USER=agent"];
    return ["exec", "-i", ...user, "-e", "DISPLAY=:1", "-e", `TZ=${this.timezone}`, this.name(agentId), ...argv];
  }

  /** Run a shell command as the agent's user. Output is merged and clipped. */
  async shell(agentId, command, { timeoutMs = 120000 } = {}) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["bash", "-lc", command]), { timeoutMs, maxBytes: 4 * 1024 * 1024 });
    const output = [result.stdout.toString("utf8"), result.stderr].filter(Boolean).join(result.stderr && result.stdout.length ? "\n[stderr]\n" : "");
    return { code: result.code, timedOut: result.timedOut, output: clip(output) };
  }

  async run(agentId, argv, { timeoutMs = 30000 } = {}) {
    const result = await runProcess(this.docker, this.execArgs(agentId, argv), { timeoutMs });
    return { code: result.code, output: clip(`${result.stdout.toString("utf8")}${result.stderr}`, 4000) };
  }

  async screenshot(agentId) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["import", "-silent", "-window", "root", "-quality", "70", "jpg:-"]), { timeoutMs: 30000 });
    if (result.code !== 0 || !result.stdout.length) throw new Error(`screenshot failed: ${result.stderr.trim().slice(0, 200) || "no output"}`);
    return result.stdout;
  }

  async readFile(agentId, path, maxBytes = 8 * 1024 * 1024) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["cat", "--", path]), { timeoutMs: 30000, maxBytes });
    if (result.code !== 0) throw new Error(result.stderr.trim().slice(0, 200) || `cannot read ${path}`);
    if (result.truncated) throw new Error(`file larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    return result.stdout;
  }

  async shareFile(sourceId, recipientId, path) {
    if (![sourceId, recipientId].every((id) => /^ag_[a-f0-9]{12}$/.test(id)) || sourceId === recipientId) throw new Error("invalid file recipient");
    if (!String(path).startsWith("/home/agent/work/") || !posix.normalize(path).startsWith("/home/agent/work/")) throw new Error("only files in /home/agent/work can be shared");
    const maxBytes = 8 * 1024 * 1024;
    const read = await runProcess(this.docker, this.execArgs(sourceId, ["python3", "-c", `import pathlib,sys
root=pathlib.Path('/home/agent/work')
if root.is_symlink(): sys.exit('work directory must not be a symlink')
root=root.resolve(strict=True)
path=pathlib.Path(sys.argv[1]).resolve(strict=True)
if not path.is_relative_to(root) or not path.is_file(): sys.exit('source must be a regular file within /home/agent/work')
with path.open('rb') as file: data=file.read(8*1024*1024+1)
if len(data)>8*1024*1024: sys.exit('file larger than 8 MB')
sys.stdout.buffer.write(data)`, path]), { timeoutMs: 30000, maxBytes });
    if (read.code !== 0 || read.truncated) throw new Error(read.stderr.trim().split("\n").at(-1).slice(0, 300) || "cannot read shared file");
    const digest = createHash("sha256").update(read.stdout).digest("hex");
    const original = posix.basename(path).replace(/[^\w.-]/g, "_").slice(-100) || "file";
    const extension = posix.extname(original);
    const name = `${original.slice(0, original.length - extension.length)}-${digest.slice(0, 12)}${extension}`;
    const write = await runProcess(this.docker, this.execArgs(recipientId, ["python3", "-c", `import hashlib,json,os,secrets,sys
data=sys.stdin.buffer.read(8*1024*1024+1)
digest=hashlib.sha256(data).hexdigest()
if len(data)>8*1024*1024 or digest!=sys.argv[3]: sys.exit('shared file checksum mismatch')
directory=os.open('/home/agent',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
temporary='.incoming-'+secrets.token_hex(12)
try:
 for part in ('work','shared',sys.argv[1]):
  try: os.mkdir(part,0o700,dir_fd=directory)
  except FileExistsError: pass
  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
  os.close(directory)
  directory=child
 with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory),'wb') as file:
  file.write(data)
  file.flush()
  os.fsync(file.fileno())
 try: os.link(temporary,sys.argv[2],src_dir_fd=directory,dst_dir_fd=directory,follow_symlinks=False)
 except FileExistsError: pass
 with os.fdopen(os.open(sys.argv[2],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory),'rb') as file: received=file.read(8*1024*1024+1)
 if received!=data: sys.exit('destination already exists with different contents; left unchanged')
 print(json.dumps({'path':'/home/agent/work/shared/'+sys.argv[1]+'/'+sys.argv[2],'sha256':digest,'bytes':len(received)}))
finally:
 try: os.unlink(temporary,dir_fd=directory)
 except FileNotFoundError: pass
 os.close(directory)`, sourceId, name, digest]), { input: read.stdout, timeoutMs: 30000 });
    if (write.code !== 0) throw new Error(write.stderr.trim().split("\n").at(-1).slice(0, 300) || "file delivery failed");
    const receipt = JSON.parse(write.stdout.toString("utf8"));
    if (receipt.sha256 !== digest || receipt.bytes !== read.stdout.length) throw new Error("file delivery checksum mismatch");
    return receipt;
  }
}
