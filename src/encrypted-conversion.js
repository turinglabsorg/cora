import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { cleanTreePath } from "./artifacts.js";

const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const hash = value => createHash("sha256").update(value).digest("hex");
const parse = row => row ? JSON.parse(row.data) : null;
const CHUNK = 512 * 1024;
export class EncryptedConversion {
  constructor(encrypted) {
    this.encrypted = encrypted;
    this.store = encrypted.store;
    this.store.db.exec("CREATE TABLE IF NOT EXISTS encrypted_conversions (id TEXT PRIMARY KEY, folder TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS encrypted_conversions_expiry ON encrypted_conversions(expires); CREATE INDEX IF NOT EXISTS encrypted_conversions_folder ON encrypted_conversions(folder);");
  }
  get artifacts() { return this.encrypted.artifacts; }
  directory(id) { return join(this.artifacts.dir, "tmp", id); }
  save(record) { this.store.db.prepare("INSERT INTO encrypted_conversions(id,folder,owner,expires,data) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(record.id, record.folder, record.owner, record.expires, JSON.stringify(record)); }
  prune() {
    for (const row of this.store.db.prepare("SELECT id FROM encrypted_conversions WHERE expires < ?").all(Date.now())) {
      rmSync(this.directory(row.id), { recursive: true, force: true });
      this.store.db.prepare("DELETE FROM encrypted_conversions WHERE id = ?").run(row.id);
    }
  }
  record(folder, user, id) {
    this.prune();
    const record = parse(this.store.db.prepare("SELECT data FROM encrypted_conversions WHERE id = ? AND folder = ? AND owner = ?").get(id, folder, user.id));
    if (!record || !this.store.artifactFolder(folder)) fail(404, "Conversione non disponibile.");
    return record;
  }
  snapshot(folder) {
    const values = [this.store.db.prepare("SELECT data FROM encrypted_folders WHERE id = ?").get(folder)?.data || ""];
    for (const table of ["encrypted_documents", "encrypted_requests", "encrypted_inbox", "encrypted_folder_grants", "encrypted_file_uploads"]) values.push(this.store.db.prepare(`SELECT data FROM ${table} WHERE folder = ? ORDER BY rowid`).all(folder));
    return hash(JSON.stringify(values));
  }
  allowed(folder, user) {
    this.encrypted.folder(folder, user, "owner");
    if (this.encrypted.enabled) fail(409, "Disattiva l’obbligo di cifratura prima di salvare in chiaro.");
    if (this.store.db.prepare("SELECT 1 FROM encrypted_requests WHERE folder = ? AND state IN ('pending','running') LIMIT 1").get(folder)) fail(409, "Termina o revoca gli accessi temporanei prima di rimuovere la cifratura.");
    if (this.store.db.prepare("SELECT 1 FROM encrypted_file_uploads WHERE folder = ? AND state = 'pending' LIMIT 1").get(folder)) fail(409, "Completa o annulla i caricamenti prima di rimuovere la cifratura.");
    if (this.store.db.prepare("SELECT 1 FROM encrypted_inbox WHERE folder = ? LIMIT 1").get(folder)) fail(409, "Accetta o rifiuta le copie ricevute prima di rimuovere la cifratura.");
    if (this.store.db.prepare("SELECT 1 FROM encrypted_folder_grants WHERE json_extract(data, '$.target') = ? LIMIT 1").get(folder)) fail(409, "Questa cartella protegge accessi ad altre cartelle cifrate. Sposta o rinuncia a quegli accessi prima della conversione.");
    const base = this.store.artifactFolder(folder);
    if (base.head || this.store.artifactCommits(folder, { limit: 1 }).length) fail(409, "La cartella contiene già versioni in chiaro.");
  }
  start(folderId, user, input) {
    this.allowed(folderId, user);
    if (input.confirm !== true) fail(400, "Conferma la conversione in chiaro.");
    const authorization = this.encrypted.prove(this.encrypted.folder(folderId, user, "owner"), user, input.proof, "decrypt");
    this.prune();
    for (const row of this.store.db.prepare("SELECT id FROM encrypted_conversions WHERE folder = ? AND owner = ?").all(folderId, user.id)) this.cancel(folderId, user, row.id);
    const record = this.store.tx(() => {
      this.allowed(folderId, user);
      if (this.encrypted.folder(folderId, user, "owner").revision !== authorization.revision) fail(409, "La cartella cifrata è cambiata. Riprova senza perdere i dati originali.");
      const sources = this.store.db.prepare("SELECT data FROM encrypted_documents WHERE folder = ?").all(folderId).map(parse).map(doc => ({ type: "document", id: doc.id, version: doc.version, kind: doc.kind, at: doc.at }));
      for (const row of this.store.db.prepare("SELECT data FROM encrypted_requests WHERE folder = ?").all(folderId)) {
        const req = parse(row);
        if (req.result) sources.push({ type: "result", id: req.id, version: 0, kind: "reasoning", at: req.finishedAt || req.expires });
      }
      sources.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id) || a.version - b.version);
      const record = { id: "dc_" + randomBytes(16).toString("hex"), folder: folderId, owner: user.id, expires: Date.now() + 3600000, snapshot: this.snapshot(folderId), sources, items: {}, bytes: 0 };
      this.save(record);
      return record;
    });
    mkdirSync(this.directory(record.id), { recursive: true, mode: 0o700 });
    return { id: record.id, sources: record.sources };
  }
  source(folder, user, id, index) {
    const record = this.record(folder, user, id);
    this.encrypted.folder(folder, user, "owner");
    const source = record.sources[index];
    if (!Number.isInteger(index) || !source) fail(404, "Versione non disponibile.");
    if (source.type === "document") return this.encrypted.document(folder, source.id, source.version);
    const req = parse(this.store.db.prepare("SELECT data FROM encrypted_requests WHERE id = ? AND folder = ?").get(source.id, folder));
    if (!req?.result) fail(409, "Il contenuto cifrato è cambiato. Riprova.");
    return { ...source, session: req.session, envelope: req.result };
  }
  chunk(folder, user, input) {
    const record = this.record(folder, user, input.conversion);
    this.allowed(folder, user);
    if (record.result) fail(409, "Conversione già completata.");
    const index = input.item, source = record.sources[index];
    if (!Number.isInteger(index) || !source || !Number.isInteger(input.chunk) || input.chunk < 0) fail(400, "Parte non valida.");
    const metadata = input.metadata;
    if (!metadata || !Number.isInteger(metadata.size) || metadata.size < 0 || metadata.size > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(metadata.sha256)) fail(400, "Metadati in chiaro non validi.");
    const path = cleanTreePath(metadata.path);
    const clean = { path, size: metadata.size, sha256: metadata.sha256, ...(typeof metadata.title === "string" ? { title: metadata.title.slice(0, 1000) } : {}) };
    const total = Math.max(1, Math.ceil(metadata.size / CHUNK));
    const bytes = typeof input.bytes === "string" ? Buffer.from(input.bytes, "base64url") : Buffer.alloc(0);
    if (typeof input.bytes !== "string" || bytes.toString("base64url") !== input.bytes || input.chunk >= total || bytes.length !== Math.min(CHUNK, Math.max(0, metadata.size - input.chunk * CHUNK))) fail(400, "Parte non valida.");
    const item = record.items[index] || { metadata: clean, chunks: [] };
    if (JSON.stringify(item.metadata) !== JSON.stringify(clean)) fail(409, "I metadati della versione sono cambiati.");
    if (input.chunk < item.chunks.length) {
      if (item.chunks[input.chunk] !== hash(bytes)) fail(409, "Parte già salvata con un contenuto diverso.");
      return { ok: true };
    }
    if (input.chunk !== item.chunks.length) fail(409, "Carica le parti nell’ordine corretto.");
    const space = this.artifacts.space();
    if (record.bytes + bytes.length > 128 * 1024 * 1024 || space.used + record.bytes + bytes.length > space.limit || (space.disk && space.disk.free - bytes.length < 5 * 1024 ** 3)) fail(507, "Spazio insufficiente per la copia in chiaro.");
    writeFileSync(join(this.directory(record.id), String(index)), bytes, { flag: input.chunk ? "a" : "w", mode: 0o600 });
    item.chunks.push(hash(bytes)); record.bytes += bytes.length; record.items[index] = item; this.save(record);
    return { ok: true };
  }
  cancel(folder, user, id) {
    const record = this.record(folder, user, id);
    if (record.result) return record.result;
    rmSync(this.directory(record.id), { recursive: true, force: true });
    this.store.db.prepare("DELETE FROM encrypted_conversions WHERE id = ?").run(record.id);
    return { ok: true };
  }
  async finish(folder, user, input) {
    return this.artifacts.withLock(folder, async () => {
      const record = this.record(folder, user, input.conversion);
      if (record.result) return record.result;
      this.allowed(folder, user);
      this.encrypted.prove(this.encrypted.folder(folder, user, "owner"), user, input.proof, "decrypt-finish:" + record.id);
      const made = [], commits = [];
      const object = bytes => { const sha = hash(bytes); if (!this.artifacts.hasObject(sha)) made.push(sha); return this.artifacts.putBytes(bytes); };
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.allowed(folder, user);
        if (this.snapshot(folder) !== record.snapshot) fail(409, "La cartella cifrata è cambiata. Riprova senza perdere i dati originali.");
        let parent = "";
        const tree = new Map(), owners = new Map(), paths = new Map(), by = { kind: "user", id: user.id, name: user.name || user.email || "Owner" };
        for (let index = 0; index < record.sources.length; index++) {
          const source = record.sources[index], item = record.items[index];
          if (!item || item.chunks.length !== Math.max(1, Math.ceil(item.metadata.size / CHUNK))) fail(409, "La copia non è completa. La cartella cifrata è intatta.");
          const bytes = readFileSync(join(this.directory(record.id), String(index)));
          if (bytes.length !== item.metadata.size || hash(bytes) !== item.metadata.sha256) fail(409, "La copia non supera la verifica di integrità.");
          const path = item.metadata.path, owner = source.type + ":" + source.id, previous = paths.get(owner);
          if (owners.has(path) && owners.get(path) !== owner) fail(409, "Due documenti hanno lo stesso percorso. Rinominali prima della conversione.");
          const sha = object(bytes);
          if (previous && previous !== path) { tree.delete(previous); owners.delete(previous); }
          const modified = tree.has(path); tree.set(path, { sha, size: bytes.length }); owners.set(path, owner); paths.set(owner, path);
          if (this.artifacts.scanSecrets(tree, [path]).length) fail(422, "La copia contiene un possibile segreto: conservalo nella cassaforte prima di salvare in chiaro.");
          const treeSha = object(JSON.stringify([...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, file]) => [name, file.sha, file.size])));
          const commit = { id: "ac_" + randomBytes(6).toString("hex"), folderId: folder, parent, base: parent, tree: treeSha, to: "", mirror: false, message: "Decrypted " + path + " · v" + (source.version || 1), author: by, requestedBy: null, channelId: "", traceId: "", status: "published", changes: { added: modified ? [] : [path], modified: modified ? [path] : [], deleted: previous && previous !== path ? [previous] : [] }, files: tree.size, bytes: [...tree.values()].reduce((sum, file) => sum + file.size, 0), sent: bytes.length, skipped: 0, createdAt: source.at, publishedAt: Date.now(), uploaded: true, review: { by, at: Date.now(), note: "Confirmed decryption", decision: "approve" }, encryptedSource: { ...source, ...item.metadata } };
          this.store.writeArtifactCommit(commit); parent = commit.id; commits.push(commit.id);
        }
        const space = this.artifacts.space();
        if (space.used > space.limit || (space.disk && space.disk.free < 5 * 1024 ** 3)) fail(507, "Spazio insufficiente per la copia in chiaro.");
        if (!this.store.moveArtifactHead(folder, "", parent)) fail(409, "La cartella è cambiata. Riprova.");
        this.store.db.prepare("DELETE FROM encrypted_file_chunks WHERE upload IN (SELECT id FROM encrypted_file_uploads WHERE folder = ?)").run(folder);
        for (const table of ["encrypted_file_uploads", "encrypted_documents", "encrypted_requests", "encrypted_inbox", "encrypted_folder_grants"]) this.store.db.prepare(`DELETE FROM ${table} WHERE folder = ?`).run(folder);
        this.store.db.prepare("DELETE FROM encrypted_folders WHERE id = ?").run(folder);
        this.store.setValue(`encryptedFolder:${folder}`, false);
        record.result = { ok: true, folder, head: parent, versions: commits.length }; this.save(record);
        this.encrypted.audit(user.id, "decrypt", { folder });
        this.store.db.exec("COMMIT");
      } catch (error) {
        this.store.db.exec("ROLLBACK");
        for (const sha of made) { const file = this.artifacts.objectPath(sha); if (existsSync(file)) unlinkSync(file); }
        throw error;
      }
      rmSync(this.directory(record.id), { recursive: true, force: true });
      return record.result;
    });
  }
}
