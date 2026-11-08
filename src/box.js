import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_LIMIT = 24000;
const MAILBOX_SCRIPT = readFileSync(new URL("./desktop-mailbox.mjs", import.meta.url), "utf8");
const GIT_SCRIPT = readFileSync(new URL("./desktop-git.sh", import.meta.url), "utf8");
const SSH_SCRIPT = readFileSync(new URL("./desktop-ssh.mjs", import.meta.url), "utf8");
const GIT_SETUP_SCRIPT = readFileSync(new URL("./desktop-git-setup.mjs", import.meta.url), "utf8");
const GITHUB_SCRIPT = readFileSync(new URL("./desktop-github.mjs", import.meta.url), "utf8");
// gh, GitHub's command line, put on a running desktop when it gets its GitHub App: no image rebuild, no restart.
const GH_INSTALL = `command -v gh >/dev/null 2>&1 && exit 0
set -e
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt-get update -qq
apt-get install -y -qq --no-install-recommends gh
rm -rf /var/lib/apt/lists/*
gh --version >/dev/null`;

/**
 * Lists a file or a folder under /home/agent/work for a push: one JSON line per
 * regular file with its size and sha256, symlinks and special files skipped, the
 * usual clutter ignored, and anything that looks like a secret refused by name.
 */
const MANIFEST_SCRIPT = String.raw`import hashlib,json,os,re,stat,sys
WORK='/home/agent/work'
SKIP={'.git','node_modules','__pycache__','.DS_Store','.cora-artifact.json'}
SECRET_NAME=re.compile(r'^(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd)$',re.I)
SECRET_DIRS={'.ssh','.aws','.gnupg','.docker','.kube'}
LIMIT=int(sys.argv[2])
def out(o): sys.stdout.write(json.dumps(o)+'\n')
if os.path.islink(WORK): sys.exit('/home/agent/work must not be a symlink')
work=os.path.realpath(WORK)
target=sys.argv[1]
if os.path.islink(target): sys.exit('the path is a symlink: give the real file or folder')
real=os.path.realpath(target)
if real==work or not real.startswith(work+os.sep): sys.exit('choose a file or a folder inside /home/agent/work, not the whole work folder')
if not os.path.exists(real): sys.exit('no such file or folder: '+target)
count=0
def add(full,rel):
  global count
  try: fd=os.open(full,os.O_RDONLY|os.O_NOFOLLOW)
  except OSError: out({'skip':rel,'why':'unreadable'}); return
  try:
    st=os.fstat(fd)
    if not stat.S_ISREG(st.st_mode): out({'skip':rel,'why':'not a regular file'}); return
    count+=1
    if count>LIMIT: out({'limit':'files'}); sys.exit(0)
    h=hashlib.sha256(); n=0
    while True:
      b=os.read(fd,1<<20)
      if not b: break
      h.update(b); n+=len(b)
    out({'p':rel,'s':n,'h':h.hexdigest()})
  finally: os.close(fd)
def walk(path,rel):
  with os.scandir(path) as it: entries=sorted(it,key=lambda e:e.name)
  for e in entries:
    r=rel+'/'+e.name if rel else e.name
    if e.name in SKIP: out({'skip':r,'why':'ignored'}); continue
    if e.is_symlink(): out({'skip':r,'why':'symlink'}); continue
    if e.is_dir(follow_symlinks=False):
      if e.name in SECRET_DIRS: out({'refuse':r+'/','why':'secret folder'}); continue
      walk(e.path,r)
    elif e.is_file(follow_symlinks=False):
      if SECRET_NAME.match(e.name): out({'refuse':r,'why':'secret file'}); continue
      add(e.path,r)
    else: out({'skip':r,'why':'not a regular file'})
st=os.lstat(real)
if stat.S_ISDIR(st.st_mode):
  marker=None
  mp=os.path.join(real,'.cora-artifact.json')
  if os.path.isfile(mp) and not os.path.islink(mp) and os.path.getsize(mp)<4096:
    try:
      with open(mp) as f: marker=json.load(f)
    except Exception: marker=None
  out({'kind':'dir','root':os.path.relpath(real,work),'marker':marker})
  walk(real,'')
elif stat.S_ISREG(st.st_mode):
  name=os.path.basename(real)
  parent=os.path.dirname(real)
  out({'kind':'file','root':'' if parent==work else os.path.relpath(parent,work)})
  if SECRET_NAME.match(name): out({'refuse':name,'why':'secret file'})
  else: add(real,name)
else: sys.exit('not a file or a folder: '+target)
`;

