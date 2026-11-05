import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { SECRET_SHAPES } from "./company-brain.js";

/** A folder: lowercase words and dashes, up to six levels (clienti/acme/report-q3). */
export const FOLDER_PATH = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,5}$/;
export const LIMITS = { files: 5000, fileBytes: 100 * 1024 * 1024, pushBytes: 500 * 1024 * 1024, freeBytes: 5 * 1024 * 1024 * 1024 };
export const DEFAULT_QUOTA = 20 * 1024 * 1024 * 1024;
// What an agent sent for a folder counts as held for a day, so a push cut short resumes.
const UPLOAD_WINDOW_MS = 24 * 3600000;
// Longer than the seven nightly backups: a restored database still finds its files.
const GC_GRACE_MS = 8 * 86400000;
const SCAN_BYTES = 2 * 1024 * 1024;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
export const BRAIN_SLUG = "artefatti";
/** A share's name in its host, <label>--<space>.<domain>: one DNS label, never the reserved IDNA or preview shapes. */
export const SHARE_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const PREVIEW_LABEL = /^p-([a-f0-9]{12})$/;
// Anyone can have an address there: a grant to the whole domain would be a grant to everyone.
const WEBMAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.it", "live.com", "live.it", "msn.com", "yahoo.com", "yahoo.it", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.net", "web.de", "libero.it", "virgilio.it", "tiscali.it", "alice.it", "tim.it", "tin.it", "fastwebnet.it", "yandex.ru", "yandex.com", "mail.ru", "qq.com", "163.com", "zoho.com", "hey.com", "fastmail.com", "tutanota.com", "ambox.dev"]);
const EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
export const SHARE_MODES = ["people", "public", "password"];

/** An address as it is compared everywhere: trimmed, without mailto: or brackets, lowercase. */
export function cleanEmail(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
}

/** A domain as it is compared everywhere: without @, scheme, path or final dot, lowercase. */
export function cleanDomain(value) {
  return String(value ?? "").normalize("NFC").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^@/, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

const hashPassword = (password, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(String(password), salt, 32).toString("hex") });
const DOMAIN = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export class ArtifactError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validFolderPath(path) {
  return typeof path === "string" && path.length <= 120 && FOLDER_PATH.test(path);
}

/** A path inside a tree as the desktop claimed it, checked here: it is never trusted. */
export function cleanTreePath(path) {
  const value = String(path ?? "");
  if (!value || value !== value.normalize("NFC") || /[\u0000-\u001f\u007f\\]/.test(value)) throw new ArtifactError(`invalid file name: ${JSON.stringify(value.slice(0, 80))}`);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255)) throw new ArtifactError(`invalid file path: ${value.slice(0, 120)}`);
  if (Buffer.byteLength(value) > 1024 || parts.length > 32) throw new ArtifactError(`file path too long: ${value.slice(0, 120)}…`);
  if (parts[0] === "_cora") throw new ArtifactError("_cora is reserved: rename that folder");
  return value;
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const same = (a, b) => (a?.sha || null) === (b?.sha || null);

export function serializeTree(tree) {
  return JSON.stringify([...tree.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, file]) => [path, file.sha, file.size]));
}

/** What changed from one tree to the next, path by path. */
export function treeDelta(before, after) {
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [path, file] of after) {
    const old = before.get(path);
    if (!old) added.push(path);
    else if (old.sha !== file.sha) modified.push(path);
  }
  for (const path of before.keys()) if (!after.has(path)) deleted.push(path);
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

/**
 * Three-way merge by path, as git does for whole files: a side that left a path as
 * it was in the base takes the other side's version; both changing it differently is
 * a conflict, which `force` settles in favour of the commit.
 */
export function mergeTrees(base, head, mine, { force = false } = {}) {
  const tree = new Map();
  const conflicts = [];
  for (const path of new Set([...base.keys(), ...head.keys(), ...mine.keys()])) {
    const b = base.get(path);
    const h = head.get(path);
    const m = mine.get(path);
    let take;
    if (same(m, b)) take = h;
    else if (same(h, b) || same(h, m)) take = m;
    else {
      conflicts.push(path);
      take = m;
    }
    if (take) tree.set(path, take);
  }
  return { tree, conflicts: force ? [] : conflicts.sort(), forced: force ? conflicts.length : 0 };
}

const brief = (list) => ({ count: list.length, paths: list.slice(0, 300) });
const short = (id) => String(id || "").replace(/^ac_/, "").slice(0, 7);

export class Artifacts {
  constructor({ store, home, boxes = null, companyBrain = null, push = null, log = () => {}, notice = null, instanceUrl = "", shareSuffix = "" }) {
    // "--<space>.<domain>": where shares answer, when this space is reached through the cloud.
    this.shareSuffix = shareSuffix;
    this.store = store;
    this.boxes = boxes;
    this.companyBrain = companyBrain;
    this.webPush = push;
    this.log = log;
    this.notice = notice;
    this.instanceUrl = instanceUrl;
    this.dir = join(home, "artifacts");
    this.locks = new Map();
    this.trees = new Map();
    mkdirSync(join(this.dir, "objects"), { recursive: true, mode: 0o700 });
    mkdirSync(join(this.dir, "tmp"), { recursive: true, mode: 0o700 });
    // A transfer cut short by a restart leaves a half-written file behind.
    for (const name of readdirSync(join(this.dir, "tmp"))) rmSync(join(this.dir, "tmp", name), { force: true });
  }

  get quota() {
    return Number(this.store.settings.artifactQuotaBytes) || DEFAULT_QUOTA;
  }

