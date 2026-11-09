import { lookup } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { BRAIN_KINDS, redactSecrets, slugify } from "./company-brain.js";
import { bm25 } from "./memory.js";
import { transportOf } from "./channels.js";
import { ownerRoom } from "./rooms.js";

const MAX_BYTES = 2 * 1024 * 1024;
const privateNetworks = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) privateNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]]) privateNetworks.addSubnet(network, prefix, "ipv6");

export class KnowledgeError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

export function knowledgeUrl(value, { allowLocal = false } = {}) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new KnowledgeError("Inserisci il link HTTPS di un Brain leggibile.", 400); }
  if (url.href.length > 4096 || url.username || url.password || (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:"))) throw new KnowledgeError("Inserisci il link HTTPS di un Brain leggibile.", 400);
  url.hash = "";
  return url;
}

export function publicKnowledgeAddress(address) {
  const family = isIP(address);
  return Boolean(family && !privateNetworks.check(address, family === 4 ? "ipv4" : "ipv6"));
}

async function readLink(value, { allowLocal = false } = {}) {
  const signal = AbortSignal.timeout(8000);
  let url = knowledgeUrl(value, { allowLocal });
  for (let hop = 0; hop < 5; hop++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
    signal.throwIfAborted();
    if (!addresses.length || (!allowLocal && addresses.some(({ address }) => !publicKnowledgeAddress(address)))) throw new KnowledgeError("Il Brain esterno deve essere raggiungibile tramite un indirizzo Internet pubblico.", 400);
    const pinned = addresses[0];
    const result = await new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: "GET", signal, headers: { Accept: "application/json, text/markdown, text/plain", "User-Agent": "Cora Knowledge" },
        lookup: (_host, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) { response.resume(); if (!response.headers.location) reject(new KnowledgeError("Il link del Brain esterno contiene un reindirizzamento non valido.")); else resolve({ redirect: response.headers.location }); return; }
        if (response.statusCode !== 200) { response.resume(); reject(new KnowledgeError("Il link del Brain esterno non è accessibile in lettura.")); return; }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) { response.destroy(new KnowledgeError("Il Brain esterno supera il limite di lettura.")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), type: String(response.headers["content-type"] || "").split(";")[0] }));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
    if (!result.redirect) return result;
    url = knowledgeUrl(new URL(result.redirect, url).href, { allowLocal });
  }
  throw new KnowledgeError("Il link del Brain esterno contiene troppi reindirizzamenti.");
}

