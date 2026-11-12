import { createHash, randomBytes } from "node:crypto";
import { SECRET_MARK, redactSecrets, slugify } from "./company-brain.js";
import { KnowledgeError, readPublicLink } from "./knowledge.js";
import { pngSize } from "./png.js";
import { nextRuns } from "./scheduler.js";

export const PACKAGE_FORMAT = "cora-agent";
export const PACKAGE_VERSION = 1;
export const PACKAGE_MAX_BYTES = 4 * 1024 * 1024;
const LINK_DAYS = [1, 7, 30];
const LINK_MAX_DOWNLOADS = 20;
const STAGED_MS = 30 * 60 * 1000;
const LIMITS = { routines: 100, memories: 1000, procedures: 100 };
const MARKS = { email: "[email]", phone: "[telefono]", id: "[id]", ip: "[ip]", person: "[persona]", link: "[link]" };
const NAME_STOPWORDS = new Set(["owner", "admin", "user", "utente", "cora", "team", "test", "agent", "agente", "bot", "info", "mail", "noreply", "support"]);
const KINDS = ["email", "phone", "id", "ip", "link", "secret", "person"];

export class TransferError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const hashToken = (token) => sha256(`agent-package:${token}`);

/** The words a person's name is made of, lower case, long enough to mean someone. */
export function nameTokens(names, { keep = [] } = {}) {
  const kept = new Set(keep.map((name) => String(name).toLowerCase()));
  const tokens = new Set();
  for (const name of names) {
    const whole = String(name || "").normalize("NFC").trim().toLowerCase();
    if (whole.length >= 3 && !kept.has(whole) && !NAME_STOPWORDS.has(whole)) tokens.add(whole);
    for (const part of whole.split(/[^\p{L}\p{N}]+/u)) {
      if (part.length >= 3 && /\p{L}/u.test(part) && !kept.has(part) && !NAME_STOPWORDS.has(part)) tokens.add(part);
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

/**
 * What leaves the space in place of personal data: addresses, numbers, platform and Cora ids,
 * links that carry anything beyond a path, key-shaped strings and the names of the space's people.
 */
export function scrubPersonal(input, { names = [] } = {}) {
  const found = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  let text = String(input ?? "");
  const count = (kind, mark) => () => { found[kind] += 1; return mark; };
  const unsecret = redactSecrets(text);
  if (unsecret !== text) { found.secret += Math.max(1, unsecret.split(SECRET_MARK).length - text.split(SECRET_MARK).length); text = unsecret; }
  text = text.replace(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi, (raw) => {
    let url;
    try { url = new URL(raw); } catch { found.link += 1; return MARKS.link; }
    if (!url.username && !url.password && !url.search && !url.hash) return raw;
    found.link += 1;
    return `${url.origin}${url.pathname}`;
  });
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, count("email", MARKS.email));
  text = text.replace(/\b(?:discord|telegram|slack|tg|sl):[\w@.-]+/gi, count("id", MARKS.id));
  text = text.replace(/\b(?:ag|rt|mem|ac|sub|key|af|vr|vs|day|apl|sh|tr|ctx)_[a-z0-9]{6,}\b/g, count("id", MARKS.id));
  text = text.replace(/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, count("ip", MARKS.ip));
  text = text.replace(/\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi, count("ip", MARKS.ip));
  text = text.replace(/\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}\b/g, count("phone", MARKS.phone));
  text = text.replace(/\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g, count("phone", MARKS.phone));
  text = text.replace(/-?\b\d{13,20}\b/g, count("id", MARKS.id));
  text = text.replace(/\b[UWCGDT](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/g, count("id", MARKS.id));
  const tokens = names.length ? nameTokens(names) : [];
  if (tokens.length) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${tokens.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
    text = text.replace(pattern, count("person", MARKS.person));
    // A short form of a known name, written as one: «Seb» for Sebastiano.
    const long = tokens.filter((token) => token.length >= 5);
    text = text.replace(/(?<![\p{L}\p{N}_])\p{Lu}\p{Ll}{2,}(?![\p{L}\p{N}_])/gu, (word) => {
      const lower = word.toLowerCase();
      if (NAME_STOPWORDS.has(lower) || !long.some((token) => token !== lower && token.startsWith(lower))) return word;
      found.person += 1;
      return MARKS.person;
    });
  }
  const removed = Object.fromEntries(Object.entries(found).filter(([, n]) => n > 0));
  return { text, removed, changed: Object.keys(removed).length > 0 };
}

function cleanText(value, max) { return String(value ?? "").replace(/\u0000/g, "").slice(0, max); }

/** The package's checksum: SHA-256 over the payload exactly as it is written. */
export function sealPackage(payload) {
  return { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, payload, checksum: `sha256:${sha256(JSON.stringify(payload))}` };
}

export function openPackage(input) {
  let data = input;
  if (typeof input === "string" || Buffer.isBuffer(input)) {
    const text = String(input);
    if (Buffer.byteLength(text) > PACKAGE_MAX_BYTES) throw new TransferError("Il pacchetto supera i 4 MB.", 413);
    try { data = JSON.parse(text); } catch { throw new TransferError("Il file non è un pacchetto agente di Cora."); }
  }
  if (!data || typeof data !== "object" || data.format !== PACKAGE_FORMAT || !data.payload || typeof data.payload !== "object") throw new TransferError("Il file non è un pacchetto agente di Cora.");
  if (data.version !== PACKAGE_VERSION) throw new TransferError(`Versione del pacchetto non supportata (${String(data.version).slice(0, 12)}): questo Cora legge la versione ${PACKAGE_VERSION}.`);
  if (Buffer.byteLength(JSON.stringify(data)) > PACKAGE_MAX_BYTES) throw new TransferError("Il pacchetto supera i 4 MB.", 413);
  if (data.checksum !== `sha256:${sha256(JSON.stringify(data.payload))}`) throw new TransferError("Il pacchetto è stato modificato o è incompleto: il controllo SHA-256 non corrisponde.");
  return data.payload;
}

function routineSpec(routine) {
  if (routine.kind === "reminder") return { kind: "reminder", runAt: routine.runAt };
  return { kind: "routine", schedule: routine.schedule };
}

export class AgentTransfer {
  constructor({ store, knowledge = null, companyBrain = null, vault = null, keyConnectors = null, activity = () => {}, timezone = "Europe/Rome", allowLocal = false, now = () => Date.now() }) {
    Object.assign(this, { store, knowledge, companyBrain, vault, keyConnectors, activity, timezone, allowLocal, now });
    this.staged = new Map();
  }

  /** Who may take an agent out of the space: whoever manages its memory. */
  canExport(agent, user) {
    if (!agent || !user || user.blocked) return false;
    if (this.knowledge) return this.knowledge.canManage(agent, user);
    return user.role === "owner";
  }

  brainFor(agent) {
    if (!agent || agent.brainSource === "external" || agent.sealed) return null;
    const brain = this.knowledge ? this.knowledge.forAgent(agent) : this.companyBrain;
    return brain?.enabled ? brain : null;
  }

  names(agent) {
    const agentNames = this.store.agents().map((other) => other.name);
    const owners = this.store.agentOwners(agent).map((owner) => owner?.name).filter(Boolean);
    const all = [...this.store.personNames(), ...owners];
    return nameTokens(all, { keep: agentNames });
  }

  facts(agent) {
    if (agent.brainSource === "external") return [];
    const keys = this.knowledge && (this.knowledge.ownerMemory || this.knowledge.isSealed(agent)) ? this.knowledge.ownerKeys(agent.id) : [agent.id];
    return keys.flatMap((key) => this.store.memories(key));
  }

  requirements(agent) {
    const connectorSecrets = new Set((this.store.value("keyConnectors", []) || []).flatMap((record) => [record.secretName, ...(record.appSecrets || [])]).filter(Boolean));
    const secrets = this.vault?.enabled
      ? this.store.vaultSecrets().filter((secret) => !connectorSecrets.has(secret.name) && (secret.agents || []).includes(agent.id)).map((secret) => secret.name)
      : [];
    let connectors = [];
    try { connectors = [...new Set((this.keyConnectors?.toolsFor(agent) || []).map((tool) => String(tool.name || "").split("_")[0]).filter(Boolean))]; } catch {}
    return { secrets: [...new Set(secrets)].sort(), connectors: connectors.sort() };
  }

  /** Everything the package would carry, scrubbed, with what was taken out of each item and whether it goes by default. */
  async preview(agent) {
    const names = this.names(agent);
    const scrub = (text) => scrubPersonal(text, { names });
    const personality = scrub(agent.personality || "");
    const core = scrub(agent.core || "");
    const now = this.now();
    const routines = this.store.routines(agent.id).filter((routine) => !routine.archivedAt)
      .filter((routine) => routine.kind !== "reminder" || (Date.parse(routine.runAt) > now && !routine.lastRunAt))
      .slice(0, LIMITS.routines).map((routine) => {
        const name = scrub(routine.name), prompt = scrub(routine.prompt);
        const removed = merge(name.removed, prompt.removed);
        return { id: routine.id, ...routineSpec(routine), name: name.text, prompt: prompt.text, enabled: routine.enabled, removed, include: true };
      });
    const memories = this.facts(agent).slice(0, LIMITS.memories).map((memory) => {
      const scrubbed = scrub(memory.text);
      return { id: memory.id, text: scrubbed.text, pinned: Boolean(memory.pinned), removed: scrubbed.removed, include: !scrubbed.removed.person && !scrubbed.removed.email && !scrubbed.removed.phone };
    });
    let procedures = [];
    const brain = this.brainFor(agent);
    if (brain) {
      try {
        const listed = (await brain.pages({ kind: "procedure" })).filter((page) => !page.shared && !page.readonly).slice(0, LIMITS.procedures);
        const pages = await Promise.all(listed.map(async (page) => ({ ...page, ...((await brain.page(page.slug)) || {}) })));
        procedures = pages.map((page) => {
          const title = scrub(page.title), summary = scrub(page.summary), body = scrub(page.body);
          const removed = merge(title.removed, summary.removed, body.removed);
          return { slug: page.slug, title: title.text, summary: summary.text, body: body.text, removed, include: !removed.person && !removed.email && !removed.phone };
        });
      } catch {}
    }
    const avatar = agent.avatarUpload ? this.store.avatar(agent.id) : null;
    return {
      agent: { id: agent.id, name: agent.name, color: agent.color, model: agent.model || "", tools: Boolean(agent.tools) },
      personality: { text: personality.text, removed: personality.removed, include: true },
      core: { text: core.text, removed: core.removed, include: true },
      avatar: { uploaded: Boolean(avatar), include: Boolean(avatar) },
      routines, memories, procedures,
      requirements: this.requirements(agent),
      never: ["diary", "messages", "traces", "owners", "permissions", "channels", "accounts", "bots", "mailbox", "github", "desktop", "artifacts", "secretValues"],
    };
  }

  /** The package itself, from the preview and the owner's choices: ids not chosen stay home. */
  async build(agent, choice = {}) {
    const preview = await this.preview(agent);
    const picked = (list, key, chosen) => Array.isArray(chosen) ? list.filter((item) => chosen.includes(item[key])) : list.filter((item) => item.include);
    const flag = (value, fallback) => value === undefined ? fallback : Boolean(value);
    const avatar = flag(choice.avatar, preview.avatar.include) && preview.avatar.uploaded ? this.store.avatar(agent.id) : null;
    const payload = {
      exportedAt: new Date(this.now()).toISOString(),
      agent: {
        name: agent.name, avatarSeed: agent.avatarSeed || "", color: agent.color,
        personality: flag(choice.personality, true) ? preview.personality.text : "",
        character: agent.character || null,
        gender: agent.gender || "", voice: agent.voice || "", voiceLanguage: agent.voiceLanguage || "",
        chattiness: agent.chattiness, tools: Boolean(agent.tools), think: Boolean(agent.think), effort: agent.effort || "",
        model: agent.model || "",
      },
      avatar: avatar ? `data:image/png;base64,${Buffer.from(avatar).toString("base64")}` : "",
      core: flag(choice.core, true) ? preview.core.text : "",
      routines: picked(preview.routines, "id", choice.routines).map(({ kind, name, schedule, runAt, prompt, enabled }) => ({ kind, name, ...(kind === "reminder" ? { runAt } : { schedule }), prompt, enabled })),
      memories: picked(preview.memories, "id", choice.memories).map(({ text, pinned }) => ({ text, pinned })),
      procedures: picked(preview.procedures, "slug", choice.procedures).map(({ slug, title, summary, body }) => ({ slug, title, summary, body })),
      requirements: preview.requirements,
    };
    return sealPackage(payload);
  }

  fileName(agent) { return `${slugify(agent.name) || "agente"}.cora-agent.json`; }

  /* ---------- links ---------- */
  links(agentId = "") {
    const now = this.now();
    const records = this.store.value("agentPackageLinks", []) || [];
    const live = records.filter((link) => !link.revokedAt && Date.parse(link.expiresAt) > now - 30 * 86400000);
    if (live.length !== records.length) this.store.setValue("agentPackageLinks", live);
    return live.filter((link) => !agentId || link.agentId === agentId).map((link) => this.linkView(link));
  }

  linkView(link) {
    const now = this.now();
    const status = link.revokedAt ? "revoked" : Date.parse(link.expiresAt) <= now ? "expired" : link.downloads >= link.maxDownloads ? "used" : "active";
    const { hash, ...view } = link;
    return { ...view, status };
  }

  async createLink(agent, user, { choice = {}, days = 7, downloads = 3, origin = "" } = {}) {
    if (!origin) throw new TransferError("Questo spazio non ha un indirizzo pubblico da dare al link.", 409);
    const life = LINK_DAYS.includes(Number(days)) ? Number(days) : 7;
    const max = Math.min(LINK_MAX_DOWNLOADS, Math.max(1, Math.floor(Number(downloads) || 3)));
    const pack = await this.build(agent, choice);
    const token = randomBytes(32).toString("base64url");
    const link = {
      id: `apl_${randomBytes(6).toString("hex")}`, hash: hashToken(token), agentId: agent.id, agentName: agent.name,
      createdBy: { id: user.id, name: user.name || user.email || "" }, createdAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + life * 86400000).toISOString(), maxDownloads: max, downloads: 0, lastDownloadAt: null, revokedAt: null,
      counts: { routines: pack.payload.routines.length, memories: pack.payload.memories.length, procedures: pack.payload.procedures.length },
      checksum: pack.checksum,
    };
    this.store.setValue(`agentPackage:${link.id}`, pack);
    this.store.setValue("agentPackageLinks", [...(this.store.value("agentPackageLinks", []) || []), link]);
    this.activity({ type: "agent", agentId: agent.id, text: `link di esportazione per ${agent.name} (${life} giorni, ${max} download)` });
    return { ...this.linkView(link), url: `${origin}/agent-packages/${token}` };
  }

  revokeLink(agentId, linkId) {
    const records = this.store.value("agentPackageLinks", []) || [];
    const link = records.find((item) => item.id === linkId && item.agentId === agentId);
    if (!link) throw new TransferError("Link non trovato.", 404);
    link.revokedAt = link.revokedAt || new Date(this.now()).toISOString();
    this.store.setValue("agentPackageLinks", records);
    this.store.setValue(`agentPackage:${link.id}`, null);
    return this.linkView(link);
  }

  /** A download through the link: counted, refused once it is spent, revoked or expired. */
  download(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ""))) return null;
    const records = this.store.value("agentPackageLinks", []) || [];
    const link = records.find((item) => item.hash === hashToken(token));
    if (!link || this.linkView(link).status !== "active") return null;
    const pack = this.store.value(`agentPackage:${link.id}`, null);
    if (!pack) return null;
    link.downloads += 1;
    link.lastDownloadAt = new Date(this.now()).toISOString();
    this.store.setValue("agentPackageLinks", records);
    return { pack, fileName: `${slugify(link.agentName) || "agente"}.cora-agent.json` };
  }

  /* ---------- import ---------- */
  async fetchLink(value, { origin = "" } = {}) {
    let url;
    try { url = new URL(String(value || "").trim()); } catch { throw new TransferError("Incolla il link completo del pacchetto."); }
    const own = origin && url.origin === origin && /^\/agent-packages\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
    if (own) {
      const found = this.download(url.pathname.split("/").pop());
      if (!found) throw new TransferError("Il link non vale più: è scaduto, revocato o ha finito i download.", 410);
      return found.pack;
    }
    try {
      const response = await readPublicLink(url.href, {
        allowLocal: this.allowLocal, maxBytes: PACKAGE_MAX_BYTES, accept: "application/json", userAgent: "Cora Agent Import",
        copy: {
          url: "Il link deve essere un indirizzo HTTPS completo.",
          publicOnly: "Il link deve puntare a un indirizzo Internet pubblico.",
          redirect: "Il link contiene un reindirizzamento non valido.",
          unreadable: "Il link non vale più: è scaduto, revocato o ha finito i download.",
          tooLarge: "Il pacchetto supera i 4 MB.",
          redirects: "Il link contiene troppi reindirizzamenti.",
        },
      });
      return response.text;
    } catch (error) {
      if (error instanceof KnowledgeError) throw new TransferError(error.message, error.upstream === 410 || error.upstream === 404 ? 410 : error.status || 400);
      throw new TransferError("Il link non risponde.", 502);
    }
  }

  /** Reads a package, re-scrubs it on this side too, and keeps it for this person until they confirm. */
  async stage(user, { url = "", file = null, origin = "" } = {}) {
    const raw = url ? await this.fetchLink(url, { origin }) : file;
    if (raw == null || raw === "") throw new TransferError("Carica un file o incolla un link.");
    const payload = this.normalize(openPackage(raw));
    for (const [id, item] of this.staged) if (item.expiresAt <= this.now() || item.userId === user.id) this.staged.delete(id);
    const id = `imp_${randomBytes(8).toString("hex")}`;
    this.staged.set(id, { userId: user.id, payload, source: url ? new URL(url).host : "file", expiresAt: this.now() + STAGED_MS });
    return { id, ...this.importView(payload, url ? new URL(url).host : "file") };
  }

  normalize(payload) {
    const scrub = (text, max) => scrubPersonal(cleanText(text, max)).text;
    const agent = payload.agent && typeof payload.agent === "object" ? payload.agent : {};
    const name = cleanText(agent.name, 32).replace(/[\r\n]/g, " ").trim();
    if (!name) throw new TransferError("Il pacchetto non ha il nome dell'agente.");
    const list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];
    const routines = list(payload.routines, LIMITS.routines).map((routine) => {
      const kind = routine?.kind === "reminder" ? "reminder" : "routine";
      const item = { kind, name: scrub(routine?.name, 80).trim(), prompt: scrub(routine?.prompt, 8000).trim(), enabled: Boolean(routine?.enabled) };
      if (kind === "reminder") item.runAt = String(routine?.runAt || "");
      else item.schedule = cleanText(routine?.schedule, 80).trim();
      try {
        if (kind === "routine") nextRuns(item.schedule, this.timezone, 1);
        else if (!Number.isFinite(Date.parse(item.runAt))) throw new Error("runAt");
        item.valid = Boolean(item.name && item.prompt);
      } catch { item.valid = false; }
      if (kind === "reminder" && Date.parse(item.runAt) <= this.now()) item.valid = false;
      return item;
    });
    const image = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(String(payload.avatar || ""))?.[1];
    let avatar = "";
    if (image) {
      const size = pngSize(Buffer.from(image, "base64"));
      if (size && size.width === size.height && size.width >= 512 && size.width <= 2000) avatar = payload.avatar;
    }
    return {
      exportedAt: cleanText(payload.exportedAt, 40),
      agent: {
        name, avatarSeed: cleanText(agent.avatarSeed, 40).replace(/[^\w-]/g, ""), color: /^#[0-9a-fA-F]{6}$/.test(agent.color) ? agent.color : "",
        personality: scrub(agent.personality, 8000), character: agent.character && typeof agent.character === "object" ? agent.character : null,
        gender: cleanText(agent.gender, 20), voice: cleanText(agent.voice, 40), voiceLanguage: cleanText(agent.voiceLanguage, 10),
        chattiness: Number.isFinite(Number(agent.chattiness)) ? Math.min(1, Math.max(0, Number(agent.chattiness))) : 0.5,
        tools: Boolean(agent.tools), think: Boolean(agent.think), effort: cleanText(agent.effort, 12), model: cleanText(agent.model, 160).trim(),
      },
      avatar,
      core: scrub(payload.core, 4000),
      routines,
      memories: list(payload.memories, LIMITS.memories).map((memory) => ({ text: scrub(memory?.text, 1000).trim(), pinned: Boolean(memory?.pinned) })).filter((memory) => memory.text),
      procedures: list(payload.procedures, LIMITS.procedures).map((page) => ({ slug: slugify(page?.slug || page?.title), title: scrub(page?.title, 120).trim(), summary: scrub(page?.summary, 400), body: scrub(page?.body, 8000) })).filter((page) => page.slug && page.title),
      requirements: {
        secrets: list(payload.requirements?.secrets, 100).map((name) => cleanText(name, 80).toUpperCase().replace(/[^A-Z0-9_]/g, "")).filter(Boolean),
        connectors: list(payload.requirements?.connectors, 20).map((name) => cleanText(name, 30).toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean),
      },
    };
  }

  importView(payload, source) {
    const taken = new Set(this.store.agents().map((agent) => agent.name.toLowerCase()));
    const vaultNames = new Set(this.store.vaultSecrets().map((secret) => secret.name));
    const connected = new Set((this.store.value("keyConnectors", []) || []).filter((record) => !record.disconnected && record.status === "connected").map((record) => record.service));
    return {
      source,
      exportedAt: payload.exportedAt,
      agent: { ...payload.agent, avatar: Boolean(payload.avatar) },
      name: { requested: payload.agent.name, taken: taken.has(payload.agent.name.toLowerCase()), suggestion: this.freeName(payload.agent.name) },
      core: payload.core,
      routines: payload.routines.map((routine, index) => ({ index, ...routine })),
      memories: payload.memories,
      procedures: payload.procedures.map(({ slug, title, summary }) => ({ slug, title, summary })),
      brain: false,
      requirements: {
        secrets: payload.requirements.secrets.map((name) => ({ name, present: vaultNames.has(name) })),
        connectors: payload.requirements.connectors.map((service) => ({ service, connected: connected.has(service) })),
      },
    };
  }

  freeName(name) {
    const taken = new Set(this.store.agents().map((agent) => agent.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 100; n++) {
      const candidate = `${name.slice(0, 28)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${name.slice(0, 24)} ${randomBytes(2).toString("hex")}`;
  }

  /**
   * The new agent: its own id, switched off, belonging to whoever imports it. Routines arrive switched
   * off on the channel chosen for each; memories become its own; procedures go to the brain for review.
   */
  async commit(user, id, choice = {}, { prepare = (body) => body, brainFor = () => null, channels = [] } = {}) {
    const staged = this.stagedFor(user, id);
    const { payload } = staged;
    const name = cleanText(choice.name || payload.agent.name, 32).trim() || payload.agent.name;
    if (this.store.agents().some((agent) => agent.name.toLowerCase() === name.toLowerCase())) throw new TransferError("Esiste già un agente con questo nome: scegline un altro.", 409);
    const known = new Set(channels.map((channel) => channel.id));
    const routineChoice = choice.routines && typeof choice.routines === "object" ? choice.routines : {};
    const chosenRoutines = payload.routines.map((routine, index) => ({ routine, channelId: String(routineChoice[index] ?? "") }))
      .filter(({ routine, channelId }) => routine.valid && channelId && channelId !== "skip");
    for (const { channelId } of chosenRoutines) if (!known.has(channelId)) throw new TransferError("Scegli un canale di questo spazio per ogni routine, oppure non importarla.");
    const take = (key, fallback = true) => choice[key] === undefined ? fallback : Boolean(choice[key]);
    const notes = [];
    let body = {
      name, avatarSeed: payload.agent.avatarSeed, color: payload.agent.color || undefined, personality: payload.agent.personality,
      character: payload.agent.character, gender: payload.agent.gender, voice: payload.agent.voice, voiceLanguage: payload.agent.voiceLanguage,
      chattiness: payload.agent.chattiness, tools: payload.agent.tools, think: payload.agent.think, effort: payload.agent.effort,
      model: payload.agent.model, enabled: false, brainOwnerId: user.id,
    };
    try { body = prepare(body) || body; } catch { notes.push("model"); body = { ...body, model: "" }; }
    let agent;
    try { agent = this.store.createAgent(body); } catch (error) {
      if (!body.model) throw new TransferError(error.message);
      notes.push("model");
      try { agent = this.store.createAgent({ ...body, model: "" }); } catch (again) { throw new TransferError(again.message); }
    }
    const created = { routines: 0, memories: 0, procedures: 0, skippedProcedures: 0 };
    try {
      if (payload.avatar && take("avatar")) this.store.setAvatarImage(agent.id, Buffer.from(payload.avatar.split(",")[1], "base64"));
      if (payload.core && take("core")) this.store.setCore(agent.id, payload.core, "import");
      for (const { routine, channelId } of chosenRoutines) {
        this.store.createRoutine(agent.id, { kind: routine.kind, name: routine.name, prompt: routine.prompt, channelId, enabled: false, ...(routine.kind === "reminder" ? { runAt: routine.runAt } : { schedule: routine.schedule }) });
        created.routines += 1;
      }
      if (take("memories")) for (const memory of payload.memories) { this.store.addMemory(agent.id, memory.text, "import", { pinned: memory.pinned, by: "import" }); created.memories += 1; }
      if (take("procedures") && payload.procedures.length) {
        const brain = brainFor(agent);
        if (!brain) created.skippedProcedures = payload.procedures.length;
        else {
          const existing = new Set((await brain.pages({ kind: "" }).catch(() => [])).map((page) => page.slug));
          for (const page of payload.procedures) {
            if (existing.has(page.slug)) { created.skippedProcedures += 1; continue; }
            await brain.write({ slug: page.slug, kind: "procedure", title: page.title, summary: page.summary, body: page.body, note: `Importata con l'agente ${agent.name}`, author: `import:${agent.name}`, review: "pending" });
            created.procedures += 1;
          }
        }
      }
    } catch (error) {
      this.store.deleteAgent(agent.id);
      throw new TransferError(`Importazione annullata: ${error.message}`, error.status || 400);
    }
    this.staged.delete(id);
    this.activity({ type: "agent", agentId: agent.id, text: `importato ${agent.name} da ${staged.source === "file" ? "file" : staged.source}: ${created.routines} routine, ${created.memories} ricordi, ${created.procedures} procedure` });
    return { agent: this.store.agent(agent.id), created, notes };
  }

  stagedFor(user, id) {
    const item = this.staged.get(String(id || ""));
    if (!item || item.userId !== user.id || item.expiresAt <= this.now()) throw new TransferError("L'anteprima è scaduta: ricarica il pacchetto.", 410);
    return item;
  }
}

function merge(...lists) {
  const out = {};
  for (const list of lists) for (const [kind, n] of Object.entries(list || {})) out[kind] = (out[kind] || 0) + n;
  return out;
}