/**
 * Streams the files Cora asked for, in order, each as an 8-byte length and its
 * bytes, hashing as it goes: a file that changed since it was listed stops the push.
 */
const SEND_SCRIPT = String.raw`import hashlib,json,os,struct,sys
WORK='/home/agent/work'
work=os.path.realpath(WORK)
root=os.path.realpath(os.path.join(work,sys.argv[1])) if sys.argv[1] else work
if not (root==work or root.startswith(work+os.sep)): sys.exit('the folder left /home/agent/work')
wanted=json.loads(sys.stdin.buffer.read())
outb=sys.stdout.buffer
for rel,size,sha in wanted:
  full=os.path.join(root,rel)
  if not os.path.realpath(full).startswith(root+os.sep): sys.exit('a path left the folder: '+rel)
  fd=os.open(full,os.O_RDONLY|os.O_NOFOLLOW)
  try:
    if os.fstat(fd).st_size!=size: sys.exit('changed while pushing: '+rel)
    outb.write(struct.pack('>Q',size))
    h=hashlib.sha256(); n=0
    while n<size:
      b=os.read(fd,min(1<<20,size-n))
      if not b: break
      h.update(b); outb.write(b); n+=len(b)
    if n!=size or h.hexdigest()!=sha: sys.exit('changed while pushing: '+rel)
  finally: os.close(fd)
outb.flush()
`;

/**
 * Writes a folder's files under /home/agent/work/artifacts/<dest>, walking every
 * directory by descriptor without following links; a folder that already holds
 * files is replaced only when asked. The marker remembers which commit this is.
 */
const CHECKOUT_SCRIPT = String.raw`import json,os,shutil,stat,struct,sys
inp=sys.stdin.buffer
head=json.loads(inp.readline())
def opendir(parent,name):
  try: os.mkdir(name,0o755,dir_fd=parent)
  except FileExistsError: pass
  return os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
fd=os.open('/home/agent',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
for part in ['work','artifacts']+head['dest'].split('/'):
  child=opendir(fd,part); os.close(fd); fd=child
existing=os.listdir(fd)
if existing:
  if not head.get('overwrite'): sys.exit('/home/agent/work/artifacts/'+head['dest']+' already has files: pull again with overwrite to replace them')
  for name in existing:
    if stat.S_ISDIR(os.lstat(name,dir_fd=fd).st_mode): shutil.rmtree(name,dir_fd=fd)
    else: os.unlink(name,dir_fd=fd)
for path,size in head['files']:
  parts=path.split('/')
  d=os.dup(fd)
  for part in parts[:-1]:
    child=opendir(d,part); os.close(d); d=child
  (n,)=struct.unpack('>Q',inp.read(8))
  if n!=size: sys.exit('bad frame for '+path)
  with os.fdopen(os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o644,dir_fd=d),'wb') as w:
    left=n
    while left:
      b=inp.read(min(1<<20,left))
      if not b: sys.exit('the stream ended early')
      w.write(b); left-=len(b)
  os.close(d)
with os.fdopen(os.open('.cora-artifact.json',os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o644,dir_fd=fd),'w') as w: json.dump(head['marker'],w)
os.close(fd)
sys.stdout.write(json.dumps({'path':'/home/agent/work/artifacts/'+head['dest'],'files':len(head['files'])})+'\n')
`;
const BROWSER_SECCOMP = fileURLToPath(new URL("../box/seccomp.json", import.meta.url));

/**
 * A child whose output is handed over as it comes, for transfers too large to
 * hold: stopped when it is silent for idleMs or runs past timeoutMs. `input` is a
 * Buffer or an async iterable of Buffers written with backpressure.
 */