function externalPages({ text, type }) {
  let items;
  if (type === "application/json" || type.endsWith("+json")) {
    let data;
    try { data = JSON.parse(text); } catch { throw new KnowledgeError("Il Brain esterno non contiene dati JSON validi."); }
    items = Array.isArray(data) ? data : data.pages;
    if (!Array.isArray(items)) throw new KnowledgeError("Il link deve restituire le pagine del Brain in JSON o Markdown.");
  } else if (["text/plain", "text/markdown", "text/x-markdown"].includes(type)) {
    items = [{ slug: "knowledge", title: /^#\s+(.+)$/m.exec(text)?.[1] || "Knowledge", body: text }];
  } else throw new KnowledgeError("Il link deve restituire le pagine del Brain in JSON o Markdown.");
  if (items.length > 500) throw new KnowledgeError("Il Brain esterno contiene troppe pagine per un singolo link.");
  const pages = items.filter((item) => item && typeof item.title === "string" && typeof item.body === "string").map((item) => ({
    slug: slugify(item.slug || item.title), title: redactSecrets(item.title).slice(0, 120), summary: redactSecrets(item.summary).slice(0, 400),
    body: redactSecrets(item.body).slice(0, 8000), kind: BRAIN_KINDS.includes(item.kind) ? item.kind : "topic", status: "live", pending: 0, revisions: [],
  }));
  if (pages.length !== items.length || pages.some((page) => !page.slug) || new Set(pages.map((page) => page.slug)).size !== pages.length) throw new KnowledgeError("Il Brain esterno contiene pagine incomplete o nomi duplicati.");
  return pages;
}

export class ExternalBrain {
  constructor({ url, allowLocal = false }) { Object.assign(this, { url, allowLocal }); this.cache = null; this.loading = null; }
  get enabled() { return true; }
  get readonly() { return true; }
  async pages({ fresh = false } = {}) {
    if (!fresh && this.cache && Date.now() - this.cache.at < 30000) return this.cache.pages;
    if (!this.loading) this.loading = Promise.resolve().then(async () => {
      try {
        const url = this.url();
        if (!url) throw new KnowledgeError("Il collegamento al Brain esterno non è disponibile. Ricollegalo nelle impostazioni dell'agente.");
        const pages = externalPages(await readLink(url, { allowLocal: this.allowLocal }));
        this.cache = { at: Date.now(), pages };
        return pages;
      } catch (error) { this.cache = null; throw error instanceof KnowledgeError ? error : new KnowledgeError("Il Brain esterno non risponde. La memoria interna resta esclusa."); }
      finally { this.loading = null; }
    });
    return this.loading;
  }
  async search(query, { limit = 6 } = {}) { return bm25(await this.pages(), query, (page) => `${page.title}\n${page.summary}\n${page.body}`, { limit }).map(({ doc }) => doc); }
  async page(slug) { return (await this.pages()).find((page) => page.slug === slugify(slug)) || null; }
  async searchArchive() { return []; }
  async note() { throw new KnowledgeError("Il Brain esterno è in sola lettura. Non sono consentite scritture né nella memoria interna né in quella esterna."); }
}

export class KnowledgeSources {
  constructor({ store, internal = null, storeSecret, tokenFor = () => "", allowLocal = false, isBusy = () => false, ownerMemory = false }) {
    Object.assign(this, { store, internal, storeSecret, tokenFor, allowLocal, isBusy, ownerMemory });
    this.links = new Map(); this.external = new Map();
    this.changes = new Map();
  }
  keyName(agent) { return this.store.value(`agentBrainLink:${agent.id}`, null)?.secretName || `CORA_KNOWLEDGE_${agent.id.toUpperCase()}`; }
  isExternal(agent) { return agent.brainSource === "external"; }
  ownerId(agent) { return agent.brainOwnerId || `agent:${agent.id}`; }
  get resetAt() { return this.ownerMemory ? Date.parse(this.store.value("knowledgeResetAt", "")) || 0 : 0; }
  afterReset(message) { const cutoff = this.resetAt; return !cutoff || message.at == null || (Number(message.at) || Date.parse(message.at)) >= cutoff; }
  memoryKey(agent) { return "owner:" + this.ownerId(agent); }
  ownerKeys(agentId) {
    const agent = this.store.agent(agentId);
    if (!agent) return [];
    const owner = this.ownerId(agent);
    return [this.memoryKey(agent), ...this.store.agents().filter((other) => !this.isExternal(other) && this.ownerId(other) === owner).map((other) => other.id)];
  }
  ownerIds() { return [...new Set([...(this.store.value("brainOwnerScopes", [])), ...this.store.agents().filter((agent) => !this.isExternal(agent)).map((agent) => this.ownerId(agent)), ...this.store.panelUsers().filter((user) => !user.blocked).map((user) => user.id)])]; }
  contactFor(ownerId) { return this.store.agents().find((agent) => this.ownerId(agent) === ownerId && agent.ownerId)?.ownerId || ""; }
  async exportAll() { return { at: new Date().toISOString(), owners: await Promise.all(this.ownerIds().map(async (id) => ({ id, data: await this.ownerBrain(id).exportAll() }))) }; }
  ownerBrain(ownerId) {
    if (!ownerId) throw new KnowledgeError("Manca il proprietario della memoria.");
    const known = this.store.value("brainOwnerScopes", []);
    if (!known.includes(ownerId)) this.store.setValue("brainOwnerScopes", [...known, ownerId]);
    return this.internal?.forOwner(ownerId);
  }
  proprietorIds(agent) { return [...new Set([agent?.brainOwnerId, ...(agent?.coOwnerIds || [])].filter(Boolean))]; }
  brainScopes(user) {
    const ids = [...new Set([user.id, ...this.agentsFor(user).filter(agent => !this.isExternal(agent)).map(agent => this.ownerId(agent))])];
    return ids.map(id => { const person = this.store.panelUser(id); return { id, name: person?.name || person?.email || id }; });
  }
  forUser(user, ownerId = user.id) {
    if (!this.ownerMemory) return this.internal;
    if (!this.brainScopes(user).some(scope => scope.id === ownerId)) throw new KnowledgeError("Brain privato.", 403);
    return new OwnerBrain({ sources: this, ownerId });
  }
  messageOwner(message) {
    if (!this.afterReset(message)) return "";
    const agent = message.agentId ? this.store.agent(message.agentId) : message.channelId?.startsWith("web-ag_") ? this.store.agent(message.channelId.slice(4)) : null;
    if (agent) return this.isExternal(agent) ? "" : this.ownerId(agent);
    if (message.kind === "agent") return "";
    const person = this.store.panelUser(message.authorId);
    if (person && !person.blocked) return person.id;
    const id = `${transportOf(message.channelId)}:${message.authorId}`;
    const owners = [...new Set(this.store.agents().filter((agent) => !this.isExternal(agent) && this.store.agentOwnerChats(agent).includes(id)).map((agent) => this.ownerId(agent)))];
    if (owners.length === 1) return owners[0];
    const ownerIds = this.store.settings[({ discord: "ownerIds", slack: "slackOwnerIds", telegram: "telegramOwnerIds" })[transportOf(message.channelId)]] || [];
    const admins = this.store.panelUsers().filter((user) => !user.blocked && user.role === "owner");
    const people = admins.some((user) => user.source !== "local") ? admins.filter((user) => user.source !== "local") : admins;
    return ownerIds.includes(message.authorId) && people.length === 1 ? people[0].id : "";
  }
  acceptsMessage(agent, message, channelId) {
    if (!this.ownerMemory) return true;
    const sender = message.agentId && this.store.agent(message.agentId);
    if (!sender && this.store.agentOwnerChats(agent).includes(`${transportOf(channelId)}:${message.authorId}`)) return true;
    if (!sender && ["owner", "human"].includes(message.kind) && transportOf(channelId) !== "web") {
      const contact = `${transportOf(channelId)}:${message.authorId}`;
      if (this.store.hasAgentPermission(contact, agent.id)) return true;
    }
    const person = !sender && this.store.panelUser(message.authorId);
    if (person && !person.blocked && this.proprietorIds(agent).includes(person.id)) return true;
    const owner = sender ? this.ownerId(sender) : person && !person.blocked ? person.id : this.messageOwner({ ...message, channelId });
    return owner === this.ownerId(agent);
  }
  messagesSince(ownerId, since, limit) {
    const agents = this.store.agents().filter((agent) => !this.isExternal(agent) && this.ownerId(agent) === ownerId);
    const ids = agents.map((agent) => agent.id), rooms = agents.map((agent) => `web-${agent.id}`);
    const conditions = ["(kind IN ('owner','human') AND author_id = ?)"];
    const params = [ownerId];
    for (const [column, values] of [["agent_id", ids], ["channel_id", rooms]]) if (values.length) { conditions.push(`${column} IN (${values.map(() => "?").join(",")})`); params.push(...values); }
    for (const contact of new Set(agents.flatMap(agent => this.store.agentOwnerChats(agent)))) {
      const match = /^(discord|slack|telegram):(.+)$/.exec(contact); if (!match) continue;
      const [, transport, id] = match;
      conditions.push(`(kind IN ('owner','human') AND author_id = ? AND ${transport === "slack" ? "channel_id LIKE 'sl:%'" : transport === "telegram" ? "channel_id LIKE 'tg:%'" : "channel_id NOT LIKE 'sl:%' AND channel_id NOT LIKE 'tg:%' AND channel_id NOT LIKE 'web%'"})`); params.push(id);
    }
    const rows = this.store.db.prepare(`SELECT * FROM messages WHERE at > ? AND (${conditions.join(" OR ")}) ORDER BY at LIMIT ?`).all(Math.max(since, this.resetAt), ...params, limit);
    return rows.map((row) => ({ id: row.id, channelId: row.channel_id, at: row.at, authorId: row.author_id, authorName: row.author_name, kind: row.kind, agentId: row.agent_id, content: row.content }));
  }
  shares() { return this.store.value("brainPageShares", []); }
  readableShares(ownerId) { return this.shares().filter((share) => share.ownerId !== ownerId && (share.team || share.users.includes(ownerId))); }
  async share(ownerId, slug, input) {
    const brain = this.ownerBrain(ownerId), page = await brain.page(slug);
    if (!page) throw new KnowledgeError("Pagina non trovata.", 404);
    if (!["private", "team", "people"].includes(input.visibility)) throw new KnowledgeError("Scegli una condivisione valida.", 400);
    const users = input.visibility === "people" && Array.isArray(input.users) ? [...new Set(input.users.map(String))] : [];
    if (users.some((id) => !this.store.panelUser(id) || this.store.panelUser(id).blocked)) throw new KnowledgeError("Scegli persone dello spazio.", 400);
    const records = this.shares(), old = records.find((share) => share.ownerId === ownerId && share.slug === page.slug);
    const share = { id: old?.id || `shared-${randomBytes(8).toString("hex")}`, ownerId, slug: page.slug, team: input.visibility === "team", users };
    this.store.setValue("brainPageShares", [...records.filter((item) => item.id !== share.id), share]);
    return { visibility: share.team ? "team" : share.users.length ? "people" : "private", users: share.users };
  }
  canManage(agent, user) { return Boolean(agent && user && !user.blocked && (this.ownerMemory ? this.proprietorIds(agent).includes(user.id) : user.role === "owner" || this.proprietorIds(agent).includes(user.id))); }
  agentsFor(user) { return this.store.agents().filter((agent) => !this.ownerMemory || this.canManage(agent, user)); }
  roomFor(user) { return this.ownerMemory ? ownerRoom(user.id) : "web"; }
  view(agent, user) {
    const link = this.store.value(`agentBrainLink:${agent.id}`, null);
    const owner = agent.brainOwnerId ? this.store.panelUser(agent.brainOwnerId) : null;
    return { source: this.isExternal(agent) ? "external" : "internal", external: link ? { host: link.host, configured: true } : { host: "", configured: false }, canManage: this.canManage(agent, user), readonly: this.isExternal(agent), owner: owner ? { id: owner.id, name: owner.name || owner.email } : null,
      ...(user?.role === "owner" && (!this.ownerMemory || agent.brainOwnerId === user.id) ? { owners: this.store.panelUsers().filter((person) => !person.blocked).map(({ id, name, email }) => ({ id, name: name || email })) } : {}) };
  }
  assertCurrent(agent) {
    if (this.changes.has(agent.id)) throw new KnowledgeError("La configurazione del Brain è in aggiornamento. Riprova tra poco.");
    const current = this.store.agent(agent.id);
    if (current && ((current.brainSource || "internal") !== (agent.brainSource || "internal") || (current.brainOwnerId || "") !== (agent.brainOwnerId || ""))) throw new KnowledgeError("La fonte del Brain è cambiata. Riprendi il compito con la nuova configurazione.");
  }
  forAgent(agent) {
    this.assertCurrent(agent);
    if (!this.isExternal(agent)) return this.ownerMemory ? new OwnerBrain({ sources: this, ownerId: this.ownerId(agent), agent }) : this.internal;
    if (!this.external.has(agent.id)) this.external.set(agent.id, new ExternalBrain({ url: () => this.links.get(agent.id) || this.tokenFor(this.keyName(agent)), allowLocal: this.allowLocal }));
    return this.external.get(agent.id);
  }
  configure(agent, input, user) {
    const previous = this.changes.get(agent.id) || Promise.resolve();
    const job = previous.catch(() => {}).then(() => this.configureNow(this.store.agent(agent.id), input, user));
    this.changes.set(agent.id, job);
    job.finally(() => { if (this.changes.get(agent.id) === job) this.changes.delete(agent.id); }).catch(() => {});
    return job;
  }
  async configureNow(agent, input, user) {
    if (!agent) throw new KnowledgeError("Agente non trovato.", 404);
    if (!this.canManage(agent, user)) throw new KnowledgeError("Solo il proprietario dell'agente può configurare il suo Brain.", 403);
    const source = input.source ?? agent.brainSource ?? "internal";
    if (!["internal", "external"].includes(source)) throw new KnowledgeError("Scegli Brain interno o esterno.", 400);
    const patch = { brainSource: source };
    if (input.ownerId !== undefined) {
      if (user.role !== "owner" || (this.ownerMemory && agent.brainOwnerId !== user.id)) throw new KnowledgeError("Solo il proprietario originale può riassegnare il Brain.", 403);
      const owner = input.ownerId ? this.store.panelUser(String(input.ownerId)) : null;
      if (input.ownerId && (!owner || owner.blocked)) throw new KnowledgeError("Scegli una persona dello spazio.", 400);
      patch.brainOwnerId = owner?.id || "";
      const account = this.store.subscription(agent.subscriptionId || "");
      if (this.ownerMemory && patch.brainOwnerId !== agent.brainOwnerId && account?.connectedBy?.id && account.connectedBy.id !== patch.brainOwnerId) throw new KnowledgeError("Scegli un account del nuovo proprietario prima di trasferire il Brain.");
      if (this.ownerMemory && patch.brainOwnerId !== agent.brainOwnerId) Object.assign(patch, { ownerId: "", ownerIds: [], coOwnerIds: [] });
    }
    if (this.isBusy(agent)) throw new KnowledgeError("L'agente sta lavorando: termina o ferma il compito prima di cambiare il Brain.");
    let linked = null;
    if (input.url) {
      const url = knowledgeUrl(input.url, { allowLocal: this.allowLocal });
      const secretName = this.store.value(`agentBrainLink:${agent.id}`, null) ? `CORA_KNOWLEDGE_${agent.id.toUpperCase()}_${randomBytes(6).toString("hex").toUpperCase()}` : this.keyName(agent);
      try { await this.storeSecret(secretName, url.href); }
      catch { throw new KnowledgeError("Non è stato possibile salvare il link del Brain esterno.", 502); }
      linked = { url, secretName };
    }
    if (source === "external" && !linked && !this.store.value(`agentBrainLink:${agent.id}`, null)) throw new KnowledgeError("Inserisci il link al Brain esterno.", 400);
    if (this.isBusy(agent)) throw new KnowledgeError("L'agente sta lavorando: riprova quando ha terminato.");
    if (linked) {
      this.links.set(agent.id, linked.url.href);
      this.external.delete(agent.id);
      this.store.setValue(`agentBrainLink:${agent.id}`, { host: linked.url.host, secretName: linked.secretName, updatedAt: new Date().toISOString() });
    }
    return this.store.updateAgent(agent.id, patch);
  }
}

class OwnerBrain {
  constructor({ sources, ownerId, agent = null }) { Object.assign(this, { sources, ownerId, agent }); this.own = sources.ownerBrain(ownerId); }
  get enabled() { return Boolean(this.own?.enabled); }
  get holdsShared() { return true; }
  state(...args) { return this.own.state(...args); }
  stats() { return this.own.stats(); }
  reviewQueue() { return this.own.reviewQueue(); }
  review(input) { return this.own.review(input); }
  note(input) { return this.own.note(input); }
  archive(slug, input) { if (slug.startsWith("shared-")) throw new KnowledgeError("Solo il proprietario modifica questa pagina.", 403); return this.own.archive(slug, input); }
  async write(input) { if (String(input.slug || "").startsWith("shared-")) throw new KnowledgeError("Solo il proprietario modifica questa pagina.", 403); const result = await this.own.write(input); return { ...result, page: await this.page(result.page.slug) }; }
  async sharedPages(query = "", options = {}) {
    if (options.status && options.status !== "live") return [];
    const records = this.sources.readableShares(this.ownerId), groups = new Map();
    for (const record of records) { if (!groups.has(record.ownerId)) groups.set(record.ownerId, []); groups.get(record.ownerId).push(record); }
    const pages = [];
    for (const [ownerId, shares] of groups) {
      const source = this.sources.ownerBrain(ownerId), slugs = shares.map((share) => share.slug);
      const found = query ? await source.search(query, { ...options, slugs }) : await source.pages({ ...options, slugs });
      pages.push(...found.map((page) => ({ ...page, slug: shares.find((share) => share.slug === page.slug).id, readonly: true, shared: true })));
    }
    return pages;
  }
  async pages(options = {}) { return [...(await this.own.pages(options)), ...(await this.sharedPages("", options))]; }
  async search(query, { limit = 6 } = {}) { return [...(await this.own.search(query, { limit })), ...(await this.sharedPages(query, { limit }))].slice(0, limit); }
  async page(slug) {
    if (!String(slug).startsWith("shared-")) {
      const page = await this.own.page(slug);
      if (!page) return null;
      const share = this.sources.shares().find((item) => item.ownerId === this.ownerId && item.slug === page.slug);
      return { ...page, readonly: false, sharing: { visibility: share?.team ? "team" : share?.users.length ? "people" : "private", users: share?.users || [] } };
    }
    const share = this.sources.readableShares(this.ownerId).find((item) => item.id === slug);
    if (!share) return null;
    const page = await this.sources.ownerBrain(share.ownerId).page(share.slug);
    if (!page || page.status !== "live") return null;
    const shares = this.sources.readableShares(this.ownerId).filter((item) => item.ownerId === share.ownerId);
    const body = page.body.replace(/\[\[([a-z0-9-]{2,60})\]\]/g, (_, target) => { const link = shares.find((item) => item.slug === target); return link ? `[[${link.id}]]` : target; });
    return { ...page, slug: share.id, body, revisions: [], readonly: true, shared: true };
  }
  async searchArchive(query, options = {}) {
    const channelIds = this.agent ? this.sources.agentChannels?.(this.agent) || [] : null;
    return this.own.searchArchive(query, { ...options, channelIds });
  }
  async graph(options) {
    const graph = await this.own.graph(options);
    const pages = await this.sharedPages();
    return { ...graph, nodes: [...graph.nodes, ...pages.map((page) => ({ slug: page.slug, kind: page.kind, title: page.title, summary: page.summary, readonly: true, shared: true, pending: 0, updatedAt: page.updatedAt }))] };
  }
}
