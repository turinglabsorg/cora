import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The cloud's own data: people (accounts), the Google and GitHub identities
 * they sign in with, and the spaces they own. A space's agents, memory and
 * chats live in that space's Cora, never here.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  epoch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  login TEXT NOT NULL DEFAULT '',
  last_login INTEGER,
  PRIMARY KEY (provider, subject)
);
CREATE TABLE IF NOT EXISTS invites (
  provider TEXT NOT NULL,
  hint TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, hint)
);
CREATE TABLE IF NOT EXISTS spaces (
  slug TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  upstream TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  company TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

export const PROVIDERS = ["google", "github"];
/** A space name: a DNS label people can type, not one of ours. */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED = new Set(["www", "api", "app", "admin", "auth", "login", "mail", "status", "docs", "help", "cloud", "cora", "up", "static", "assets"]);

export function validSlug(slug) {
  return SLUG.test(String(slug || "")) && !RESERVED.has(slug) && !slug.includes("--");
}

function accountRow(row) {
  return row ? { id: row.id, name: row.name, email: row.email, avatar: row.avatar, epoch: row.epoch, createdAt: row.created_at } : null;
}

export class CloudStore {
  constructor(home) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.path = join(home, "cloud.db");
    this.db = new DatabaseSync(this.path);
    try { chmodSync(this.path, 0o600); } catch {}
    this.db.exec(SCHEMA);
    try { this.db.exec("ALTER TABLE identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0"); } catch {}
    this.db.exec(`CREATE TABLE IF NOT EXISTS space_members (
      slug TEXT NOT NULL REFERENCES spaces(slug) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      last_entered INTEGER NOT NULL, PRIMARY KEY(slug,account_id)
    )`);
    this.statements = new Map();
  }

  stmt(sql) {
    if (!this.statements.has(sql)) this.statements.set(sql, this.db.prepare(sql));
    return this.statements.get(sql);
  }

  close() {
    this.db.close();
  }

  account(id) {
    return accountRow(this.stmt("SELECT * FROM accounts WHERE id = ?").get(String(id || "")));
  }

  createAccount({ name = "", email = "", avatar = "" } = {}) {
    const id = `ac_${randomBytes(8).toString("hex")}`;
    this.stmt("INSERT INTO accounts (id, name, email, avatar, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, email, avatar, Date.now());
    return this.account(id);
  }

  /** Lets someone in with this Google address or GitHub login before they ever signed in. */
  invite(accountId, provider, hint) {
    if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider ${provider}`);
    const clean = String(hint || "").trim().toLowerCase();
    if (!clean) throw new Error("empty invite");
    this.stmt("INSERT OR REPLACE INTO invites (provider, hint, account_id) VALUES (?, ?, ?)").run(provider, clean, accountId);
  }

  /**
   * The account for someone who just proved who they are. A known identity
   * keeps its account; an invited address or login claims its account (and
   * the invite is used up); anyone else gets a new account of their own.
   */
  signIn(provider, { subject, email = "", login = "", name = "", avatar = "", emailVerified = false }) {
    const now = Date.now();
    const known = this.stmt("SELECT account_id FROM identities WHERE provider = ? AND subject = ?").get(provider, String(subject));
    let accountId = known?.account_id;
    if (!accountId) {
      const hints = [provider === "google" && emailVerified ? email : "", provider === "github" ? login : ""].filter(Boolean).map((hint) => hint.toLowerCase());
      for (const hint of hints) {
        const invite = this.stmt("SELECT account_id FROM invites WHERE provider = ? AND hint = ?").get(provider, hint);
        if (invite) {
          accountId = invite.account_id;
          this.stmt("DELETE FROM invites WHERE provider = ? AND hint = ?").run(provider, hint);
          break;
        }
      }
      if (!accountId) accountId = this.createAccount({ name, email: emailVerified ? email : "", avatar }).id;
      this.stmt("INSERT INTO identities (provider, subject, account_id, email, login, last_login) VALUES (?, ?, ?, ?, ?, ?)")
        .run(provider, String(subject), accountId, email, login, now);
    } else {
      this.stmt("UPDATE identities SET email = ?, login = ?, last_login = ? WHERE provider = ? AND subject = ?").run(email, login, now, provider, String(subject));
    }
    this.stmt("UPDATE identities SET email_verified = ? WHERE provider = ? AND subject = ?").run(emailVerified ? 1 : 0, provider, String(subject));
    const account = this.account(accountId);
    // Fill in what the account is missing from the identity just used.
    this.stmt("UPDATE accounts SET name = ?, email = ?, avatar = ? WHERE id = ?").run(
      account.name || name, account.email || (emailVerified ? email : ""), avatar || account.avatar, accountId,
    );
    return this.account(accountId);
  }

  verifiedEmailOf(accountId) {
    const identity = this.stmt("SELECT email,email_verified FROM identities WHERE account_id = ? ORDER BY last_login DESC LIMIT 1").get(accountId);
    return identity?.email_verified ? String(identity.email || "").toLowerCase() : "";
  }

  recordSpaceEntry(slug, accountId) {
    this.stmt("INSERT INTO space_members(slug,account_id,last_entered) VALUES (?,?,?) ON CONFLICT(slug,account_id) DO UPDATE SET last_entered=excluded.last_entered").run(slug,accountId,Date.now());
  }

  accessibleSpacesOf(accountId) {
    return this.stmt("SELECT slug FROM spaces WHERE account_id = ? UNION SELECT slug FROM space_members WHERE account_id = ?").all(accountId,accountId).map((row) => this.space(row.slug));
  }

  identities(accountId) {
    return this.stmt("SELECT provider, email, login, last_login FROM identities WHERE account_id = ? ORDER BY provider").all(accountId)
      .map((row) => ({ provider: row.provider, email: row.email, login: row.login, lastLogin: row.last_login }));
  }

  deleteAccount(accountId) {
    if (this.spacesOf(accountId).length) throw new Error("the account owns a space");
    this.stmt("DELETE FROM accounts WHERE id = ?").run(accountId);
  }

  /** Signing out everywhere: every session cookie issued before stops working. */
  bumpEpoch(accountId) {
    this.stmt("UPDATE accounts SET epoch = epoch + 1 WHERE id = ?").run(accountId);
  }

  addSpace({ slug, accountId, upstream }) {
    if (!validSlug(slug)) throw new Error(`"${slug}" is not a valid space name`);
    const url = new URL(upstream);
    if (!/^https?:$/.test(url.protocol)) throw new Error("the upstream must be an http(s) address");
    this.stmt("INSERT INTO spaces (slug, account_id, upstream, created_at) VALUES (?, ?, ?, ?)").run(slug, accountId, url.origin, Date.now());
    this.stmt("DELETE FROM requests WHERE account_id = ?").run(accountId);
    return this.space(slug);
  }

  space(slug) {
    const row = this.stmt("SELECT * FROM spaces WHERE slug = ?").get(String(slug || ""));
    return row ? { slug: row.slug, accountId: row.account_id, upstream: row.upstream, createdAt: row.created_at } : null;
  }

  spacesOf(accountId) {
    return this.stmt("SELECT slug FROM spaces WHERE account_id = ? ORDER BY created_at").all(accountId).map((row) => this.space(row.slug));
  }

  spaces() {
    return this.stmt("SELECT slug FROM spaces ORDER BY created_at").all().map((row) => this.space(row.slug));
  }

  /** Someone who wants a space before sign-in opens. Joining twice keeps the first date and the latest company. */
  joinWaitlist(email, company = "") {
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(clean) || clean.length > 200) throw new Error("invalid");
    this.stmt(`INSERT INTO waitlist (email, company, created_at) VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET company = CASE WHEN excluded.company != '' THEN excluded.company ELSE waitlist.company END`)
      .run(clean, String(company || "").trim().slice(0, 80), Date.now());
  }

  waitlist() {
    return this.stmt("SELECT * FROM waitlist ORDER BY created_at").all().map((row) => ({ email: row.email, company: row.company, createdAt: row.created_at }));
  }

  /** Someone without a space asks for one: the name they want and a note. One request per account. */
  request(accountId, { slug, note = "" }) {
    const clean = String(slug || "").trim().toLowerCase();
    if (!validSlug(clean)) throw new Error("bad-name");
    if (this.space(clean)) throw new Error("taken");
    const other = this.stmt("SELECT account_id FROM requests WHERE slug = ? AND account_id != ?").get(clean, accountId);
    if (other) throw new Error("taken");
    this.stmt("INSERT OR REPLACE INTO requests (account_id, slug, note, created_at) VALUES (?, ?, ?, ?)").run(accountId, clean, String(note).slice(0, 500), Date.now());
    return this.requestOf(accountId);
  }

  requestOf(accountId) {
    const row = this.stmt("SELECT * FROM requests WHERE account_id = ?").get(accountId);
    return row ? { slug: row.slug, note: row.note, createdAt: row.created_at } : null;
  }

  requests() {
    return this.stmt("SELECT r.*, a.name, a.email FROM requests r JOIN accounts a ON a.id = r.account_id ORDER BY r.created_at").all()
      .map((row) => ({ accountId: row.account_id, slug: row.slug, note: row.note, name: row.name, email: row.email, createdAt: row.created_at }));
  }
}