export function streamProcess(command, args, { input, onData = () => {}, timeoutMs = 600000, idleMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stderr = [];
    let stopped = "";
    let failure = null;
    const stop = (why) => {
      if (!stopped) stopped = why;
      child.kill("SIGKILL");
    };
    const total = setTimeout(() => stop("timed out"), timeoutMs);
    let idle = setTimeout(() => stop("stalled"), idleMs);
    child.stdout.on("data", (chunk) => {
      clearTimeout(idle);
      idle = setTimeout(() => stop("stalled"), idleMs);
      try {
        onData(chunk);
      } catch (error) {
        failure = error;
        stop("refused");
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(total);
      clearTimeout(idle);
      resolve({ code: -1, stderr: error.message, stopped, error: failure });
    });
    child.on("close", (code) => {
      clearTimeout(total);
      clearTimeout(idle);
      resolve({ code, stderr: Buffer.concat(stderr).toString("utf8"), stopped, error: failure });
    });
    if (input === undefined) child.stdin.end();
    else if (Buffer.isBuffer(input) || typeof input === "string") child.stdin.end(input);
    else (async () => {
      try {
        for await (const chunk of input) {
          if (!child.stdin.write(chunk)) await new Promise((done) => child.stdin.once("drain", done));
        }
      } catch (error) {
        failure = error;
        stop("refused");
      }
      child.stdin.end();
    })();
  });
}