  /** Serializes everything that moves a folder's head: one change at a time per folder. */
  async withLock(id, work) {
    const previous = this.locks.get(id) || Promise.resolve();
    let release;
    const mine = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => mine);
    this.locks.set(id, chained);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(id) === chained) this.locks.delete(id);
    }
  }

  /* ---------- objects ---------- */

  objectPath(sha) {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new ArtifactError("invalid object id");
    return join(this.dir, "objects", sha.slice(0, 2), sha);
  }

  hasObject(sha) {
    return existsSync(this.objectPath(sha));
  }

  putBytes(data) {
    const buffer = Buffer.from(data);
    const sha = sha256(buffer);
    const target = this.objectPath(sha);
    if (!existsSync(target)) {
      mkdirSync(join(this.dir, "objects", sha.slice(0, 2)), { recursive: true, mode: 0o700 });
      const temporary = join(this.dir, "tmp", randomBytes(12).toString("hex"));
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeSync(fd, buffer);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, target);
    }
    this.store.addArtifactObject(sha, buffer.length);
    return sha;
  }

  /** A writer for one file arriving from a desktop: hashed as it comes, kept only if it is what was announced. */
  objectWriter({ sha256: expected, size }) {
    const temporary = join(this.dir, "tmp", randomBytes(12).toString("hex"));
    const fd = openSync(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let written = 0;
    let closed = false;
    const close = () => {
      if (!closed) closeSync(fd);
      closed = true;
    };
    return {
      write: (chunk) => {
        written += chunk.length;
        if (written > size) {
          close();
          rmSync(temporary, { force: true });
          throw new ArtifactError("a file was larger than announced");
        }
        hash.update(chunk);
        writeSync(fd, chunk);
      },
      end: () => {
        fsyncSync(fd);
        close();
        const digest = hash.digest("hex");
        if (digest !== expected || written !== size) {
          rmSync(temporary, { force: true });
          throw new ArtifactError("a file changed while it was being pushed: push again");
        }
        const target = this.objectPath(digest);
        if (existsSync(target)) rmSync(temporary, { force: true });
        else {
          mkdirSync(join(this.dir, "objects", digest.slice(0, 2)), { recursive: true, mode: 0o700 });
          renameSync(temporary, target);
        }
        this.store.addArtifactObject(digest, size);
      },
      abort: () => {
        close();
        rmSync(temporary, { force: true });
      },
    };
  }

  readTree(sha) {
    if (!sha) return new Map();
    if (this.trees.has(sha)) return new Map(this.trees.get(sha));
    const entries = JSON.parse(readFileSync(this.objectPath(sha), "utf8"));
    const tree = new Map(entries.map(([path, file, size]) => [path, { sha: file, size }]));
    if (this.trees.size > 200) this.trees.delete(this.trees.keys().next().value);
    this.trees.set(sha, tree);
    return new Map(tree);
  }

  writeTree(tree) {
    const sha = this.putBytes(serializeTree(tree));
    this.trees.set(sha, new Map(tree));
    return sha;
  }

  treeOf(commitId) {
    if (!commitId) return new Map();
    const commit = this.store.artifactCommit(commitId);
    return commit ? this.readTree(commit.tree) : new Map();
  }

  /** The bytes of one stored file. */
  stream(sha, range) {
    return createReadStream(this.objectPath(sha), range || {});
  }

  readObject(sha, max = SCAN_BYTES) {
    const path = this.objectPath(sha);
    if (statSync(path).size > max) return null;
    return readFileSync(path);
  }

  /**
   * What this agent need not send again for this folder: files of the folder's own
   * commits, and what it sent for it in the last day. Never files known only from
   * another folder — holding a hash is not having the file.
   */
  heldFor(folderId, agentId) {
    const held = this.store.artifactUploads(folderId, agentId, Date.now() - UPLOAD_WINDOW_MS);
    for (const commit of this.store.artifactCommits(folderId, { limit: 100 })) {
      if (commit.status === "rejected") continue;
      for (const file of this.readTree(commit.tree).values()) held.add(file.sha);
    }
    return held;
  }

  /* ---------- folders ---------- */

  canWrite(folder, agent) {
    return Boolean(agent?.enabled !== false && (folder.writers || ["*"]).some((id) => id === "*" || id === agent.id));
  }

  canReview(folder, user) {
    return Boolean(user && (user.role === "owner" || (folder.reviewers || []).includes(user.id)));
  }

  createFolder({ path, title = "", description = "", kind = "files", policy = "review", writers = ["*"], reviewers = [], createdBy, requestedBy = null }) {
    const clean = String(path || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!validFolderPath(clean)) throw new ArtifactError("il percorso di una cartella è fatto di parole minuscole e trattini separate da /, fino a sei livelli: clienti/acme/report-q3");
    for (const other of this.store.artifactFolders()) {
      if (other.path === clean) throw new ArtifactError(`la cartella ${clean} esiste già`, 409);
      if (other.path.startsWith(`${clean}/`) || clean.startsWith(`${other.path}/`)) throw new ArtifactError(`${clean} starebbe dentro o sopra la cartella ${other.path}: scegli un percorso accanto`, 409);
    }
    const now = Date.now();
    const folder = {
      id: `af_${randomBytes(6).toString("hex")}`,
      path: clean,
      title: String(title || "").trim().slice(0, 80) || clean.split("/").at(-1),
      description: String(description || "").trim().slice(0, 600),
      kind: kind === "site" ? "site" : "files",
      policy: createdBy?.kind === "agent" ? "review" : policy === "direct" ? "direct" : "review",
      writers: this.cleanWriters(writers),
      reviewers: this.cleanReviewers(reviewers),
      createdBy: createdBy || null,
      requestedBy,
      createdAt: now,
      updatedAt: now,
      head: "",
    };
    this.store.writeArtifactFolder(folder);
    this.log({ type: "artifact", agentId: createdBy?.kind === "agent" ? createdBy.id : undefined, text: `nuova cartella degli artefatti ${clean}${createdBy?.name ? ` (${createdBy.name})` : ""}` });
    this.syncBrain();
    return folder;
  }

  cleanWriters(writers) {
    const list = Array.isArray(writers) ? writers.map(String) : ["*"];
    if (list.includes("*")) return ["*"];
    const known = new Set(this.store.agents().map((agent) => agent.id));
    return [...new Set(list.filter((id) => known.has(id)))];
  }

  cleanReviewers(reviewers) {
    const list = Array.isArray(reviewers) ? reviewers.map(String) : [];
    return [...new Set(list.filter((id) => this.store.panelUser(id)))].slice(0, 50);
  }

  updateFolder(id, changes, user) {
    const folder = this.store.artifactFolder(id);
    if (!folder) throw new ArtifactError("cartella non trovata", 404);
    const next = { ...folder };
    if (changes.title !== undefined) next.title = String(changes.title || "").trim().slice(0, 80) || folder.path.split("/").at(-1);
    if (changes.description !== undefined) next.description = String(changes.description || "").trim().slice(0, 600);
    if (changes.kind !== undefined) next.kind = changes.kind === "site" ? "site" : "files";
    if (changes.writers !== undefined) next.writers = this.cleanWriters(changes.writers);
    if (user?.role === "owner") {
      if (changes.policy !== undefined) next.policy = changes.policy === "direct" ? "direct" : "review";
      if (changes.reviewers !== undefined) next.reviewers = this.cleanReviewers(changes.reviewers);
    } else if (changes.policy !== undefined || changes.reviewers !== undefined) {
      throw new ArtifactError("solo il proprietario decide chi rivede una cartella e se pubblica subito", 403);
    }
    next.updatedAt = Date.now();
    this.store.writeArtifactFolder(next);
    this.syncBrain();
    return { ...next, head: folder.head };
  }

  deleteFolder(id) {
    const folder = this.store.artifactFolder(id);
    if (!folder) throw new ArtifactError("cartella non trovata", 404);
    this.store.deleteArtifactFolder(id);
    this.syncBrain();
    return folder;
  }

  findFolder(value) {
    const wanted = String(value || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    return this.store.artifactFolder(wanted) || this.store.artifactFolderByPath(wanted);
  }

  folderView(folder) {
    const commits = this.store.artifactCommits(folder.id, { limit: 200 });
    const head = folder.head ? commits.find((commit) => commit.id === folder.head) || this.store.artifactCommit(folder.head) : null;
    return {
      id: folder.id, path: folder.path, title: folder.title, description: folder.description, kind: folder.kind, policy: folder.policy,
      writers: folder.writers, reviewers: folder.reviewers, createdBy: folder.createdBy, requestedBy: folder.requestedBy,
      createdAt: folder.createdAt, updatedAt: folder.updatedAt, head: folder.head || "",
      headCommit: head ? this.commitSummary(head) : null,
      files: head?.files || 0, bytes: head?.bytes || 0,
      pending: commits.filter((commit) => commit.status === "proposed").length,
      conflicts: commits.filter((commit) => commit.status === "conflict").length,
      shares: this.store.artifactShares(folder.id).filter((share) => share.status === "active").length,
      proposedShares: this.store.artifactShares(folder.id).filter((share) => share.status === "proposed").length,
      lastActivity: commits[0]?.createdAt || folder.updatedAt,
    };
  }

  folders() {
    return this.store.artifactFolders().map((folder) => this.folderView(folder));
  }

  /** The folder list as an agent sees it: where things go and what it may do there. */
  foldersFor(agent, query = "") {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    return this.folders()
      .filter((folder) => !words.length || words.some((word) => `${folder.path} ${folder.title} ${folder.description}`.toLowerCase().includes(word)))
      .map((folder) => ({
        folder: folder.path, title: folder.title, what_goes_here: folder.description, kind: folder.kind,
        publishing: folder.policy === "direct" ? "published at once" : "each push waits for a reviewer",
        served: folder.headCommit ? `${short(folder.head)} «${folder.headCommit.message}» (${folder.files} files)` : "nothing published yet",
        waiting_review: folder.pending, conflicts: folder.conflicts, active_share_links: folder.shares,
        you_can_push: this.canWrite(this.store.artifactFolder(folder.id), agent),
      }));
  }

  /* ---------- commits ---------- */

  commitSummary(commit) {
    return {
      id: commit.id, short: short(commit.id), folderId: commit.folderId, message: commit.message, author: commit.author, requestedBy: commit.requestedBy || null,
      status: commit.status, createdAt: commit.createdAt, publishedAt: commit.publishedAt || null, review: commit.review || null,
      files: commit.files, bytes: commit.bytes, changes: { added: commit.changes?.added?.count || 0, modified: commit.changes?.modified?.count || 0, deleted: commit.changes?.deleted?.count || 0 },
      base: commit.base || "", parent: commit.parent || "", to: commit.to || "", mirror: Boolean(commit.mirror), conflicts: commit.conflicts || [], rebasedFrom: commit.rebasedFrom || null,
      supersededBy: commit.supersededBy || "",
    };
  }

  /** Whether a proposal goes in as it is, needs its changes laid over a newer head, or clashes with it. */
  mergeability(commit) {
    if (!["proposed", "conflict"].includes(commit.status)) return null;
    const folder = this.store.artifactFolder(commit.folderId);
    const head = folder?.head || "";
    if ((commit.base || "") === head) return { state: "fast-forward", conflicts: [] };
    const merged = mergeTrees(this.treeOf(commit.base), this.treeOf(head), this.readTree(commit.tree));
    return { state: merged.conflicts.length ? "conflict" : "rebase", conflicts: merged.conflicts };
  }

  commitView(id) {
    const commit = this.store.artifactCommit(id);
    if (!commit) throw new ArtifactError("commit non trovato", 404);
    const folder = this.store.artifactFolder(commit.folderId);
    const tree = this.readTree(commit.tree);
    const before = this.treeOf(commit.status === "published" || commit.status === "rejected" || commit.status === "superseded" ? commit.parent : folder?.head || "");
    const delta = treeDelta(before, tree);
    const entry = (path, from, to) => ({ path, before: from ? { sha: from.sha, size: from.size } : null, after: to ? { sha: to.sha, size: to.size } : null });
    return {
      ...this.commitSummary(commit),
      folder: folder ? { id: folder.id, path: folder.path, title: folder.title, head: folder.head || "" } : null,
      comparedWith: commit.status === "proposed" || commit.status === "conflict" ? folder?.head || "" : commit.parent || "",
      mergeability: this.mergeability(commit),
      changed: [
        ...delta.added.map((path) => ({ kind: "added", ...entry(path, null, tree.get(path)) })),
        ...delta.modified.map((path) => ({ kind: "modified", ...entry(path, before.get(path), tree.get(path)) })),
        ...delta.deleted.map((path) => ({ kind: "deleted", ...entry(path, before.get(path), null) })),
      ].slice(0, 1000),
      tree: [...tree.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, file]) => ({ path, sha: file.sha, size: file.size })),
    };
  }

  /** The file at `path` in a commit, or null. */
  fileAt(commitId, path) {
    const commit = this.store.artifactCommit(commitId);
    if (!commit) return null;
    const file = this.readTree(commit.tree).get(path);
    return file ? { ...file, path } : null;
  }

  /** Whether a commit holds this object (a deleted file is still in its parent): what a reviewer may download. */
  commitHolds(commitId, sha) {
    const commit = this.store.artifactCommit(commitId);
    if (!commit) return false;
    for (const id of [commit.id, commit.parent, commit.base, this.store.artifactFolder(commit.folderId)?.head]) {
      if (id && [...this.treeOf(id).values()].some((file) => file.sha === sha)) return true;
    }
    return false;
  }

  /**
   * An agent's push: list the files on its desktop, take over only the ones this
   * folder does not hold yet, and record a commit — proposed, or published at once
   * where the folder says so.
   */
  async push({ agent, folder: folderRef, path, to = "", message = "", mirror = false, create = null, requester = null, channelId = "", traceId = "" }) {
    if (!this.boxes) throw new ArtifactError("there are no desktops here");
    const wanted = String(folderRef || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!validFolderPath(wanted)) throw new ArtifactError("folder must be a path like clienti/acme/report-q3: lowercase words and dashes, up to six levels");
    let folder = this.store.artifactFolderByPath(wanted);
    const prefix = String(to || "").trim().replace(/^\/+|\/+$/g, "");
    if (prefix) cleanTreePath(prefix);
    if (!folder && !create) {
      throw new ArtifactError(`there is no folder ${wanted} yet. Do not choose one on your own: ask the person who asked you which folder to use, proposing this path and what goes in it (artifact_folders lists the existing ones). Once they confirm, push again with create: {title, description}.`, 404);
    }
    if (!folder) {
      if (!requester) throw new ArtifactError("a new folder can be created only while a person is asking you directly: ask them which folder to use, and push when they confirm", 403);
      if (!String(create.description || "").trim()) throw new ArtifactError("create needs a description of what goes in the folder, in the words of the person who confirmed it");
      folder = this.createFolder({
        path: wanted, title: create.title, description: create.description, kind: create.kind,
        createdBy: { kind: "agent", id: agent.id, name: agent.name }, requestedBy: requester,
      });
    }
    if (!this.canWrite(folder, agent)) throw new ArtifactError(`you may not push to ${folder.path}: ask the owner to add you in the folder's permissions`, 403);

    const manifest = await this.boxes.artifactManifest(agent.id, String(path || ""), { maxFiles: LIMITS.files });
    if (manifest.tooMany) throw new ArtifactError(`more than ${LIMITS.files} files: push a smaller folder`, 413);
    if (manifest.refused.length) {
      throw new ArtifactError(`nothing was pushed: these look like secrets and never leave your desktop: ${manifest.refused.slice(0, 10).map((item) => item.path).join(", ")}. Move them out of the folder, or push a subfolder without them.`, 422);
    }
    const files = manifest.files.map((file) => {
      const relative = cleanTreePath(file.path);
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) throw new ArtifactError("the desktop sent an invalid file list");
      if (file.size > LIMITS.fileBytes) throw new ArtifactError(`${relative} is larger than ${LIMITS.fileBytes / 1024 / 1024} MB`, 413);
      return { ...file, path: relative, target: prefix ? `${prefix}/${relative}` : relative };
    });
    if (!files.length) throw new ArtifactError(`nothing to push: no files${manifest.skipped.length ? ` (skipped: ${manifest.skipped.slice(0, 5).map((item) => `${item.path} ${item.why}`).join(", ")})` : ""}`);
    if (new Set(files.map((file) => file.target)).size !== files.length) throw new ArtifactError("two files would land on the same path");
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > LIMITS.pushBytes) throw new ArtifactError(`this push is ${Math.round(total / 1024 / 1024)} MB: at most ${LIMITS.pushBytes / 1024 / 1024} MB at a time`, 413);

    const held = this.heldFor(folder.id, agent.id);
    const seen = new Set();
    const send = files.filter((file) => {
      if ((held.has(file.sha256) && this.hasObject(file.sha256)) || seen.has(file.sha256)) return false;
      seen.add(file.sha256);
      return true;
    });
    const incoming = send.filter((file) => !this.hasObject(file.sha256)).reduce((sum, file) => sum + file.size, 0);
    if (this.store.artifactBytes() + incoming > this.quota) throw new ArtifactError(`the artifacts would pass this server's quota of ${Math.round(this.quota / 1024 / 1024 / 1024)} GB: ask the owner to free space or raise it`, 507);
    try {
      const disk = statfsSync(this.dir);
      if (disk.bavail * disk.bsize - incoming < LIMITS.freeBytes) throw new ArtifactError("the server is running out of disk space: ask the owner", 507);
    } catch (error) {
      if (error instanceof ArtifactError) throw error;
    }
    if (send.length) {
      let writer = null;
      try {
        await this.boxes.artifactSend(agent.id, manifest.root, send.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })), (index) => {
          const file = send[index];
          const inner = this.objectWriter(file);
          writer = inner;
          return {
            write: (chunk) => inner.write(chunk),
            end: () => {
              inner.end();
              writer = null;
              this.store.addArtifactUpload(folder.id, agent.id, file.sha256);
            },
          };
        });
      } finally {
        writer?.abort();
      }
    }

    return this.withLock(folder.id, async () => {
      folder = this.store.artifactFolder(folder.id);
      const pending = this.store.artifactCommits(folder.id, { limit: 50, status: "proposed" })
        .find((commit) => commit.author?.kind === "agent" && commit.author.id === agent.id && (commit.to || "") === prefix);
      const marked = manifest.marker?.folder === folder.id ? this.store.artifactCommit(manifest.marker.commit) : null;
      const base = pending ? pending.base || "" : marked && marked.folderId === folder.id && marked.status === "published" ? marked.id : folder.head || "";
      const start = pending ? this.readTree(pending.tree) : this.treeOf(base);
      const tree = new Map(start);
      if (mirror) for (const key of [...tree.keys()]) if (!prefix || key === prefix || key.startsWith(`${prefix}/`)) tree.delete(key);
      for (const file of files) tree.set(file.target, { sha: file.sha256, size: file.size });
      const changed = treeDelta(start, tree);
      if (!changed.added.length && !changed.modified.length && !changed.deleted.length) {
        return { nothing: true, folder, pending, text: pending ? `nothing new: your proposal ${short(pending.id)} in ${folder.path} already has exactly these files` : `nothing to commit: ${folder.path} already has exactly these files` };
      }
      const delta = treeDelta(this.treeOf(base), tree);
      const secrets = this.scanSecrets(tree, [...delta.added, ...delta.modified]);
      if (secrets.length) throw new ArtifactError(`nothing was published: ${secrets.slice(0, 5).map((hit) => `${hit.path} (line ${hit.line})`).join(", ")} contains what looks like a token or a private key. Remove it and push again.`, 422);
      const now = Date.now();
      const treeSha = this.writeTree(tree);
      const commit = {
        id: `ac_${sha256(`${folder.id}\0${treeSha}\0${base}\0${now}\0${randomBytes(8).toString("hex")}`).slice(0, 12)}`,
        folderId: folder.id, parent: base, base, tree: treeSha, to: prefix, mirror: Boolean(mirror),
        message: String(message || "").trim().slice(0, 300) || `Aggiornamento di ${folder.path}`,
        author: { kind: "agent", id: agent.id, name: agent.name }, requestedBy: requester || null, channelId, traceId,
        status: "proposed", changes: { added: brief(delta.added), modified: brief(delta.modified), deleted: brief(delta.deleted) },
        files: tree.size, bytes: [...tree.values()].reduce((sum, file) => sum + file.size, 0),
        sent: send.reduce((sum, file) => sum + file.size, 0), skipped: manifest.skipped.length, createdAt: now,
        ...(pending ? { supersedes: pending.id } : {}),
      };
      this.store.writeArtifactCommit(commit);
      if (pending) this.store.writeArtifactCommit({ ...pending, status: "superseded", supersededBy: commit.id });
      let published = null;
      if (folder.policy === "direct") published = this.publishLocked(folder, commit, { by: { kind: "agent", id: agent.id, name: agent.name } });
      const final = this.store.artifactCommit(commit.id);
      this.announce(folder, final, { agent, channelId, published: final.status === "published" });
      return { folder, commit: final, published, manifest, send, files };
    });
  }

  /** Room for this many more bytes: the quota, and the disk underneath. */
  roomFor(incoming) {
    if (this.store.artifactBytes() + incoming > this.quota) throw new ArtifactError(`gli artefatti supererebbero lo spazio di questo server (${Math.round(this.quota / 1024 / 1024 / 1024)} GB): libera spazio o alzalo nelle impostazioni`, 507);
    try {
      const disk = statfsSync(this.dir);
      if (disk.bavail * disk.bsize - incoming < LIMITS.freeBytes) throw new ArtifactError("il server sta finendo lo spazio su disco", 507);
    } catch (error) {
      if (error instanceof ArtifactError) throw error;
    }
  }

  /**
   * One file a person uploads from the panel, as it arrives: hashed while it is
   * written, kept under its hash, and remembered as theirs for this folder.
   */
  async receive(folderId, user, body, size) {
    const folder = this.store.artifactFolder(folderId);
    if (!folder) throw new ArtifactError("cartella non trovata", 404);
    if (!Number.isSafeInteger(size) || size < 0) throw new ArtifactError("serve la dimensione del file (Content-Length)", 411);
    if (size > LIMITS.fileBytes) throw new ArtifactError(`un file può essere al massimo di ${LIMITS.fileBytes / 1024 / 1024} MB`, 413);
    this.roomFor(size);
    const temporary = join(this.dir, "tmp", randomBytes(12).toString("hex"));
    const fd = openSync(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let written = 0;
    try {
      for await (const chunk of body) {
        written += chunk.length;
        if (written > size) throw new ArtifactError("il file è più grande di quanto annunciato", 400);
        hash.update(chunk);
        writeSync(fd, chunk);
      }
      if (written !== size) throw new ArtifactError("il file è arrivato a metà: riprova", 400);
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(temporary, { force: true });
      throw error;
    }
    closeSync(fd);
    const sha = hash.digest("hex");
    const target = this.objectPath(sha);
    if (existsSync(target)) rmSync(temporary, { force: true });
    else {
      mkdirSync(join(this.dir, "objects", sha.slice(0, 2)), { recursive: true, mode: 0o700 });
      renameSync(temporary, target);
    }
    this.store.addArtifactObject(sha, size);
    this.store.addArtifactUpload(folder.id, `user:${user.id}`, sha);
    return { sha, size };
  }

  /**
   * Files uploaded from the panel become a commit, laid at the path the person was
   * looking at. A reviewer of the folder publishes it at once; anyone else proposes it.
   */
  async commitUpload(folderId, { user, dir = "", base, files, message = "" }) {
    const folder = this.store.artifactFolder(folderId);
    if (!folder) throw new ArtifactError("cartella non trovata", 404);
    const prefix = String(dir || "").trim().replace(/^\/+|\/+$/g, "");
    if (prefix) cleanTreePath(prefix);
    if (!Array.isArray(files) || !files.length) throw new ArtifactError("nessun file da caricare");
    if (files.length > LIMITS.files) throw new ArtifactError(`al massimo ${LIMITS.files} file alla volta`, 413);
    const held = this.heldFor(folder.id, `user:${user.id}`);
    const placed = files.map((file) => {
      const target = cleanTreePath(prefix ? `${prefix}/${file.path}` : String(file.path || ""));
      const sha = String(file.sha || "");
      if (!/^[a-f0-9]{64}$/.test(sha) || !held.has(sha) || !this.hasObject(sha)) throw new ArtifactError(`${target} non è arrivato: caricalo di nuovo`, 409);
      return { target, sha, size: statSync(this.objectPath(sha)).size };
    });
    if (new Set(placed.map((file) => file.target)).size !== placed.length) throw new ArtifactError("due file finirebbero sullo stesso percorso");
    if (placed.reduce((sum, file) => sum + file.size, 0) > LIMITS.pushBytes) throw new ArtifactError(`al massimo ${LIMITS.pushBytes / 1024 / 1024} MB alla volta`, 413);
    const by = { kind: "user", id: user.id, name: user.name || user.email || "Owner" };
    const review = this.canReview(folder, user);
    return this.withLock(folder.id, async () => {
      const current = this.store.artifactFolder(folder.id);
      const known = base === undefined || base === null ? current.head || "" : String(base);
      if (known && this.store.artifactCommit(known)?.folderId !== folder.id) throw new ArtifactError("versione di partenza sconosciuta", 409);
      const start = this.treeOf(known);
      const tree = new Map(start);
      for (const file of placed) tree.set(file.target, { sha: file.sha, size: file.size });
      const delta = treeDelta(start, tree);
      if (!delta.added.length && !delta.modified.length) throw new ArtifactError("questi file ci sono già, uguali", 409);
      const secrets = this.scanSecrets(tree, [...delta.added, ...delta.modified]);
      if (secrets.length) throw new ArtifactError(`${secrets.slice(0, 5).map((hit) => `${hit.path} (riga ${hit.line})`).join(", ")} contiene qualcosa che sembra un token o una chiave privata: i segreti vanno nella cassaforte, non in una cartella`, 422);
      const now = Date.now();
      const treeSha = this.writeTree(tree);
      const count = delta.added.length + delta.modified.length;
      const commit = {
        id: `ac_${sha256(`${folder.id}\0${treeSha}\0${known}\0${now}\0${randomBytes(8).toString("hex")}`).slice(0, 12)}`,
        folderId: folder.id, parent: known, base: known, tree: treeSha, to: prefix, mirror: false,
        message: String(message || "").trim().slice(0, 300) || (count === 1 ? `Caricato ${placed[0].target}` : `Caricati ${count} file${prefix ? ` in ${prefix}` : ""}`),
        author: by, requestedBy: null, channelId: "", traceId: "",
        status: "proposed", changes: { added: brief(delta.added), modified: brief(delta.modified), deleted: brief(delta.deleted) },
        files: tree.size, bytes: [...tree.values()].reduce((sum, file) => sum + file.size, 0),
        sent: placed.reduce((sum, file) => sum + file.size, 0), skipped: 0, createdAt: now, uploaded: true,
      };
      this.store.writeArtifactCommit(commit);
      const result = review ? this.publishLocked(current, commit, { by }) : null;
      const final = this.store.artifactCommit(commit.id);
      if (final.status === "published") this.log({ type: "artifact", text: `${by.name} ha caricato ${count} file in ${folder.path} (${short(final.id)})` });
      else if (final.status === "proposed") {
        this.log({ type: "artifact", text: `${by.name} propone ${count} file in ${folder.path} (${short(final.id)}): da rivedere` });
        this.webPush?.notify({ title: `Artefatti · ${folder.path}`, body: `${by.name} propone: ${final.message}`, url: `/#/artefatti/${folder.id}/c/${final.id}`, tag: `artifact-${final.id}` }).catch?.(() => {});
      }
      return { ...(result || {}), commit: this.commitView(final.id) };
    });
  }

  /** Turns a push's result into what the agent reads: it must not mistake a proposal for a publication. */
  pushReceipt(result) {
    if (result.nothing) return result.text;
    const { folder, commit, manifest, send } = result;
    const counts = `${commit.changes.added.count} added, ${commit.changes.modified.count} changed, ${commit.changes.deleted.count} deleted; ${commit.files} files in the folder`;
    const status = commit.status === "published"
      ? `PUBLISHED: ${folder.path} now serves commit ${short(commit.id)}.`
      : commit.status === "conflict"
        ? `CONFLICT: commit ${short(commit.id)} clashes with what was published meanwhile (${commit.conflicts.slice(0, 5).join(", ")}). Pull the folder with artifact_pull, redo your change on top and push again.`
        : `PROPOSED, waiting for review by ${this.reviewerNames(folder)}: it is NOT served yet. Do not say it is published.`;
    const lines = [
      status,
      `commit ${short(commit.id)} «${commit.message}» — ${counts}.`,
      `sent ${send.length} file(s), ${Math.round(commit.sent / 1024)} KB; the rest the server already had.`,
      manifest.skipped.length ? `skipped: ${manifest.skipped.slice(0, 8).map((item) => `${item.path} (${item.why})`).join(", ")}${manifest.skipped.length > 8 ? "…" : ""}` : "",
      commit.supersedes ? `it replaces your earlier proposal ${short(commit.supersedes)}, which nobody had reviewed yet.` : "",
      this.instanceUrl ? `panel: ${this.instanceUrl}/#/artefatti/${folder.id}/c/${commit.id}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  reviewerNames(folder) {
    const names = (folder.reviewers || []).map((id) => this.store.panelUser(id)?.name).filter(Boolean);
    return ["the owner", ...names].join(", ");
  }

  /** Token shapes and private keys in the text files a commit brings in: line numbers, never the values. */
  scanSecrets(tree, paths) {
    const hits = [];
    for (const path of paths) {
      const file = tree.get(path);
      if (!file || file.size > SCAN_BYTES) continue;
      const data = this.readObject(file.sha);
      if (!data || data.subarray(0, 8192).includes(0)) continue;
      const lines = data.toString("utf8").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        SECRET_SHAPES.lastIndex = 0;
        if (SECRET_SHAPES.test(lines[index]) || PRIVATE_KEY.test(lines[index])) {
          hits.push({ path, line: index + 1 });
          break;
        }
      }
      SECRET_SHAPES.lastIndex = 0;
    }
    return hits;
  }

  /**
   * Moves the head to a commit: at once when it was made on the current head,
   * otherwise its changes are laid over the head, unless both touched the same file.
   */
  publishLocked(folder, commit, { by, note = "", force = false }) {
    const head = folder.head || "";
    const next = { ...commit };
    if ((commit.base || "") !== head) {
      const merged = mergeTrees(this.treeOf(commit.base), this.treeOf(head), this.readTree(commit.tree), { force });
      if (merged.conflicts.length) {
        const conflicted = { ...commit, status: "conflict", conflicts: merged.conflicts };
        this.store.writeArtifactCommit(conflicted);
        return { conflict: merged.conflicts };
      }
      const tree = this.writeTree(merged.tree);
      const delta = treeDelta(this.treeOf(head), merged.tree);
      Object.assign(next, {
        rebasedFrom: { base: commit.base || "", tree: commit.tree, forced: merged.forced },
        base: head, parent: head, tree,
        changes: { added: brief(delta.added), modified: brief(delta.modified), deleted: brief(delta.deleted) },
        files: merged.tree.size, bytes: [...merged.tree.values()].reduce((sum, file) => sum + file.size, 0),
      });
    }
    if (!this.store.moveArtifactHead(folder.id, head, next.id)) throw new ArtifactError("la cartella è cambiata nel frattempo: riprova", 409);
    Object.assign(next, { status: "published", publishedAt: Date.now(), conflicts: [], review: { by, at: Date.now(), note: String(note || "").slice(0, 500), decision: force ? "force" : "approve" } });
    this.store.writeArtifactCommit(next);
    return { published: next.id };
  }

  /** A reviewer's decision on a proposal: approve (publish), force (publish over a conflict) or reject. */
  async review(commitId, { decision, note = "", user }) {
    const found = this.store.artifactCommit(commitId);
    if (!found) throw new ArtifactError("commit non trovato", 404);
    const folder = this.store.artifactFolder(found.folderId);
    if (!this.canReview(folder, user)) throw new ArtifactError("decidono sui commit solo il proprietario e i revisori di questa cartella", 403);
    if (!["approve", "reject", "force"].includes(decision)) throw new ArtifactError("la decisione è approve, reject o force");
    const by = { kind: "user", id: user.id, name: user.name || user.email || "Owner" };
    const result = await this.withLock(folder.id, async () => {
      const commit = this.store.artifactCommit(commitId);
      if (!["proposed", "conflict"].includes(commit.status)) throw new ArtifactError(`questo commit è già ${({ published: "pubblicato", rejected: "rifiutato", superseded: "sostituito" })[commit.status] || commit.status}`, 409);
      const current = this.store.artifactFolder(folder.id);
      if (decision === "reject") {
        this.store.writeArtifactCommit({ ...commit, status: "rejected", review: { by, at: Date.now(), note: String(note || "").slice(0, 500), decision } });
        return { rejected: true };
      }
      return this.publishLocked(current, commit, { by, note, force: decision === "force" });
    });
    const commit = this.store.artifactCommit(commitId);
    this.announceReview(folder, commit, { by, note, result });
    return { ...result, commit: this.commitView(commitId) };
  }

  /** Publishes an older version again as a new commit on top of the current head. */
  async restore(folderId, commitId, user) {
    const folder = this.store.artifactFolder(folderId);
    if (!folder) throw new ArtifactError("cartella non trovata", 404);
    if (!this.canReview(folder, user)) throw new ArtifactError("ripristinano una versione solo il proprietario e i revisori della cartella", 403);
    const target = this.store.artifactCommit(commitId);
    if (!target || target.folderId !== folderId || target.status !== "published") throw new ArtifactError("si può ripristinare solo una versione che è stata pubblicata", 404);
    const by = { kind: "user", id: user.id, name: user.name || user.email || "Owner" };
    return this.withLock(folderId, async () => {
      const current = this.store.artifactFolder(folderId);
      const head = current.head || "";
      if (head === target.id) throw new ArtifactError("questa versione è già quella servita", 409);
      const tree = this.readTree(target.tree);
      const delta = treeDelta(this.treeOf(head), tree);
      const now = Date.now();
      const commit = {
        id: `ac_${sha256(`${folderId}\0${target.tree}\0${head}\0${now}\0${randomBytes(8).toString("hex")}`).slice(0, 12)}`,
        folderId, parent: head, base: head, tree: target.tree, to: "", mirror: true,
        message: `Ripristinata la versione ${short(target.id)}`, author: by, requestedBy: null, channelId: "", traceId: "",
        status: "proposed", changes: { added: brief(delta.added), modified: brief(delta.modified), deleted: brief(delta.deleted) },
        files: tree.size, bytes: target.bytes, sent: 0, skipped: 0, createdAt: now, restoredFrom: target.id,
      };
      this.store.writeArtifactCommit(commit);
      this.publishLocked(current, commit, { by, note: "" });
      this.log({ type: "artifact", text: `${by.name} ha ripristinato ${folder.path} alla versione ${short(target.id)}` });
      return this.commitView(commit.id);
    });
  }

  /** Brings a folder's served version (or a given commit) onto an agent's desktop. */
  async pull({ agent, folder: folderRef, commit: commitRef = "", overwrite = false }) {
    if (!this.boxes) throw new ArtifactError("there are no desktops here");
    const folder = this.findFolder(folderRef);
    if (!folder) throw new ArtifactError("no such folder: list them with artifact_folders", 404);
    const wanted = commitRef ? this.store.artifactCommit(String(commitRef).startsWith("ac_") ? commitRef : `ac_${commitRef}`) || this.store.artifactCommits(folder.id).find((item) => item.id.startsWith(`ac_${commitRef}`)) : null;
    const commit = commitRef ? wanted : folder.head ? this.store.artifactCommit(folder.head) : null;
    if (!commit || commit.folderId !== folder.id) throw new ArtifactError(commitRef ? "no such commit in this folder" : `${folder.path} has nothing published yet`, 404);
    if (commit.status === "rejected") throw new ArtifactError("that commit was rejected");
    const tree = this.readTree(commit.tree);
    const files = [...tree.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, file]) => ({ path, size: file.size, read: () => this.stream(file.sha) }));
    const result = await this.boxes.artifactCheckout(agent.id, folder.path, files, { overwrite, marker: { folder: folder.id, path: folder.path, commit: commit.id } });
    return `pulled ${folder.path} at commit ${short(commit.id)} «${commit.message}» into ${result.path} (${result.files} files). Work there and push the folder back with artifact_push: your changes are laid over whatever is published by then.`;
  }

  /** A folder's history as an agent reads it. */
  history(folderRef, limit = 20) {
    const folder = this.findFolder(folderRef);
    if (!folder) throw new ArtifactError("no such folder: list them with artifact_folders", 404);
    return {
      folder: folder.path, served: folder.head ? short(folder.head) : null,
      commits: this.store.artifactCommits(folder.id, { limit: Math.min(50, Math.max(1, Number(limit) || 20)) }).map((commit) => ({
        commit: short(commit.id), status: commit.status, message: commit.message, by: commit.author?.name, at: new Date(commit.createdAt).toISOString(),
        changes: `+${commit.changes?.added?.count || 0} ~${commit.changes?.modified?.count || 0} -${commit.changes?.deleted?.count || 0}`,
        ...(commit.review ? { review: `${commit.review.decision} by ${commit.review.by?.name}${commit.review.note ? `: ${commit.review.note}` : ""}` } : {}),
        ...(commit.conflicts?.length ? { conflicts: commit.conflicts.slice(0, 10) } : {}),
      })),
    };
  }

  /** Pending reviews a panel user can act on: the count beside Artefatti. */
  reviewsFor(user) {
    const folders = new Map(this.store.artifactFolders().map((folder) => [folder.id, folder]));
    return [...this.store.artifactCommitsByStatus("proposed"), ...this.store.artifactCommitsByStatus("conflict")]
      .filter((commit) => folders.has(commit.folderId) && this.canReview(folders.get(commit.folderId), user));
  }

  /* ---------- shares ---------- */

  shareUrl(label) {
    return this.shareSuffix ? `https://${label}${this.shareSuffix}/` : "";
  }

  /** A commit's own address, for reviewers: a site there works with its absolute paths. */
  previewUrl(commitId) {
    return this.shareSuffix && /^ac_[a-f0-9]{12}$/.test(commitId) ? `https://p-${commitId.slice(3)}${this.shareSuffix}/` : "";
  }

  /**
   * Who may open a share: anyone with the link (public), anyone with its password, or
   * named people (addresses, company domains, the space's own people). A password is
   * kept only as a scrypt hash; changing who may enter is done by updateShare.
   */
  cleanAccess(access = {}, previous = null) {
    const mode = SHARE_MODES.includes(access.mode) ? access.mode : "people";
    if (mode === "public") return { mode, emails: [], domains: [], members: false };
    if (mode === "password") {
      const given = String(access.password ?? "");
      if (given) {
        if (given.length < 6 || given.length > 200) throw new ArtifactError("la password di un link è lunga almeno 6 caratteri");
        return { mode, emails: [], domains: [], members: false, password: hashPassword(given) };
      }
      if (previous?.mode === "password" && previous.password) return { mode, emails: [], domains: [], members: false, password: previous.password };
      throw new ArtifactError("scegli la password del link");
    }
    const emails = [...new Set((Array.isArray(access.emails) ? access.emails : String(access.emails || "").split(/[\s,;]+/)).map(cleanEmail).filter(Boolean))];
    const domains = [...new Set((Array.isArray(access.domains) ? access.domains : String(access.domains || "").split(/[\s,;]+/)).map(cleanDomain).filter(Boolean))];
    const bad = emails.find((email) => !EMAIL.test(email));
    if (bad) throw new ArtifactError(`${bad} non è un indirizzo email`);
    const badDomain = domains.find((domain) => !DOMAIN.test(domain));
    if (badDomain) throw new ArtifactError(`${badDomain} non è un dominio`);
    const webmail = domains.find((domain) => WEBMAIL.has(domain));
    if (webmail) throw new ArtifactError(`${webmail} è di tutti: autorizza gli indirizzi uno per uno`);
    if (emails.length > 200 || domains.length > 50) throw new ArtifactError("troppi indirizzi per un solo link");
    const members = access.members === true;
    if (!emails.length && !domains.length && !members) throw new ArtifactError("aggiungi almeno un indirizzo, un dominio o il team di questo spazio, oppure rendi il link pubblico o con password");
    return { mode, emails, domains, members };
  }

  /** Whether a password opens a password share. */
  passwordOpens(share, password) {
    const stored = share?.access?.mode === "password" ? share.access.password : null;
    if (!stored) return false;
    const given = Buffer.from(hashPassword(password, stored.salt).hash, "hex");
    const expected = Buffer.from(stored.hash, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  validLabel(label) {
    const value = String(label || "").trim().toLowerCase();
    if (!SHARE_LABEL.test(value) || value.length < 3 || value.includes("--") || value.startsWith("xn") || PREVIEW_LABEL.test(value)) {
      throw new ArtifactError("il nome del link è fatto di almeno tre lettere, cifre o trattini singoli");
    }
    const space = this.shareSuffix.replace(/^--/, "").split(".")[0];
    if (`${value}--${space}`.length > 63) throw new ArtifactError("il nome del link è troppo lungo per questo spazio");
    return value;
  }

  shareView(share) {
    const folder = this.store.artifactFolder(share.folderId);
    const { password, ...access } = share.access || {};
    return { ...share, access: { mode: "people", ...access }, url: this.shareUrl(share.label), folderPath: folder?.path || "", expired: Boolean(share.expiresAt && share.expiresAt < Date.now()) };
  }

  /** A link that opens a folder on an address of its own: public, behind a password, or for the people it names. */
  createShare(folderId, { label, view, access, commit = "", expiresAt = 0, status = "active", createdBy, requestedBy = null, reason = "" }) {
    if (!this.shareSuffix) throw new ArtifactError("i link di condivisione esistono solo per gli spazi su usecora.space", 409);
    const folder = this.store.artifactFolder(folderId);
    if (!folder) throw new ArtifactError("cartella non trovata", 404);
    const clean = this.validLabel(label);
    if (this.store.artifactShareByLabel(clean)) throw new ArtifactError(`il link ${clean} esiste già`, 409);
    if (commit) {
      const pinned = this.store.artifactCommit(commit);
      if (!pinned || pinned.folderId !== folderId || pinned.status !== "published") throw new ArtifactError("si fissa solo una versione pubblicata di questa cartella");
    }
    const now = Date.now();
    const share = {
      id: `as_${randomBytes(6).toString("hex")}`, label: clean, folderId, view: view === "files" ? "files" : view === "site" ? "site" : folder.kind,
      access: this.cleanAccess(access), commit: commit || "", expiresAt: Number(expiresAt) || 0, status, revision: 1,
      createdBy: createdBy || null, approvedBy: status === "active" ? createdBy || null : null, requestedBy, reason: String(reason || "").slice(0, 500), createdAt: now, updatedAt: now,
    };
    this.store.writeArtifactShare(share);
    this.log({ type: "artifact", text: status === "proposed" ? `${createdBy?.name || "un agente"} chiede un link per ${folder.path}: ${clean}` : `nuovo link ${clean} per ${folder.path}` });
    return this.shareView(share);
  }

  /** Who may enter, what it shows, until when: any change of access closes the doors already open. */
  updateShare(id, changes, user) {
    const share = this.store.artifactShare(id);
    if (!share) throw new ArtifactError("link non trovato", 404);
    const next = { ...share, updatedAt: Date.now() };
    if (changes.access !== undefined) { next.access = this.cleanAccess(changes.access, share.access); next.revision += 1; }
    if (changes.view !== undefined) next.view = changes.view === "files" ? "files" : "site";
    if (changes.expiresAt !== undefined) { next.expiresAt = Number(changes.expiresAt) || 0; next.revision += 1; }
    if (changes.commit !== undefined) {
      if (changes.commit) {
        const pinned = this.store.artifactCommit(changes.commit);
        if (!pinned || pinned.folderId !== share.folderId || pinned.status !== "published") throw new ArtifactError("si fissa solo una versione pubblicata di questa cartella");
      }
      next.commit = changes.commit || "";
    }
    if (changes.status === "revoked") { next.status = "revoked"; next.revision += 1; }
    if (changes.status === "active" && share.status === "proposed") { next.status = "active"; next.approvedBy = { id: user.id, name: user.name || user.email || "Owner" }; }
    this.store.writeArtifactShare(next);
    return this.shareView(next);
  }

  /** What a host under this space's share suffix stands for: a share, a commit's preview, or nothing. */
  resolveHost(label) {
    const preview = PREVIEW_LABEL.exec(String(label || ""));
    if (preview) {
      const commit = this.store.artifactCommit(`ac_${preview[1]}`);
      const folder = commit ? this.store.artifactFolder(commit.folderId) : null;
      return commit && folder && commit.status !== "superseded" ? { kind: "preview", folder, commit, scope: `preview:${commit.id}`, revision: 1, view: folder.kind } : null;
    }
    const share = this.store.artifactShareByLabel(String(label || ""));
    if (!share || share.status !== "active" || (share.expiresAt && share.expiresAt < Date.now())) return null;
    const folder = this.store.artifactFolder(share.folderId);
    const commit = folder ? this.store.artifactCommit(share.commit || folder.head) : null;
    if (!folder) return null;
    return { kind: "share", share, folder, commit, scope: share.id, revision: share.revision, view: share.view };
  }

  /** Someone who comes in through the space itself: a person it already admits, or would. */
  isMember(email) {
    const address = cleanEmail(email);
    if (!EMAIL.test(address)) return false;
    if (this.store.panelUsers().some((user) => !user.blocked && cleanEmail(user.email) === address)) return true;
    return this.store.allowsPanelUser({ id: `share:${address}`, email: address, emailVerified: true, role: "member" });
  }

  /**
   * Whether a verified address may open what a host shows. A whole domain counts only
   * when the mailbox itself was proven (a link sent there) or Google says the account
   * belongs to that domain's Workspace: a personal Google account under a company
   * address outlives the job.
   */
  allows(target, { email, hd = "", via = "" }) {
    if (target.kind === "share" && target.share.access.mode === "public") return true;
    if (target.kind === "share" && target.share.access.mode === "password") return via === "password";
    const address = cleanEmail(email);
    if (!EMAIL.test(address) || !["google", "email"].includes(via)) return false;
    if (target.kind === "preview") {
      return this.store.panelUsers().some((user) => !user.blocked && cleanEmail(user.email) === address && this.canReview(target.folder, user));
    }
    const access = { emails: [], domains: [], ...target.share.access };
    const domain = address.split("@")[1];
    if (access.emails.includes(address)) return true;
    if (access.domains.includes(domain) && (via === "email" || (via === "google" && String(hd).toLowerCase() === domain))) return true;
    return Boolean(access.members && this.isMember(address));
  }

  /** The file a path asks for in a tree, as a site or a folder of files reads it. */
  resolvePath(tree, rawPath, view) {
    let path;
    try { path = decodeURIComponent(rawPath); } catch { return { status: 400 }; }
    if (path.includes("\0") || path.includes("\\")) return { status: 400 };
    const clean = path.replace(/^\/+/, "");
    const parts = clean.split("/");
    if (parts.some((part, index) => part === "." || part === ".." || (!part && index < parts.length - 1))) return { status: 404 };
    const encoded = (value) => `/${value.split("/").map(encodeURIComponent).join("/")}`;
    const isDir = (prefix) => [...tree.keys()].some((key) => key.startsWith(prefix));
    if (view === "files") {
      if (!clean || clean.endsWith("/")) return isDir(clean) || !clean ? { listing: clean } : { status: 404 };
      if (tree.has(clean)) return { file: { path: clean, ...tree.get(clean) } };
      if (isDir(`${clean}/`)) return { redirect: `${encoded(clean)}/` };
      return { status: 404 };
    }
    if (!clean || clean.endsWith("/")) {
      const index = `${clean}index.html`;
      return tree.has(index) ? { file: { path: index, ...tree.get(index) } } : { status: 404 };
    }
    if (tree.has(clean)) return { file: { path: clean, ...tree.get(clean) } };
    if (tree.has(`${clean}/index.html`)) return { redirect: `${encoded(clean)}/` };
    if (tree.has(`${clean}.html`)) return { file: { path: `${clean}.html`, ...tree.get(`${clean}.html`) } };
    return { status: 404 };
  }

  /* ---------- notices ---------- */

  announce(folder, commit, { agent, channelId, published }) {
    const what = `${commit.changes.added.count + commit.changes.modified.count + commit.changes.deleted.count} file`;
    const link = this.instanceUrl ? `${this.instanceUrl}/#/artefatti/${folder.id}/c/${commit.id}` : "";
    if (published) {
      this.log({ type: "artifact", agentId: agent.id, text: `${agent.name} ha pubblicato ${what} in ${folder.path} (${short(commit.id)})` });
      return;
    }
    this.log({ type: "artifact", agentId: agent.id, text: `${agent.name} propone ${what} in ${folder.path} (${short(commit.id)}): da rivedere` });
    this.webPush?.notify({ title: `Artefatti · ${folder.path}`, body: `${agent.name} propone: ${commit.message}`, url: `/#/artefatti/${folder.id}/c/${commit.id}`, tag: `artifact-${commit.id}` }).catch?.(() => {});
    if (channelId && this.notice) {
      const text = `📦 ${agent.name} ha proposto «${commit.message}» in **${folder.path}** (${short(commit.id)}): aspetta una revisione.${link ? ` ${link}` : ""}`;
      Promise.resolve(this.notice(channelId, text)).catch(() => {});
    }
  }

  /** An agent asked for a link: the owner hears about it, the conversation sees it is not on yet. */
  announceShare(folder, share, { agent, channelId }) {
    this.webPush?.notify({ title: `Artefatti · ${folder.path}`, body: `${agent.name} chiede un link: ${share.label}`, url: `/#/artefatti/${folder.id}/condivisione`, tag: `share-${share.id}` }).catch?.(() => {});
    if (channelId && this.notice) Promise.resolve(this.notice(channelId, `🔗 Richiesta di un link per **${folder.path}** (${share.label}) da ${agent.name}: si apre quando il proprietario lo attiva.`)).catch(() => {});
  }

  announceReview(folder, commit, { by, note, result }) {
    const verb = result.rejected ? "rifiutato" : result.conflict ? "non pubblicato (conflitto)" : "pubblicato";
    this.log({ type: "artifact", text: `${by.name} ha ${verb} ${short(commit.id)} in ${folder.path}` });
    if (!commit.channelId || !this.notice) return;
    // The author is named in passing: a notice must not read as a call to the agent.
    const of = commit.author?.kind === "agent" ? ` di ${commit.author.name}` : "";
    const detail = result.conflict ? ` I file in conflitto: ${result.conflict.slice(0, 5).join(", ")}.` : "";
    const text = `📦 ${by.name} ha ${verb} «${commit.message}»${of} in **${folder.path}** (${short(commit.id)}).${note ? ` Nota: ${note}` : ""}${detail}`;
    Promise.resolve(this.notice(commit.channelId, text)).catch(() => {});
  }

  /**
   * The company brain's page on where things go: the folder catalog, rewritten only
   * when a folder is created, changed or removed — commits never touch it.
   */
  syncBrain() {
    if (!this.companyBrain?.enabled) return Promise.resolve();
    const folders = this.store.artifactFolders();
    const body = folders.length
      ? folders.map((folder) => [
        `- **${folder.path}** — ${folder.title}${folder.kind === "site" ? " (sito)" : ""}`,
        folder.description ? `  Cosa ci va: ${folder.description}` : "",
        `  ${folder.policy === "direct" ? "Si pubblica subito" : "Ogni push aspetta una revisione"}; possono caricare: ${folder.writers.includes("*") ? "tutti gli agenti" : folder.writers.map((id) => this.store.agent(id)?.name).filter(Boolean).join(", ") || "nessun agente"}.`,
        folder.requestedBy?.name ? `  Decisa con ${folder.requestedBy.name}.` : "",
      ].filter(Boolean).join("\n")).join("\n")
      : "Ancora nessuna cartella.";
    const text = [
      "Dove vanno i file, i siti e gli altri artefatti che gli agenti caricano dai loro computer con artifact_push.",
      "Prima di caricare qualcosa guarda qui o con artifact_folders. Se nessuna cartella va bene, chiedi alla persona quale usare, proponendo un percorso, e creala solo dopo la sua conferma.",
      "",
      body,
    ].join("\n");
    this.brainSync = (this.brainSync || Promise.resolve()).then(() => this.companyBrain.write({
      slug: BRAIN_SLUG, kind: "procedure", title: "Artefatti: dove vanno i file",
      summary: `Le cartelle degli artefatti (${folders.length}) e cosa ci va.`, body: text.slice(0, 8000),
      author: "cora", review: "approved", note: "catalogo delle cartelle degli artefatti",
    })).catch((error) => this.log({ type: "warning", text: `brain: pagina degli artefatti non aggiornata: ${error.message}` }));
    return this.brainSync;
  }

  /* ---------- housekeeping ---------- */

  /** Removes files no commit points at any more, once they are older than the backups. */
  collect() {
    const keep = new Set();
    for (const tree of this.store.artifactTrees()) {
      keep.add(tree);
      try {
        for (const file of this.readTree(tree).values()) keep.add(file.sha);
      } catch {}
    }
    const cutoff = Date.now() - GC_GRACE_MS;
    let removed = 0;
    for (const object of this.store.artifactObjects()) {
      if (keep.has(object.sha) || object.createdAt > cutoff) continue;
      try { unlinkSync(this.objectPath(object.sha)); } catch {}
      this.store.removeArtifactObject(object.sha);
      this.trees.delete(object.sha);
      removed += 1;
    }
    return removed;
  }
}
