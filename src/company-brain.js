import { randomBytes } from "node:crypto";
import { openBrainDb } from "./brain-db.js";

/**
 * The company brain: what this company knows, as pages (a client, a project, a
 * person, a decision, a procedure, a topic) that the librarian keeps from the
 * chats, each change a revision with its sources. Changes are live at once and
 * reviewed by the owner afterwards: nothing waits for an approval. It lives in
 * Postgres with pgvector, next to Cora's own SQLite; search is full-text plus,
 * when an embedding model answers, by meaning.
 */
export const BRAIN_KINDS = ["client", "project", "person", "decision", "procedure", "topic"];
export const BODY_LIMIT = 8000;
const OPEN_REVIEWS = ["pending", "flagged"];
// Cosine distance past which a "nearest" page is not about the question at all.
const MAX_DISTANCE = 0.6;

const newId = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
const iso = (value) => (value ? new Date(value).toISOString() : null);

/** Lowercase words without accents: what the full-text index sees, the same in Italian and English. */
export function searchText(...parts) {
  return parts.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 20000);
}

/**
 * What looks like a credential, taken out of anything the brain keeps: every
 * agent reads the brain, so a secret has no place in it (its name in hush is
 * fine). Tokens by their known shapes, and any value of letters and digits
 * that follows "secret", "password", "token", "chiave" and the like, also
 * with a word or two in between ("secret attiva …", "chiave pubblicabile …").
 */