/** The last line a script wrote to stderr: its own reason, not Python's traceback. */
function lastLine(text, fallback) {
  return String(text || "").trim().split("\n").at(-1).slice(0, 300) || fallback;
}

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
    // A process that exits before reading its input closes the pipe: its exit code says what happened,
    // and the write error must not bring Cora down.
    child.stdin.on("error", () => {});
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
  constructor({ docker, image, timezone, access = () => ({}), mailbox = null, gitAttribution = null }) {
    this.docker = docker;
    this.image = image;
    this.timezone = timezone;
    this.access = access;
    this.mailbox = mailbox;
    this.gitAttribution = gitAttribution;
    this.gitChecks = new Map();
    this.mailboxChecks = new Map();
    this.mailboxQueue = Promise.resolve();
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
    const job = this.ensureNow(agent, { upgrade }).then(async (current) => {
      await this.ensureGitAttribution(agent, current);
      await this.ensureMailbox(agent);
      return current;
    }).finally(() => this.pending.delete(agent.id));
    this.pending.set(agent.id, job);
    return job;
  }

  async ensureGitAttribution(agent, current) {
    if (!this.gitAttribution || !agent.tools) return;
    const { enabled, email } = this.gitAttribution;
    const version = `${current.startedAt}:${enabled}:${email}`;
    if (this.gitChecks.get(agent.id) === version) return;
    const quoted = `'${String(email).replace(/'/g, "'\\''")}'`;
    const git = GIT_SCRIPT.replace("__CORA_ENABLED__", enabled ? "1" : "0").replace("__CORA_EMAIL__", quoted);
    const result = await runProcess(this.docker, this.execArgs(agent.id, ["node", "--input-type=module", "-e", GIT_SETUP_SCRIPT], { root: true }), {
      input: JSON.stringify({ git, ssh: SSH_SCRIPT, enabled, email }), timeoutMs: 15000, maxBytes: 4096,
    });
    if (result.code !== 0) throw new Error(`Git attribution setup failed: ${result.stderr.trim().slice(0, 300)}`);
    this.gitChecks.set(agent.id, version);
  }

  ensureMailbox(agent) {
    const job = this.mailboxQueue.then(() => this.ensureMailboxNow(agent));
    this.mailboxQueue = job.catch(() => {});
    return job;
  }

  assignMailbox(agent, { local, domain }) {
    const job = this.mailboxQueue.then(async () => {
      if (!this.mailbox?.token || !agent.enabled || !agent.tools) throw new Error("mailbox is unavailable");
      await this.ensureNow(agent);
      const previous = this.mailbox.identity?.(agent);
      const identity = await this.provisionMailbox(agent, local, domain);
      const previousEmails = [...new Set([...(previous?.previousEmails || []), ...(previous?.email && previous.email !== identity.email ? [previous.email] : [])])].filter((email) => email !== identity.email);
      const value = { ...identity, status: "ready", error: "", previousEmails };
      this.mailbox.changed?.(agent, value);
      this.mailboxChecks.set(agent.id, { at: Date.now(), ready: true });
      return value;
    });
    this.mailboxQueue = job.catch(() => {});
    return job;
  }

  async provisionMailbox(agent, local, domain) {
    const result = await runProcess(this.docker, this.execArgs(agent.id, ["node", "--input-type=module", "-e", MAILBOX_SCRIPT]), {
      input: JSON.stringify({ endpoint: this.mailbox.endpoint, domain, namespace: this.mailbox.namespace, token: this.mailbox.token, local, displayName: agent.name }), timeoutMs: 60000, maxBytes: 64 * 1024,
    });
    if (result.code !== 0) throw new Error(`mailbox provisioning failed${result.timedOut ? " (timed out)" : ""}: ${result.stderr.trim().slice(0, 200)}`);
    const identity = JSON.parse(result.stdout.toString("utf8"));
    if (identity.email !== `${local}@${domain}`) throw new Error("unexpected mailbox identity");
    return identity;
  }

  async ensureMailboxNow(agent) {
    if (!this.mailbox?.token || !this.mailbox.domain || !this.mailbox.namespace || !agent.tools || !agent.enabled) return;
    const previous = this.mailboxChecks.get(agent.id);
    if (previous?.ready || previous?.at > Date.now() - 60000) return;
    this.mailboxChecks.set(agent.id, { at: Date.now() });
    try {
      const existing = this.mailbox.identity?.(agent);
      const suffix = slug(this.mailbox.namespace).slice(0, 14).replace(/-$/, "");
      const [keptLocal, keptDomain] = String(existing?.email || "").split("@");
      const local = keptLocal || `${slug(agent.name).slice(0, 31 - suffix.length).replace(/-$/, "")}-${suffix}`;
      const identity = await this.provisionMailbox(agent, local, keptDomain || this.mailbox.domain);
      this.mailbox.changed?.(agent, { ...identity, status: "ready" });
      this.mailboxChecks.set(agent.id, { at: Date.now(), ready: true });
    } catch (error) {
      this.mailbox.changed?.(agent, { status: "blocked", error: error.message });
    }
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
      "--security-opt", `seccomp=${BROWSER_SECCOMP}`,
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

  /** The agent's GitHub App tokens, one per account, where git and gh read them; passed on stdin, never on a command line. */
  async githubLogin(agentId, { tokens, primary, login, name, email }) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["node", "--input-type=module", "-e", GITHUB_SCRIPT]), {
      input: JSON.stringify({ tokens, primary, login, name, email }), timeoutMs: 20000, maxBytes: 4096,
    });
    if (result.code !== 0) throw new Error(`GitHub sul desktop: ${lastLine(result.stderr, "non riesco a scrivere il token")}`);
  }

  /** gh on the desktop, installed as root the first time it is missing; a few seconds when it is already there. */
  async ensureGh(agentId) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["sh", "-c", GH_INSTALL], { root: true }), { timeoutMs: 300000, maxBytes: 64 * 1024 });
    if (result.code !== 0) throw new Error(`gh: ${lastLine(result.stderr, "installazione non riuscita")}`);
  }

  async githubLogout(agentId) {
    await runProcess(this.docker, this.execArgs(agentId, ["node", "--input-type=module", "-e", GITHUB_SCRIPT]), { input: JSON.stringify({ remove: true }), timeoutMs: 20000, maxBytes: 4096 });
  }

  /** Run a shell command as the agent's user. Output is merged and clipped. */
  async shell(agentId, command, { timeoutMs = 120000 } = {}) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["bash", "-lc", command]), { timeoutMs, maxBytes: 4 * 1024 * 1024 });
    const output = [result.stdout.toString("utf8"), result.stderr].filter(Boolean).join(result.stderr && result.stdout.length ? "\n[stderr]\n" : "");
    return { code: result.code, timedOut: result.timedOut, output: clip(output) };
  }

  async gitCommit(agentId, directory, message, trailer = "") {
    if (!posix.isAbsolute(directory) || directory.includes("\0")) throw new Error("repository must be an absolute desktop path");
    if (!message.trim() || message.length > 64000 || message.includes("\0")) throw new Error("commit message must contain 1–64000 characters without NUL");
    const managed = this.gitAttribution && this.gitChecks.has(agentId);
    const email = trailer ? /<([^<>]+)>$/.exec(trailer)?.[1] : "";
    if (managed && trailer && !email) throw new Error("invalid Cora co-author trailer");
    const explicit = trailer && !managed;
    const argv = ["git", "-C", directory, ...(explicit ? ["-c", "trailer.ifExists=addIfDifferent"] : []), "commit", "--file=-", ...(explicit ? ["--trailer", trailer] : [])];
    const command = managed ? ["env", ...(trailer ? ["CORA_GIT_ATTRIBUTION=1", `CORA_GIT_COAUTHOR_EMAIL=${email}`] : ["CORA_GIT_ATTRIBUTION=0"]), ...argv] : argv;
    const result = await runProcess(this.docker, this.execArgs(agentId, command), { input: message, timeoutMs: 120000, maxBytes: 1024 * 1024 });
    return { code: result.code, timedOut: result.timedOut, output: clip(`${result.stdout.toString("utf8")}${result.stderr}`) };
  }

  async run(agentId, argv, { timeoutMs = 30000 } = {}) {
    const result = await runProcess(this.docker, this.execArgs(agentId, argv), { timeoutMs });
    return { code: result.code, output: clip(`${result.stdout.toString("utf8")}${result.stderr}`, 4000) };
  }

  /**
   * Ask the Chromium on the desktop what the pixels cannot say: the page's text,
   * its elements, which sessions it holds, where its requests went. Cookie and
   * storage values never come back — only their names and sizes.
   */
  async browser(agentId, action, argument = "", { timeoutMs = 45000 } = {}) {
    const result = await runProcess(this.docker, this.execArgs(agentId, ["cora-cdp", String(action), ...(argument ? [String(argument)] : [])]), { timeoutMs });
    const output = `${result.stdout.toString("utf8")}${result.stderr}`.trim();
    if (result.code !== 0) throw new Error(clip(output, 300) || `browser ${action} failed`);
    try {
      return JSON.parse(result.stdout.toString("utf8"));
    } catch {
      throw new Error(`browser ${action}: unreadable answer`);
    }
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

  /**
   * What a push would send: `{kind, root, marker, files: [{path, size, sha256}], skipped, refused, tooMany}`.
   * The listing is only a claim: Cora checks every path and size itself.
   */
  async artifactManifest(agentId, path, { maxFiles = 5000 } = {}) {
    if (posix.normalize(String(path)).replace(/\/+$/, "") === "/home/agent/work") throw new Error("choose a file or a folder inside /home/agent/work, not the whole work folder");
    if (!String(path).startsWith("/home/agent/work/")) throw new Error("push a file or a folder inside /home/agent/work");
    const result = await runProcess(this.docker, this.execArgs(agentId, ["python3", "-c", MANIFEST_SCRIPT, String(path), String(maxFiles)]), { timeoutMs: 300000, maxBytes: 16 * 1024 * 1024 });
    if (result.code !== 0 || result.truncated) throw new Error(result.truncated ? "the file list is too long" : lastLine(result.stderr, "cannot list the files"));
    const lines = result.stdout.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const head = lines.shift();
    if (!head?.kind) throw new Error("cannot list the files");
    const manifest = { kind: head.kind, root: String(head.root || ""), marker: head.marker || null, files: [], skipped: [], refused: [], tooMany: false };
    for (const line of lines) {
      if (line.limit) manifest.tooMany = true;
      else if (line.skip !== undefined) manifest.skipped.push({ path: String(line.skip), why: String(line.why || "") });
      else if (line.refuse !== undefined) manifest.refused.push({ path: String(line.refuse), why: String(line.why || "") });
      else manifest.files.push({ path: String(line.p), size: Number(line.s), sha256: String(line.h) });
    }
    return manifest;
  }

  /**
   * Streams the listed files out of the desktop: `open(index)` returns a writer
   * `{write(chunk), end()}` for each file in turn. A file that changed since the
   * listing, or a writer that refuses, stops the transfer.
   */
  async artifactSend(agentId, root, files, open) {
    let index = -1;
    let left = 0;
    let header = Buffer.alloc(0);
    let writer = null;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const onData = (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        if (!writer) {
          const need = 8 - header.length;
          header = Buffer.concat([header, chunk.subarray(offset, offset + need)]);
          offset += Math.min(need, chunk.length - offset);
          if (header.length < 8) return;
          index += 1;
          left = Number(header.readBigUInt64BE(0));
          header = Buffer.alloc(0);
          if (index >= files.length || left !== files[index].size) throw new Error("the desktop sent an unexpected file");
          writer = open(index);
          if (!left) {
            writer.end();
            writer = null;
          }
          continue;
        }
        const piece = chunk.subarray(offset, offset + left);
        writer.write(piece);
        offset += piece.length;
        left -= piece.length;
        if (!left) {
          writer.end();
          writer = null;
        }
      }
    };
    const result = await streamProcess(this.docker, this.execArgs(agentId, ["python3", "-c", SEND_SCRIPT, String(root)]), {
      input: Buffer.from(JSON.stringify(files.map((file) => [file.path, file.size, file.sha256]))), onData,
      timeoutMs: 120000 + Math.ceil(total / (2 * 1024 * 1024)) * 1000, idleMs: 120000,
    });
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(result.stopped && result.stopped !== "refused" ? `the transfer ${result.stopped}` : lastLine(result.stderr, "the transfer failed"));
    if (index !== files.length - 1 || writer) throw new Error("the transfer ended early");
  }

  /** Writes files (`[{path, size, read(): AsyncIterable<Buffer>}]`) into /home/agent/work/artifacts/<dest>. */
  async artifactCheckout(agentId, dest, files, { marker, overwrite = false } = {}) {
    if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(dest)) throw new Error("invalid destination");
    async function* frames() {
      yield Buffer.from(`${JSON.stringify({ dest, overwrite, marker, files: files.map((file) => [file.path, file.size]) })}\n`);
      for (const file of files) {
        const size = Buffer.alloc(8);
        size.writeBigUInt64BE(BigInt(file.size));
        yield size;
        for await (const chunk of file.read()) yield chunk;
      }
    }
    let output = "";
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const result = await streamProcess(this.docker, this.execArgs(agentId, ["python3", "-c", CHECKOUT_SCRIPT]), {
      input: frames(), onData: (chunk) => { output += chunk.toString("utf8"); }, timeoutMs: 120000 + Math.ceil(total / (2 * 1024 * 1024)) * 1000,
    });
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(lastLine(result.stderr, "the pull failed"));
    return JSON.parse(output.trim().split("\n").at(-1));
  }

  /**
   * Puts a value into the hush on an agent's desktop under a name: sealed to that
   * hush's own box key and opened straight into its vault, from stdin to stdin. The
   * value is never an argument, never printed, never a file left behind.
   */
  async importSecret(agentId, name, value) {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error("invalid secret name");
    const script = [
      "set -e",
      'command -v hush >/dev/null 2>&1 || { echo "hush is not installed on this computer" >&2; exit 3; }',
      'H="${HUSH_HOME:-$HOME/.hush}"',
      '[ -f "$H/identity" ] || hush --home "$H" init </dev/null >/dev/null',
      '[ -f "$H/box.pub" ] || hush --home "$H" box init </dev/null >/dev/null',
      'hush --home "$H" box seal --to self --uses 1 --pubkey-file "$H/box.pub" | hush --home "$H" box open "$1" >/dev/null',
    ].join("\n");
    const result = await runProcess(this.docker, this.execArgs(agentId, ["bash", "-c", script, "cora-secret", name]), { input: Buffer.from(value), timeoutMs: 60000, maxBytes: 64 * 1024 });
    if (result.code !== 0) throw new Error(lastLine(result.stderr, "hush did not take the secret"));
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