export const SECRET_SHAPES = /\b(?:xox[abprs]-|xapp-|sk-(?:ant-|proj-)?|sk_live_|rk_live_|pk_live_|ghp_|gho_|ghs_|github_pat_|glpat-|AKIA|AIza|hf_)[A-Za-z0-9_-]{8,}/g;
const SECRET_AFTER_WORD = /\b(secret|password|passwd|pwd|token|api[ _-]?key|key|chiave|segreto|passphrase)\b((?:\s+\p{L}{2,14}(?![\p{L}\p{N}_-])){0,2}\s*(?:[:=]|è|is)?\s*[`'"«]?)(?=[A-Za-z0-9_\-./+=]*\d)(?=[A-Za-z0-9_\-./+=]*[A-Za-z])[A-Za-z0-9_\-./+=]{7,}[A-Za-z0-9_+=-]/giu;
const SCRUB_VERSION = 2;
export const SECRET_MARK = "[segreto omesso]";

export function redactSecrets(text) {
  return String(text || "").replace(SECRET_SHAPES, SECRET_MARK).replace(SECRET_AFTER_WORD, (match, word, gap) => `${word}${gap}${SECRET_MARK}`);
}

export function slugify(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

/** Any of the words, each as a prefix: a tsquery built only from letters and digits. */
function anyWords(query) {
  const words = [...new Set(searchText(query).split(" ").filter((word) => word.length > 2))].slice(0, 30);
  return words.length ? words.map((word) => `${word}:*`).join(" | ") : "";
}

const vectorLiteral = (values) => `[${values.map((value) => Number(value) || 0).join(",")}]`;

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS brain_pages (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'live',
  version integer NOT NULL DEFAULT 1,
  search text NOT NULL DEFAULT '',
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search)) STORED,
  embedding vector,
  embed_model text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_pages_tsv ON brain_pages USING gin (tsv);
CREATE TABLE IF NOT EXISTS brain_revisions (
  id text PRIMARY KEY,
  page_id text NOT NULL REFERENCES brain_pages (id),
  version integer NOT NULL,
  action text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  note text NOT NULL DEFAULT '',
  sources jsonb NOT NULL DEFAULT '[]',
  author text NOT NULL,
  review text NOT NULL DEFAULT 'pending',
  conflict text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  reviewed_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_revisions_page ON brain_revisions (page_id, version);
CREATE INDEX IF NOT EXISTS brain_revisions_review ON brain_revisions (review, created_at);
CREATE TABLE IF NOT EXISTS brain_notes (
  id text PRIMARY KEY,
  text text NOT NULL,
  agent_id text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  channel_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS brain_chunks (
  id text PRIMARY KEY,
  source text NOT NULL,
  channel_id text NOT NULL DEFAULT '',
  at timestamptz,
  author text NOT NULL DEFAULT '',
  text text NOT NULL,
  search text NOT NULL DEFAULT '',
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search)) STORED,
  embedding vector,
  embed_model text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS brain_chunks_tsv ON brain_chunks USING gin (tsv);
CREATE TABLE IF NOT EXISTS brain_state (key text PRIMARY KEY, value jsonb NOT NULL);
`;

function pageRow(row) {
  return {
    id: row.id, slug: row.slug, kind: row.kind, title: row.title, summary: row.summary,
    ...(row.body !== undefined ? { body: row.body } : {}),
    status: row.status, version: row.version, pending: Number(row.pending || 0),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function revisionRow(row) {
  return {
    id: row.id, pageId: row.page_id, slug: row.slug, version: row.version, action: row.action,
    kind: row.kind, title: row.title, summary: row.summary, body: row.body, status: row.status,
    note: row.note, sources: Array.isArray(row.sources) ? row.sources : JSON.parse(row.sources || "[]"),
    author: row.author, review: row.review, conflict: row.conflict,
    reviewedAt: iso(row.reviewed_at), reviewedBy: row.reviewed_by, createdAt: iso(row.created_at),
    ...(row.prev_body !== undefined ? { previous: row.prev_body === null ? null : { title: row.prev_title, summary: row.prev_summary, body: row.prev_body, kind: row.prev_kind } } : {}),
  };
}

/** Reciprocal rank fusion: what both searches rank high comes first. */
function fuse(lists, limit) {
  const score = new Map();
  for (const list of lists) list.forEach((id, index) => score.set(id, (score.get(id) || 0) + 1 / (60 + index)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

export class CompanyBrain {
  /** `embed(texts)` → vectors, or null when no embedding model is set; `embedModel` names it. */
  constructor({ url = "", embed = null, embedModel = () => "", log = () => {} } = {}) {
    this.url = url;
    this.embed = embed;
    this.embedModel = embedModel;
    this.log = log;
    this.db = null;
    this.opening = null;
    this.failedAt = 0;
    this.embedFailedAt = 0;
    this.ready = url ? this.connect() : Promise.resolve(null);
    // A database that does not answer at start must not take Cora down with it: it is tried again later.
    this.ready.catch((error) => this.log({ type: "error", text: `brain: ${error.message}` }));
  }

  /** Open the database once; one that failed is tried again after half a minute, on the next call. */
  async connect() {
    if (this.db) return this.db;
    if (!this.opening) {
      if (Date.now() - this.failedAt < 30000) throw new Error("il database del brain non risponde");
      this.opening = this.open().catch((error) => {
        this.db = null;
        this.opening = null;
        this.failedAt = Date.now();
        throw error;
      });
    }
    return this.opening;
  }

  get enabled() { return Boolean(this.url); }

  /**
   * The agents' shared memories belong to the brain once the librarian has read
   * them: from then on agents no longer get them as memories. Until then (or
   * while the database is down at start) they keep them.
   */
  get holdsShared() { return this.enabled && this.sharedImported === true; }

  async open() {
    const db = await openBrainDb(this.url);
    try {
      await db.exec(SCHEMA);
      const [row] = await db.query("SELECT value FROM brain_state WHERE key = 'sharedImported'");
      this.sharedImported = row?.value === true;
      const [scrubbed] = await db.query("SELECT value FROM brain_state WHERE key = 'secretsScrubbed'");
      if ((scrubbed?.value?.version || (scrubbed ? 1 : 0)) < SCRUB_VERSION) await this.scrubSecrets(db);
    } catch (error) {
      await db.close().catch(() => {});
      throw error;
    }
    this.db = db;
    return db;
  }

  /**
   * Once per version of the rule, for a brain written before it: what looks
   * like a credential goes from pages, revisions, notes and the searchable
   * chats. The chats themselves keep the original in Cora's own archive.
   */
  async scrubSecrets(db = this.db) {
    const changed = { pages: 0, revisions: 0, notes: 0, chunks: 0 };
    for (const row of await db.query("SELECT id, title, summary, body FROM brain_pages")) {
      const [title, summary, body] = [row.title, row.summary, row.body].map(redactSecrets);
      if (title === row.title && summary === row.summary && body === row.body) continue;
      await db.query("UPDATE brain_pages SET title = $2, summary = $3, body = $4, search = $5 WHERE id = $1", [row.id, title, summary, body, searchText(title, summary, body)]);
      changed.pages += 1;
    }
    for (const row of await db.query("SELECT id, title, summary, body, note, conflict, sources FROM brain_revisions")) {
      const [title, summary, body, note, conflict] = [row.title, row.summary, row.body, row.note, row.conflict].map(redactSecrets);
      const before = Array.isArray(row.sources) ? row.sources : JSON.parse(row.sources || "[]");
      const sources = before.map((source) => (source?.quote ? { ...source, quote: redactSecrets(source.quote) } : source));
      if (title === row.title && summary === row.summary && body === row.body && note === row.note && conflict === row.conflict && JSON.stringify(sources) === JSON.stringify(before)) continue;
      await db.query("UPDATE brain_revisions SET title = $2, summary = $3, body = $4, note = $5, conflict = $6, sources = $7 WHERE id = $1", [row.id, title, summary, body, note, conflict, JSON.stringify(sources)]);
      changed.revisions += 1;
    }
    for (const row of await db.query("SELECT id, text FROM brain_notes")) {
      const text = redactSecrets(row.text);
      if (text === row.text) continue;
      await db.query("UPDATE brain_notes SET text = $2 WHERE id = $1", [row.id, text]);
      changed.notes += 1;
    }
    for (const row of await db.query("SELECT id, author, text FROM brain_chunks")) {
      const text = redactSecrets(row.text);
      if (text === row.text) continue;
      await db.query("UPDATE brain_chunks SET text = $2, search = $3 WHERE id = $1", [row.id, text, searchText(row.author || "", text)]);
      changed.chunks += 1;
    }
    await db.query("INSERT INTO brain_state (key, value) VALUES ('secretsScrubbed', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [JSON.stringify({ version: SCRUB_VERSION, at: new Date().toISOString(), ...changed })]);
    return changed;
  }

  async q(sql, params = []) {
    const db = await this.connect();
    return db.query(sql, params);
  }

  async close() {
    try {
      await this.opening;
      await this.db?.close();
    } catch {}
  }

  /* ---------- state ---------- */
  async state(key, fallback = null) {
    const [row] = await this.q("SELECT value FROM brain_state WHERE key = $1", [key]);
    return row ? row.value : fallback;
  }

  async setState(key, value) {
    await this.q("INSERT INTO brain_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
    if (key === "sharedImported") this.sharedImported = value === true;
  }

  /* ---------- embeddings ---------- */
  /** Vectors for these texts with the instance's embedding model, or null: search then goes by words alone. */
  async vectors(texts) {
    const model = this.embedModel();
    if (!this.embed || !model || !texts.length) return null;
    // A model that failed is tried again after ten minutes, not on every call.
    if (Date.now() - this.embedFailedAt < 10 * 60 * 1000) return null;
    try {
      const vectors = await this.embed(model, texts);
      return Array.isArray(vectors) && vectors.length === texts.length ? { model, vectors } : null;
    } catch (error) {
      this.embedFailedAt = Date.now();
      this.log({ type: "error", text: `brain: embedding con ${model}: ${error.message}` });
      return null;
    }
  }

  async embedPage(id, page) {
    const result = await this.vectors([`${page.title}\n${page.summary}\n${page.body}`.slice(0, 8000)]);
    if (result) await this.q("UPDATE brain_pages SET embedding = $1, embed_model = $2 WHERE id = $3", [vectorLiteral(result.vectors[0]), result.model, id]);
  }

  /* ---------- pages ---------- */
  async pages({ kind = "", status = "live" } = {}) {
    return (await this.q(`
      SELECT p.id, p.slug, p.kind, p.title, p.summary, p.status, p.version, p.created_at, p.updated_at,
        (SELECT count(*) FROM brain_revisions r WHERE r.page_id = p.id AND r.review = ANY($3::text[])) AS pending
      FROM brain_pages p WHERE p.status = $1 AND ($2 = '' OR p.kind = $2) ORDER BY p.updated_at DESC`, [status, kind, OPEN_REVIEWS])).map(pageRow);
  }

  async page(slug) {
    const [row] = await this.q(`SELECT p.*, (SELECT count(*) FROM brain_revisions r WHERE r.page_id = p.id AND r.review = ANY($2::text[])) AS pending
      FROM brain_pages p WHERE p.slug = $1`, [slugify(slug), OPEN_REVIEWS]);
    if (!row) return null;
    const revisions = await this.q("SELECT * FROM brain_revisions WHERE page_id = $1 ORDER BY version DESC LIMIT 50", [row.id]);
    return { ...pageRow(row), revisions: revisions.map(revisionRow) };
  }

  /**
   * The brain as a map: the live pages, and what ties them. A `link` is a
   * [[slug]] in a page's text; a `mention` is a page's title named in another
   * page's text without the link (titles of four letters or more, whole words).
   * One edge per pair, the link winning over the mention.
   */
  async graph({ limit = 400 } = {}) {
    const rows = await this.q(`SELECT p.slug, p.kind, p.title, p.summary, p.body, p.updated_at,
        (SELECT count(*) FROM brain_revisions r WHERE r.page_id = p.id AND r.review = ANY($1::text[])) AS pending
      FROM brain_pages p WHERE p.status = 'live' ORDER BY p.updated_at DESC LIMIT $2`, [OPEN_REVIEWS, limit]);
    const slugs = new Set(rows.map((row) => row.slug));
    const edges = new Map();
    const add = (source, target, kind) => {
      if (source === target) return;
      const key = [source, target].sort().join(" ");
      if (!edges.has(key) || (kind === "link" && edges.get(key).kind === "mention")) edges.set(key, { source, target, kind });
    };
    const names = rows.map((row) => ({ slug: row.slug, name: searchText(row.title) })).filter((item) => item.name.length >= 4);
    for (const row of rows) {
      for (const [, slug] of String(row.body).matchAll(/\[\[([a-z0-9-]{2,60})\]\]/g)) if (slugs.has(slug)) add(row.slug, slug, "link");
      const text = ` ${searchText(row.summary, row.body)} `;
      for (const item of names) if (item.slug !== row.slug && text.includes(` ${item.name} `)) add(row.slug, item.slug, "mention");
    }
    return {
      nodes: rows.map((row) => ({ slug: row.slug, kind: row.kind, title: row.title, summary: row.summary, pending: Number(row.pending || 0), updatedAt: iso(row.updated_at) })),
      edges: [...edges.values()],
    };
  }

  async stats() {
    const [row] = await this.q(`SELECT
      (SELECT count(*) FROM brain_pages WHERE status = 'live') AS pages,
      (SELECT count(*) FROM brain_revisions WHERE review = 'pending') AS pending,
      (SELECT count(*) FROM brain_revisions WHERE review = 'flagged') AS flagged,
      (SELECT count(*) FROM brain_notes WHERE used_at IS NULL) AS notes,
      (SELECT count(*) FROM brain_chunks) AS chunks`);
    return { pages: Number(row.pages), pending: Number(row.pending), flagged: Number(row.flagged), notes: Number(row.notes), chunks: Number(row.chunks) };
  }

  /**
   * A page as it is now, written as one revision: created when the slug is new,
   * updated (or brought back from the archive) when it exists. The revision keeps
   * the whole page as it became, its sources and who wrote it.
   */
  async write({ slug = "", kind = "topic", title, summary = "", body = "", note = "", sources = [], author, review = "pending", conflict = "" }) {
    const clean = {
      slug: slugify(slug || title),
      kind: BRAIN_KINDS.includes(kind) ? kind : "topic",
      title: redactSecrets(title).replace(/\s+/g, " ").trim().slice(0, 120),
      summary: redactSecrets(summary).replace(/\s+/g, " ").trim().slice(0, 400),
      body: redactSecrets(body).trim().slice(0, BODY_LIMIT),
    };
    note = redactSecrets(note);
    conflict = redactSecrets(conflict);
    sources = sources.map((source) => (source?.quote ? { ...source, quote: redactSecrets(source.quote) } : source));
    if (clean.slug.length < 2 || !clean.title) throw new Error("una pagina ha bisogno di un titolo");
    const reviewState = conflict ? "flagged" : review;
    const result = await this.transaction(async (tx) => {
      const [existing] = await tx.query("SELECT * FROM brain_pages WHERE slug = $1 FOR UPDATE", [clean.slug]);
      const search = searchText(clean.title, clean.summary, clean.body);
      let id;
      let version;
      let action;
      if (existing) {
        id = existing.id;
        version = existing.version + 1;
        action = existing.status === "archived" ? "restore" : "update";
        await tx.query(`UPDATE brain_pages SET kind = $2, title = $3, summary = $4, body = $5, status = 'live', version = $6, search = $7, updated_at = now() WHERE id = $1`,
          [id, clean.kind, clean.title, clean.summary, clean.body, version, search]);
      } else {
        id = newId("bp");
        version = 1;
        action = "create";
        await tx.query(`INSERT INTO brain_pages (id, slug, kind, title, summary, body, version, search) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
          [id, clean.slug, clean.kind, clean.title, clean.summary, clean.body, search]);
      }
      const revision = newId("br");
      await tx.query(`INSERT INTO brain_revisions (id, page_id, version, action, kind, title, summary, body, status, note, sources, author, review, conflict, reviewed_at, reviewed_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'live', $9, $10, $11, $12, $13, $14, $15)`,
        [revision, id, version, action, clean.kind, clean.title, clean.summary, clean.body, String(note || "").slice(0, 300), JSON.stringify(sources.slice(0, 20)), author,
          reviewState, String(conflict || "").slice(0, 400), reviewState === "approved" ? new Date() : null, reviewState === "approved" ? author : ""]);
      return { id, revision, action, version };
    });
    await this.embedPage(result.id, clean).catch(() => {});
    return { page: await this.page(clean.slug), revisionId: result.revision, action: result.action };
  }

  /** Archived, never deleted: the page leaves the brain and comes back with a revert or a new write. */
  async archive(slug, { author, note = "", review = "pending" } = {}) {
    const page = await this.page(slug);
    if (!page || page.status === "archived") return null;
    await this.transaction(async (tx) => {
      await tx.query("UPDATE brain_pages SET status = 'archived', version = version + 1, updated_at = now() WHERE id = $1", [page.id]);
      await tx.query(`INSERT INTO brain_revisions (id, page_id, version, action, kind, title, summary, body, status, note, author, review, reviewed_at, reviewed_by)
        VALUES ($1, $2, $3, 'archive', $4, $5, $6, $7, 'archived', $8, $9, $10, $11, $12)`,
        [newId("br"), page.id, page.version + 1, page.kind, page.title, page.summary, page.body, String(note).slice(0, 300), author, review,
          review === "approved" ? new Date() : null, review === "approved" ? author : ""]);
    });
    return this.page(slug);
  }

  async transaction(work) {
    const db = await this.connect();
    return db.transaction(work);
  }

  /* ---------- review ---------- */
  /** What changed and waits for the owner's look, with each page as it was before. */
  async reviewQueue() {
    return (await this.q(`
      SELECT r.*, p.slug, prev.title AS prev_title, prev.summary AS prev_summary, prev.body AS prev_body, prev.kind AS prev_kind
      FROM brain_revisions r JOIN brain_pages p ON p.id = r.page_id
      LEFT JOIN brain_revisions prev ON prev.page_id = r.page_id AND prev.version = r.version - 1
      WHERE r.review = ANY($1::text[]) ORDER BY r.created_at`, [OPEN_REVIEWS])).map(revisionRow);
  }

  /**
   * The owner's decision on changes. Approving stamps them. Reverting puts each
   * page back as it was before the first change reverted (a page the change
   * created is archived), as a new revision, and closes the changes after it.
   */
  async review({ ids = [], all = false, decision, by }) {
    if (!["approve", "revert"].includes(decision)) throw new Error("decisione non valida");
    const open = (await this.reviewQueue()).filter((revision) => all || ids.includes(revision.id));
    if (!open.length) return { approved: 0, reverted: 0 };
    if (decision === "approve") {
      await this.q("UPDATE brain_revisions SET review = 'approved', reviewed_at = now(), reviewed_by = $1 WHERE id = ANY($2::text[])", [by, open.map((revision) => revision.id)]);
      return { approved: open.length, reverted: 0 };
    }
    const byPage = new Map();
    for (const revision of open) if (!byPage.has(revision.pageId) || byPage.get(revision.pageId).version > revision.version) byPage.set(revision.pageId, revision);
    let reverted = 0;
    for (const first of byPage.values()) {
      await this.transaction(async (tx) => {
        const [page] = await tx.query("SELECT * FROM brain_pages WHERE id = $1 FOR UPDATE", [first.pageId]);
        const [before] = await tx.query("SELECT * FROM brain_revisions WHERE page_id = $1 AND version = $2", [first.pageId, first.version - 1]);
        const version = page.version + 1;
        const target = before || { kind: page.kind, title: page.title, summary: page.summary, body: page.body, status: "archived" };
        await tx.query("UPDATE brain_pages SET kind = $2, title = $3, summary = $4, body = $5, status = $6, version = $7, search = $8, updated_at = now() WHERE id = $1",
          [page.id, target.kind, target.title, target.summary, target.body, target.status, version, searchText(target.title, target.summary, target.body)]);
        await tx.query(`INSERT INTO brain_revisions (id, page_id, version, action, kind, title, summary, body, status, note, author, review, reviewed_at, reviewed_by)
          VALUES ($1, $2, $3, 'revert', $4, $5, $6, $7, $8, $9, $10, 'approved', now(), $10)`,
          [newId("br"), page.id, version, target.kind, target.title, target.summary, target.body, target.status, `Annullato: ${first.note || "modifica del bibliotecario"}`.slice(0, 300), by]);
        const closed = await tx.query("UPDATE brain_revisions SET review = 'reverted', reviewed_at = now(), reviewed_by = $3 WHERE page_id = $1 AND version >= $2 AND version < $4 AND review = ANY($5::text[]) RETURNING id",
          [page.id, first.version, by, version, OPEN_REVIEWS]);
        reverted += closed.length;
      });
      const page = (await this.q("SELECT * FROM brain_pages WHERE id = $1", [first.pageId]))[0];
      await this.embedPage(page.id, page).catch(() => {});
    }
    return { approved: 0, reverted };
  }

  /* ---------- notes from agents ---------- */
  async note({ text, agentId = "", author = "", channelId = "" }) {
    const id = newId("bn");
    await this.q("INSERT INTO brain_notes (id, text, agent_id, author, channel_id) VALUES ($1, $2, $3, $4, $5)", [id, String(text).trim().slice(0, 2000), agentId, author, channelId]);
    return id;
  }

  async notes() {
    return (await this.q("SELECT * FROM brain_notes WHERE used_at IS NULL ORDER BY created_at LIMIT 200"))
      .map((row) => ({ id: row.id, text: row.text, agentId: row.agent_id, author: row.author, channelId: row.channel_id, createdAt: iso(row.created_at) }));
  }

  async useNotes(ids) {
    if (ids.length) await this.q("UPDATE brain_notes SET used_at = now() WHERE id = ANY($1::text[])", [ids]);
  }

  /* ---------- the archive, searchable by meaning ---------- */
  /** Chat messages (and later file pieces) the brain can search; ids already there are skipped. */
  async addChunks(items) {
    let added = 0;
    for (const item of items) {
      const rows = await this.q(`INSERT INTO brain_chunks (id, source, channel_id, at, author, text, search) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [item.id, item.source, item.channelId || "", item.at ? new Date(item.at) : null, item.author || "", redactSecrets(item.text).slice(0, 4000), searchText(item.author || "", redactSecrets(item.text))]);
      added += rows.length;
    }
    const model = this.embedModel();
    const missing = await this.q("SELECT id, author, text FROM brain_chunks WHERE embed_model <> $1 ORDER BY at DESC NULLS LAST LIMIT 2000", [model || "-"]);
    for (let start = 0; model && start < missing.length; start += 32) {
      const batch = missing.slice(start, start + 32);
      const result = await this.vectors(batch.map((row) => `${row.author}: ${row.text}`));
      if (!result) break;
      for (const [index, row] of batch.entries()) await this.q("UPDATE brain_chunks SET embedding = $1, embed_model = $2 WHERE id = $3", [vectorLiteral(result.vectors[index]), result.model, row.id]);
    }
    return added;
  }

  /* ---------- search ---------- */
  async hybrid(table, query, { limit, where = "TRUE", params = [] }) {
    const words = anyWords(query);
    if (!words) return [];
    const offset = params.length;
    const lists = [];
    lists.push((await this.q(`SELECT id FROM ${table}, to_tsquery('simple', $${offset + 1}) q WHERE ${where} AND tsv @@ q ORDER BY ts_rank(tsv, q) DESC LIMIT 20`, [...params, words])).map((row) => row.id));
    const result = await this.vectors([String(query).slice(0, 2000)]);
    if (result) {
      lists.push((await this.q(`SELECT id FROM ${table} WHERE ${where} AND embedding IS NOT NULL AND embed_model = $${offset + 2} AND (embedding <=> $${offset + 1}) < ${MAX_DISTANCE} ORDER BY embedding <=> $${offset + 1} LIMIT 20`,
        [...params, vectorLiteral(result.vectors[0]), result.model])).map((row) => row.id));
    }
    return fuse(lists, limit);
  }

  /** The live pages that answer a question, best first, each with its summary and the start of its text. */
  async search(query, { limit = 6 } = {}) {
    const ids = await this.hybrid("brain_pages", query, { limit, where: "status = 'live'" });
    if (!ids.length) return [];
    const rows = await this.q(`SELECT p.*, (SELECT count(*) FROM brain_revisions r WHERE r.page_id = p.id AND r.review = ANY($2::text[])) AS pending FROM brain_pages p WHERE p.id = ANY($1::text[])`, [ids, OPEN_REVIEWS]);
    const byId = new Map(rows.map((row) => [row.id, pageRow(row)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /** What was said in the chats about it, by words and by meaning. */
  async searchArchive(query, { limit = 8 } = {}) {
    const ids = await this.hybrid("brain_chunks", query, { limit });
    if (!ids.length) return [];
    const rows = await this.q("SELECT id, source, channel_id, at, author, text FROM brain_chunks WHERE id = ANY($1::text[])", [ids]);
    const byId = new Map(rows.map((row) => [row.id, { id: row.id, source: row.source, channelId: row.channel_id, at: iso(row.at), author: row.author, text: row.text }]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /** Everything that cannot be rebuilt from the chats, for the nightly backup. */
  async exportAll() {
    return {
      at: new Date().toISOString(),
      pages: await this.q("SELECT id, slug, kind, title, summary, body, status, version, created_at, updated_at FROM brain_pages"),
      revisions: await this.q("SELECT * FROM brain_revisions"),
      notes: await this.q("SELECT * FROM brain_notes"),
      state: await this.q("SELECT * FROM brain_state"),
    };
  }
}
