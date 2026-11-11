import { keyHint } from "./key-hint.js";
import { encryptedSpaceFor, encryptedFolder } from "./encrypted-space.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { AccessInvitations } from "./access-invitations.js";
import { PanelMcp } from "./panel-mcp.js";
import { drawnAvatar } from "./avatar.js";
import { passLedger, verifyPass } from "./pass.js";
import { shareHosts } from "./share-host.js";
import { SEND_MARK, SEND_STYLE, sendPages } from "./send-pages.js";
import { pngSize } from "./png.js";
import { TRANSPORT_LABELS, slackIds, telegramChatId } from "./channels.js";
import { Slack } from "./slack.js";
import { SLACK_CONFIG_SECRET } from "./slack-apps.js";
import { Telegram } from "./telegram.js";
import { telegramSetup } from "./telegram-setup.js";
import { pullModel } from "./llm.js";
import { telegramBotEnvName } from "./telegram-bots.js";
import { isWebRoom, isSalotto, ownerRoom, roomAgentId } from "./rooms.js";
import { nextRuns } from "./scheduler.js";
import { SHARED } from "./store.js";
import { modelKeyBackend } from "./hermes-keys.js";
import { BRAIN_KINDS } from "./company-brain.js";
import { VOICE_LANGUAGES } from "./voice.js";
import { contextSources, writeContextFile } from "./context.js";
import { brainsInUse, testRule } from "./rule-test.js";
import { connectorCatalog, KEY_SERVICES } from "./connectors/index.js";
import { KeyConnectorError } from "./connectors/key-connectors.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const COOKIE = "cora_session";
// Over HTTPS the session cookie is __Host-: no sibling host under the same domain (a share) can plant one.
const HOST_COOKIE = "__Host-cora_session";
const SESSION_DAYS = 30;
const LIVE_STEPS = 60;
// Sessions issued before the __Host- name still arrive under the old one; they are moved over once.
const LEGACY_SESSIONS_UNTIL = Date.parse("2026-11-07T00:00:00Z") + SESSION_DAYS * 86400000;
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/assets/app.js": ["app.js", "text/javascript; charset=utf-8"],
  // The same pure module the server uses: the panel previews the prompt it will really get.
  "/assets/character.js": ["../src/character.js", "text/javascript; charset=utf-8"],
  "/assets/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/assets/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/assets/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/assets/icon-192.png": ["icon-192.png", "image/png"],
  "/assets/icon-512.png": ["icon-512.png", "image/png"],
  "/assets/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
  "/assets/send.js": ["send.js", "text/javascript; charset=utf-8"],
  "/assets/encrypted-space.js": ["encrypted-space.js", "text/javascript; charset=utf-8"],
};
const CSP = [
  "default-src 'self'",
  "img-src 'self' https: data: blob:",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "frame-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** A path on this panel to land on after signing in: never another host. */
function safeNext(value) {
  const next = String(value || "");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && next.length < 2000 ? next : "/";
}

/**
 * A one-time sign-in link for when usecora.space cannot be reached, made on
 * the host with the session key (bin/login-link.mjs).
 */
export function loginLinkToken(sessionKey, now = Date.now()) {
  const body = `${now + 10 * 60000}.${randomBytes(12).toString("base64url")}`;
  return `${body}.${sign(sessionKey, `link.${body}`)}`;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sign(key, value) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** The host an Origin header names, or null when it names none ("null" from a sandboxed page). */
function originHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Requests another site, or a sibling host under the same domain, may not make here:
 * only a top-level visit to a page. The panel's API, its event stream and the desktops
 * answer only the panel itself.
 */
function foreignRequest(req, path) {
  const site = req.headers["sec-fetch-site"];
  if (site !== "same-site" && site !== "cross-site") return false;
  if (path === "/healthz" || path === "/auth/cloud" || path === "/auth/link" || path.startsWith("/avatars/") || path.startsWith("/api/cloud/")) return false;
  const visit = req.headers["sec-fetch-mode"] === "navigate" && (req.headers["sec-fetch-dest"] || "document") === "document";
  if (path.startsWith("/api/")) return true;
  return !visit && path.startsWith("/box/");
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

// What the panel may show of an artifact as it is: pictures, sound and video. SVG only as an image, sandboxed.
const INERT_MEDIA = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};
// Readable as text: valid UTF-8 without control characters other than tabs and line breaks.
const TEXTUAL = /^[^\u0000-\u0008\u000e-\u001f\ufffd]*$/;

const RULE_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const RULE_TARGETS = ["reply", "comment"];

/** An owner's doc rule as the panel sends it, checked and filled in; doc reads the result. */
export function cleanDocRule(input, taken = new Set()) {
  const name = String(input?.name || "").trim().slice(0, 60);
  const question = String(input?.question || "").trim();
  const on = [...new Set(Array.isArray(input?.on) ? input.on.filter((target) => RULE_TARGETS.includes(target)) : [])];
  if (!name) throw new HttpError(400, "dai un nome al controllo");
  if (!question || question.length > 500) throw new HttpError(400, "scrivi cosa deve riconoscere Jev, in al massimo 500 caratteri");
  if (!on.length) throw new HttpError(400, "scegli se controlla i messaggi in chat, i commenti o entrambi");
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34);
  let key = RULE_KEY.test(String(input?.key || "")) ? String(input.key) : /^[a-z]/.test(slug) ? slug : `rule_${slug}`.replace(/_$/, "");
  for (let index = 2; taken.has(key) || !RULE_KEY.test(key); index += 1) key = `${key.replace(/_\d+$/, "").slice(0, 36)}_${index}`;
  const keywords = (Array.isArray(input?.keywords) ? input.keywords : String(input?.keywords || "").split(","))
    .map((word) => String(word).trim().toLowerCase()).filter(Boolean).slice(0, 10).map((word) => word.slice(0, 40));
  const threshold = Number(input?.threshold);
  return {
    key, name, on, question,
    reason: `breaks the rule "${name}"`,
    fix: String(input?.fix || "").trim().slice(0, 300) || "Write it again without it.",
    keywords,
    threshold: threshold >= 0.5 && threshold <= 0.95 ? threshold : 0.8,
    enabled: input?.enabled !== false,
  };
}

async function readJson(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export function createWeb({ config, store, subscriptions, discord, telegram, slack = null, channels, boxes, llm, orchestrator, brain, bots, tgBots, skBots = null, activity, storeSecret, traces, push = null, voice = null, companyBrain = null, librarian = null, slackApps = null, syncMainSlackApp = null, artifacts = null, vault = null, credentials = null, github = null, mailDomains = null, email = null, googleConnector = null, keyConnectors = null, knowledge = null }) {
  // Tries of a doc rule across the brains in use: they take a while, so the panel follows them.
  const ruleTests = new Map();
  const encrypted = encryptedSpaceFor(store, { llm, knowledge, artifacts, publicOrigin: config.publicHost ? `https://${config.publicHost}` : "" });
  const sessionKey = config.sessionKey || config.adminPassword;
  const failures = [];
  // On usecora.space the cloud signs people in; this panel only checks the pass it hands over.
  const cloud = config.cloudUrl && config.cloudKey && config.cloudSpace ? {
    url: config.cloudUrl.replace(/\/$/, ""),
    key: config.cloudKey,
    audience: config.publicHost || `${config.cloudSpace}.${new URL(config.cloudUrl).host}`,
    login: `${config.cloudUrl.replace(/\/$/, "")}/go/${config.cloudSpace}`,
    logout: `${config.cloudUrl.replace(/\/$/, "")}/logout`,
  } : null;
  const invitations = new AccessInvitations({ store, cloud, space: config.cloudSpace });
  const firstUse = passLedger();
  // A share's own address: answered before anything of the panel, which never runs there.
  const shares = shareHosts({ config, store, artifacts, vault, cloud, firstUse, sessionKey, activity });
  // The panel frames a PDF from the space's own preview host, never from its own origin.
  const shareDomain = artifacts?.shareSuffix ? artifacts.shareSuffix.split(".").slice(1).join(".") : "";
  const framedCsp = shareDomain ? CSP.replace("frame-src 'self'", `frame-src 'self' https://*.${shareDomain}`) : CSP;
  // The manifest of an agent's GitHub App is posted to GitHub straight from the panel.
  const panelCsp = github ? framedCsp.replace("form-action 'self'", `form-action 'self' ${new URL(github.webBase).origin}`) : framedCsp;
  // The vault's pages for people outside the panel: a request to fill, a send to open.
  const vaultPages = sendPages({ vault, store, timezone: config.timezone, whoOf: (req) => shares.whoOf(req) });

  /**
   * Where GitHub sends the owner back, from another site: the panel's cookie does not come
   * along, so the app's state (signed here, used once) and GitHub's own answers say who it is
   * for. A small page then opens the panel from here, where the cookie comes along again.
   */
  const githubReturn = async (res, url) => {
    const page = (status, title, text, agentId = "") => {
      const back = agentId ? `/#/agent/${encodeURIComponent(agentId)}/profilo` : "/";
      const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${status === 200 ? `<meta http-equiv="refresh" content="1;url=${esc(back)}">` : ""}<title>${esc(title)}</title><style>${SEND_STYLE}</style></head><body><main>${SEND_MARK}<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="button" href="${esc(back)}">Torna a Cora</a></main></body></html>`);
    };
    try {
      if (url.pathname === "/github/created") {
        const agent = await github.created({ code: url.searchParams.get("code"), state: url.searchParams.get("state") });
        return page(200, "App GitHub creata", `L'app di ${agent.name} c'è: ora installala sull'organizzazione dal pannello.`, agent.id);
      }
      if (url.pathname === "/github/installed") {
        const agent = store.agent(String(url.searchParams.get("agent") || ""));
        if (!agent || !github.record(agent)) return page(404, "Agente non trovato", "Questa installazione non è di un agente di questa Cora.");
        const view = await github.installed(agent, url.searchParams.get("installation_id"), { state: url.searchParams.get("state") || "" });
        const added = view.installations.find((item) => item.id === Number(url.searchParams.get("installation_id")));
        return added?.approved ? page(200, "App GitHub installata", `${agent.name} ora lavora anche su ${added.account}.`, agent.id)
          : page(200, "Installazione da approvare", `L'app di ${agent.name} è stata installata su ${added?.account || "un account"}: la usa quando il proprietario la approva nel pannello.`, agent.id);
      }
      return page(404, "Non trovato", "Questo indirizzo non porta da nessuna parte.");
    } catch (error) {
      activity({ type: "github", text: `ritorno da GitHub: ${error.message}` });
      return page(error.status && error.status < 500 ? error.status : 502, "Non è andata", error.message);
    }
  };

  /**
   * Who may put the agents to work besides the owner: the people who wrote in the chats
   * (owners and agents left out), the permissions given, and whether this user can change them.
   */
  const permissionsView = (user) => {
    const { settings } = store;
    const owners = { discord: settings.ownerIds, telegram: settings.telegramOwnerIds, slack: settings.slackOwnerIds };
    const grants = new Map(settings.permissions.map((grant) => [grant.id, grant]));
    const people = store.speakers(300)
      .filter((person) => !owners[person.transport]?.includes(person.userId))
      .map((person) => ({ id: `${person.transport}:${person.userId}`, transport: person.transport, name: person.name, last: person.last, messages: person.messages }));
    for (const grant of settings.permissions) if (!people.some((person) => person.id === grant.id)) people.push({ id: grant.id, transport: grant.id.split(":")[0], name: grant.name || grant.id, last: 0, messages: 0 });
    return { canManage: user.role === "owner", people: people.map((person) => ({ ...person, agents: grants.get(person.id)?.agents || [], ...(grants.get(person.id)?.excludedAgents?.length ? { excludedAgents: grants.get(person.id).excludedAgents } : {}) })) };
  };
  const agentPermissionsView = async (agent, user) => {
    const visible = await Promise.all(channels.listFor(agent).map(async (channel) => {
      if (channel.kind === "discord" && bots && !await bots.canRead(agent, channel.id).catch(() => false)) return null;
      return channel.id;
    }));
    const ids = new Set(visible.filter(Boolean));
    for (const [id, owner] of orchestrator.dmAgent) if (owner === agent.id) ids.add(id);
    for (const id of store.archivedChannels()) {
      const parent = channels.info(id)?.parentId;
      if ((parent && ids.has(parent)) || (id.startsWith("sl:") && [...ids].some((channel) => id.startsWith(channel + ":")))) ids.add(id);
    }
    const people = store.speakers(500, { channelIds: [...ids], agentId: agent.id }).map((person) => ({
      id: `${person.transport}:${person.userId}`, transport: person.transport, name: person.name, last: person.last,
    }));
    for (const grant of store.settings.permissions) {
      if ((grant.agents.includes("*") || grant.agents.includes(agent.id)) && !people.some((person) => person.id === grant.id)) people.push({ id: grant.id, transport: grant.id.split(":")[0], name: grant.name || grant.id, last: 0 });
    }
    return { canManage: knowledge?.ownerMemory ? knowledge.canManage(agent, user) : user.role === "owner", people: people.map((person) => ({
      ...person, allowed: store.hasAgentPermission(person.id, agent.id), inherent: store.agentOwnerChats(agent).includes(person.id),
    })) };
  };
  /** Every Slack app brought in line with the panel now, Cora's own first. */
  const syncSlackApps = async () => {
    const records = { main: await syncMainSlackApp?.({ force: true }).catch(() => null) };
    for (const agent of store.agents()) records[agent.id] = await skBots?.syncApp(agent, { force: true }).catch(() => null);
    return records;
  };

  /** A shared fact written in the panel, with a company brain: a note for the librarian, signed by whoever wrote it. */
  const noteForBrain = async (text, agent, user) => {
    const fact = String(text || "").trim();
    if (!fact) throw new HttpError(400, "scrivi il ricordo");
    return (knowledge?.forAgent(agent) || companyBrain).note({ text: fact, agentId: agent.id, author: user?.name || user?.email || "Owner" });
  };
  const localOwner = () => store.panelUser("local-owner") || store.registerPanelUser({ id: "local-owner", name: "Owner", email: "", role: "owner", source: "local" });
  const sessionHash = (token) => createHash("sha256").update(token).digest("hex");
  const sessionCookie = (identity = localOwner()) => {
    const user = store.registerPanelUser(identity);
    const expires = Date.now() + SESSION_DAYS * 86400000;
    const token = randomBytes(32).toString("base64url");
    store.createPanelSession(sessionHash(token), user.id, expires);
    const value = `v2.${token}.${sign(sessionKey, `session.v2.${token}`)}`;
    store.auditAccess(user.id, "sign-in");
    return sessionCookieLine(value);
  };
  const cookieName = config.insecureCookies ? COOKIE : HOST_COOKIE;
  const sessionCookieLine = (value, maxAge = SESSION_DAYS * 86400) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.insecureCookies ? "" : "; Secure"}`;
  const clearedCookies = () => [sessionCookieLine("", 0), ...(cookieName === COOKIE ? [] : [`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`])];

  /** The session cookie a request carries: its own name, or the old one for a session issued before the rename. */
  const sessionValue = (req) => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[cookieName]) return { value: cookies[cookieName], legacy: false };
    if (cookieName !== COOKIE && cookies[COOKIE]) return { value: cookies[COOKIE], legacy: true };
    return { value: "", legacy: false };
  };

  const sessionFrom = ({ value, legacy }) => {
    if (!value) return null;
    const parts = value.split(".");
    if (parts[0] === "v2") {
      const [, token, signature, extra] = parts;
      if (!token || !signature || extra || !safeEqual(signature, sign(sessionKey, `session.v2.${token}`))) return null;
      if (legacy && !(store.panelSessionExpiry(sessionHash(token)) < LEGACY_SESSIONS_UNTIL)) return null;
      return store.panelSession(sessionHash(token));
    }
    const [expires, signature, extra] = parts;
    if (extra || !expires || !signature || Number(expires) < Date.now() || (legacy && Number(expires) >= LEGACY_SESSIONS_UNTIL)) return null;
    if (!safeEqual(signature, sign(sessionKey, `session.${expires}`))) return null;
    return localOwner();
  };

  const sessionUser = (req) => (sessionKey ? sessionFrom(sessionValue(req)) : null);

  /** A valid session under the old name moves to the __Host- one, and the old cookie goes. */
  const moveLegacyCookie = (req, res) => {
    const found = sessionValue(req);
    if (!found.legacy || !sessionKey || !sessionFrom(found)) return;
    res.setHeader("Set-Cookie", [sessionCookieLine(found.value), `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`]);
  };
  const authed = (req) => Boolean(sessionUser(req));
  const accessConnections = new Set();
  const invalidateConnections = () => {
    for (const connection of accessConnections) {
      if (!store.allowsPanelUser({ ...connection.user, emailVerified: true })) connection.close();
    }
  };
  const cloudIdentity = (fields) => ({ id: fields.sub, name: fields.name || "", email: fields.email || "", avatar: fields.avatar || "",
    role: fields.role === undefined || fields.role === "owner" ? "owner" : "member", emailVerified: fields.emailVerified === true, source: "cloud" });

  const send = (res, status, body, headers = {}) => {
    const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": typeof body === "string" || Buffer.isBuffer(body) ? "text/plain; charset=utf-8" : "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN",
      ...headers,
    });
    res.end(payload);
  };

  /**
   * An agent's picture, open to anyone: Slack and Discord fetch it to show the agent.
   * Its address carries the picture's version, so the current one is kept for good.
   */
  const avatarFile = (res, url, agentId) => {
    const agent = store.agent(agentId);
    if (!agent) throw new HttpError(404, "not found");
    const current = url.searchParams.get("v") === agent.avatarVersion;
    return send(res, 200, store.avatar(agent.id), { "Content-Type": "image/png", "Cache-Control": current ? "public, max-age=31536000, immutable" : "no-cache" });
  };

  const boxStatus = async (agent) => {
    try {
      return await Promise.race([boxes.inspect(agent.id), new Promise((resolve) => setTimeout(() => resolve({ status: "unknown" }), 5000))]);
    } catch (error) {
      return { status: "error", error: error.message };
    }
  };

  const hardware = { at: 0, value: null };
  const pulls = new Set();
  const publicAgent = async (agent) => ({
    ...agent,
    // Which personal key it runs with, never the value. Null means the space key, when the model needs one.
    credential: credentials && agent.credentialId ? credentials.view(store.credential(agent.credentialId)) : null,
    ...(knowledge?.ownerMemory || agent.brainSource === "external" ? { core: "" } : {}),
    // Who it answers to: a real person in the chats; null means the owner of the space.
    owner: store.agentOwner(agent),
    mailbox: store.value(`agentMailbox:${agent.id}`, null),
    memoryCount: agent.brainSource === "external" ? 0 : knowledge?.ownerMemory ? knowledge.ownerKeys(agent.id).reduce((sum, key) => sum + store.memoryCount(key), 0) : store.memoryCount(agent.id),
    box: await boxStatus(agent),
    bot: bots ? bots.status(agent, store.settings.guildIds[0]) : null,
    telegramBot: tgBots ? await tgBots.status(agent, telegramChatId(channels.list()[0]?.id) || store.settings.telegramChatIds[0]) : null,
    slackBot: skBots ? await skBots.status(agent, slackIds(channels.list()[0]?.id)?.channelId || store.settings.slackChannelIds[0]) : null,
    github: github ? github.view(agent) : null,
  });

  const privateOwner = (entry) => {
    if (entry.ownerId) return entry.ownerId;
    if (isSalotto(entry.room) || isSalotto(entry.channelId) || isSalotto(entry.trace?.channelId)) {
      const room = entry.room || entry.channelId || entry.trace.channelId;
      return knowledge.ownerIds().find((id) => ownerRoom(id) === room) || "unavailable";
    }
    if (entry.room?.startsWith("web-ag_")) { const agent = store.agent(entry.room.slice(4)); return agent ? knowledge.ownerId(agent) : "unavailable"; }
    const id = entry.agentId || entry.trace?.agentId;
    if (id && !String(id).startsWith("librarian:") && !store.agent(id)) return "unavailable";
    if (String(id || "").startsWith("librarian:")) return id.slice(10);
    const agent = id && store.agent(id);
    return agent ? knowledge.ownerId(agent) : "";
  };
  const ownsEntry = (entry, viewer) => {
    const candidateId = entry.agentId || entry.trace?.agentId || (entry.room?.startsWith("web-ag_") ? entry.room.slice(4) : "") || (entry.channelId?.startsWith("web-ag_") ? entry.channelId.slice(4) : "");
    if (knowledge?.isSealed(store.agent(candidateId))) return knowledge.canManage(store.agent(candidateId), viewer);
    if (!knowledge?.ownerMemory) return true;
    const personalRoom = isSalotto(entry.room) || isSalotto(entry.channelId) || isSalotto(entry.trace?.channelId);
    const agentId = entry.agentId || entry.trace?.agentId || (entry.room?.startsWith("web-ag_") ? entry.room.slice(4) : "");
    if (!personalRoom && agentId && knowledge.canManage(store.agent(agentId), viewer)) return true;
    return privateOwner(entry) === viewer?.id || (!privateOwner(entry) && !entry.text && !entry.item && !entry.trace && !entry.agentId && !entry.id);
  };
  const quotaAgentsFor = (viewer) => knowledge?.agentsFor(viewer) || store.agents();
  const usesQuotaAccount = (agent, record) => String(agent.model || store.settings.defaultModel || "").startsWith(`${record.provider}/`)
    && (record.server || agent.subscriptionId === record.id || (record.resident && store.settings.useResidentSubscriptions && !agent.subscriptionId));
  const canReadQuota = (record, viewer) => Boolean(record && (!knowledge?.ownerMemory || quotaAgentsFor(viewer).some((agent) => usesQuotaAccount(agent, record)
    && (record.server || (record.connectedBy?.id && knowledge.proprietorIds(agent).includes(record.connectedBy.id))))));
  const quotaAccountsFor = (viewer) => subscriptions.list().filter((record) => canReadQuota(record, viewer)).map(({ id, provider, label, email, plan, status, resident, installed }) =>
    ({ id, provider, label, email, plan, status, resident, installed, usage: subscriptions.usage.get(id) }));
  const providerQuotasFor = (viewer) => viewer.role === "owner" ? subscriptions.usage.connections().filter((record) => canReadQuota(record, viewer)) : [];
  const checkAgentMemory = (id, viewer) => {
    if ((knowledge?.ownerMemory || knowledge?.isSealed(store.agent(id))) && !knowledge.canManage(store.agent(id), viewer)) throw new HttpError(403, "Questi dati appartengono al proprietario dell'agente.");
  };

  const routineView = (routine) => {
    let next = [];
    if (routine.kind === "reminder") {
      if (!routine.lastRunAt || routine.lastStatus === "skipped") next = [routine.runAt];
    } else try { next = nextRuns(routine.schedule, config.timezone, 1).map((date) => date.toISOString()); } catch {}
    return { ...routine, nextRunAt: next[0] || null, running: orchestrator.routineRuns.has(routine.id) };
  };

  const ensureBoxSoon = (agent) => {
    if (!agent.enabled || !agent.tools) return;
    boxes.ensure(agent).catch((error) => activity({ type: "error", agentId: agent.id, text: `desktop: ${error.message}` }));
  };

  // Slack and Telegram apps belong to the agent, like a bot created on its own account.
  // The space owner can connect either one for anybody. Private brains stay with their proprietors.
  const ownerTransport = (person, pathname) => person?.role === "owner" && /^\/api\/agents\/[\w-]+\/(?:slack-bot|telegram-bot|slack-app)$/.test(pathname);

  // Where a service sends the owner back after an OAuth authorisation: the public address, else the one the panel was opened on.
  const connectorOrigin = (req) => config.publicHost ? `https://${config.publicHost}` : cloud ? `https://${cloud.audience}` : `${config.insecureCookies ? "http" : "https"}://${String(req.headers.host || "127.0.0.1").replace(/[^\w.:\-\[\]]/g, "")}`;

  const panelMcp = new PanelMcp({
    store, dispatch: (req, res, url, user) => api(req, res, url, user),
    publicOrigin: config.publicHost ? `https://${config.publicHost}` : cloud ? `https://${cloud.audience}` : "",
    insecure: config.insecureCookies === true,
    authorize: (user, method, url) => {
      const agentId = /^\/api\/agents\/([\w-]+)(?:\/|$)/.exec(url.pathname)?.[1];
      if (agentId && !knowledge?.canManage(store.agent(agentId), user) && !ownerTransport(user, url.pathname)) throw new HttpError(403, "Agente privato.");
      const routineId = /^\/api\/routines\/(rt_[\w-]+)(?:\/|$)/.exec(url.pathname)?.[1];
      const routine = routineId && store.routine(routineId);
      if (routine && !knowledge?.canManage(store.agent(routine.agentId), user)) throw new HttpError(404, "Routine non trovata.");
      if (user.role !== "owner" && method !== "GET" && (url.pathname === "/api/subscriptions/resident/check" || !/^\/api\/(?:agents|routines|brain|subscriptions|connectors|artifacts|secrets|rooms|push)(?:\/|$)/.test(url.pathname))) throw new HttpError(403, "Solo il proprietario gestisce le impostazioni dello spazio.");
    },
  });

  async function api(req, res, url, actingUser = null) {
    const path = url.pathname;
    const method = req.method;
    if (path === "/api/me" && method === "GET") {
      const user = actingUser || sessionUser(req);
      return send(res, 200, { authed: Boolean(user), ...(user ? { user } : {}), cloud: cloud ? { login: cloud.login, logout: cloud.logout } : null });
    }
    if (path === "/api/login" && method === "POST") {
      if (cloud) throw new HttpError(403, "si entra da usecora.space");
      const now = Date.now();
      while (failures.length && now - failures[0] > 60000) failures.shift();
      if (failures.length >= 5) throw new HttpError(429, "troppi tentativi, riprova tra un minuto");
      const body = await readJson(req, 4096);
      if (!config.adminPassword || !safeEqual(String(body.password || ""), config.adminPassword)) {
        failures.push(now);
        throw new HttpError(401, "password sbagliata");
      }
      return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie() });
    }
    const user = actingUser ? store.panelUser(actingUser.id) : sessionUser(req);
    if (!user) throw new HttpError(401, "login richiesto");
    if (actingUser && !store.allowsPanelUser({ ...user, emailVerified: true })) throw new HttpError(401, "Accesso revocato.");
    if (!["GET", "HEAD"].includes(method) && path !== "/api/logout") {
      const action = path.startsWith("/api/secrets") ? "secrets" : path.startsWith("/api/artifacts") ? "artifacts" : path.startsWith("/api/context") ? "context" : path.startsWith("/api/access") ? "access-policy" : path.startsWith("/api/permissions") ? "permissions" : path.startsWith("/api/brain") ? "brain" : path.startsWith("/api/rooms") ? "message" : path.startsWith("/api/agents") ? "agent" : path.startsWith("/api/subscriptions") || path.startsWith("/api/providers") ? "connections" : "settings";
      res.once("finish", () => { if (res.statusCode < 400) { try { store.auditAccess(user.id, action); } catch {} } });
    }
    const scopedAgent = /^\/api\/agents\/([\w-]+)(?:\/|$)/.exec(path);
    if (scopedAgent && (knowledge?.isSealed(store.agent(scopedAgent[1])) || (knowledge?.ownerMemory && !ownerTransport(user, path)))) checkAgentMemory(scopedAgent[1], user);
    if (path.startsWith("/api/encrypted")) {
      if (actingUser) throw new HttpError(403, "Lo sblocco richiede la sessione personale del browser.");
      const body = method === "GET" || method === "DELETE" ? {} : await readJson(req, 4 * 1024 * 1024);
      if (path === "/api/encrypted/settings" && ["GET", "PUT"].includes(method)) return send(res, 200, encrypted.settings(user, method === "PUT" ? body : null));
      if (path === "/api/encrypted/recipients" && method === "GET") return send(res, 200, encrypted.recipients(user));
      const agentMatch = /^\/api\/encrypted\/agents\/([\w-]+)$/.exec(path);
      if (agentMatch && ["GET", "PUT"].includes(method)) return send(res, 200, encrypted.agentSettings(agentMatch[1], user, method === "PUT" ? body : null));
      const folderMatch = /^\/api\/encrypted\/folders\/(af_[a-f0-9]{12})(?:\/(configure|challenge|methods|documents|requests|read|share|receive|export))?$/.exec(path);
      if (folderMatch) {
        const [, folderId, action] = folderMatch;
        if (!action && method === "GET") return send(res, 200, encrypted.documents(folderId, user));
        if (action === "documents" && method === "GET") {
          encrypted.folder(folderId, user); return send(res, 200, encrypted.document(folderId, url.searchParams.get("document"), Number(url.searchParams.get("version"))));
        }
        if (action === "share" && method === "POST") return send(res, 201, encrypted.share(folderId, user, body));
        if (action === "receive" && method === "POST") return send(res, 200, encrypted.receive(folderId, user, body));
        if (action === "export" && method === "POST") return send(res, 200, encrypted.export(folderId, user, body));
        if (action === "configure" && method === "POST") return send(res, 201, encrypted.configure(folderId, user, body));
        if (action === "challenge" && method === "POST") return send(res, 201, encrypted.challenge(folderId, user, body));
        if (action === "methods" && method === "PUT") return send(res, 200, encrypted.methods(folderId, user, body));
        if (action === "documents" && method === "POST") return send(res, 201, encrypted.saveDocument(folderId, user, body));
        if (action === "read" && method === "POST") {
          const folder = encrypted.folder(folderId, user);
          encrypted.prove(folder, user, body.proof, "read"); encrypted.audit(user.id, "read", folder);
          return send(res, 200, { ok: true });
        }
        if (action === "requests" && method === "POST") {
          const agent = store.agent(body.agent); if (!agent) throw new HttpError(404, "Agente non disponibile.");
          return send(res, 201, encrypted.request(agent, { ...body, folder: folderId }, user.id));
        }
      }
      const requestMatch = /^\/api\/encrypted\/requests\/(er_[a-f0-9]{24})(?:\/(approve))?$/.exec(path);
      if (requestMatch) {
        const request = encrypted.getRequest(requestMatch[1], user);
        if (method === "GET" && !requestMatch[2]) return send(res, 200, request);
        if (method === "DELETE" && !requestMatch[2]) return send(res, 200, encrypted.cancel(request, "revoked"));
        if (method === "POST" && requestMatch[2]) return send(res, 200, await encrypted.approve(request.id, user, body));
      }
      throw new HttpError(404, "Operazione cifrata non disponibile.");
    }
    if (path === "/api/mcp/tokens") {
      if (method === "GET") return send(res, 200, panelMcp.view(user, req));
      if (method === "POST") return send(res, 201, panelMcp.create(user, await readJson(req, 4096)));
      throw new HttpError(405, "Metodo non supportato.");
    }
    const mcpToken = /^\/api\/mcp\/tokens\/([a-f0-9]{16})$/.exec(path);
    if (mcpToken && method === "DELETE") { panelMcp.revoke(user, mcpToken[1]); return send(res, 200, { ok: true }); }
    if (path === "/api/logout" && method === "POST") {
      const token = sessionValue(req).value.split(".")[1];
      if (token) store.deletePanelSession(sessionHash(token));
      return send(res, 200, { ok: true }, { "Set-Cookie": clearedCookies() });
    }

    if (path === "/api/connectors" && method === "GET") return send(res, 200, { ...googleConnector.view(user), catalog: connectorCatalog({ origin: connectorOrigin(req) }), keyConnectors: keyConnectors ? keyConnectors.view() : [], canManage: Boolean(knowledge?.ownerMemory || user.role === "owner"), notice: store.value("googleConnectorNotice", "") });
    const oauthStart = /^\/api\/connectors\/keys\/([a-z][a-z0-9-]{1,40})\/authorize$/.exec(path);
    if (oauthStart && method === "POST") {
      if (!keyConnectors || !KEY_SERVICES[oauthStart[1]]) throw new HttpError(404, "Connettore non disponibile.");
      if (!knowledge?.ownerMemory && user.role !== "owner") throw new HttpError(403, "Solo il proprietario collega i connettori.");
      if (actingUser) return send(res, 409, { error: "OAuth sign-in requires your browser session. Open the returned Cora page and authorise the app there.", browserAction: { path: `/#/settings/connettori/${oauthStart[1]}`, identity: user.id } });
      const started = keyConnectors.beginOAuth(oauthStart[1], user, `${connectorOrigin(req)}/connectors/oauth/${oauthStart[1]}/callback`, url.searchParams.get("connection") || "");
      const name = config.insecureCookies ? "cora_oauth" : "__Host-cora_oauth";
      return send(res, 200, { url: started.url }, { "Set-Cookie": `${name}=${started.nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${config.insecureCookies ? "" : "; Secure"}` });
    }
    const keyConnector = /^\/api\/connectors\/keys\/([a-z][a-z0-9-]{1,40})$/.exec(path);
    if (keyConnector) {
      if (!keyConnectors || !KEY_SERVICES[keyConnector[1]]) throw new HttpError(404, "Connettore non disponibile.");
      const canManage = Boolean(knowledge?.ownerMemory || user.role === "owner");
      if (!canManage) throw new HttpError(403, "Solo il proprietario collega i connettori.");
      if (method === "POST") {
        const record = await keyConnectors.connect(keyConnector[1], await readJson(req, 20000), user, url.searchParams.get("connection") || "");
        return send(res, 200, { ...googleConnector.view(user), catalog: connectorCatalog({ origin: connectorOrigin(req) }), keyConnectors: keyConnectors.view(), canManage, record });
      }
      if (method === "PUT") {
        const record = keyConnectors.updateAgents(keyConnector[1], (await readJson(req, 8000)).agents, user, url.searchParams.get("connection") || "");
        return send(res, 200, { ...googleConnector.view(user), catalog: connectorCatalog({ origin: connectorOrigin(req) }), keyConnectors: keyConnectors.view(), canManage, record });
      }
      if (method === "DELETE") { keyConnectors.disconnect(keyConnector[1], user, url.searchParams.get("connection") || ""); return send(res, 200, { ok: true }); }
      throw new HttpError(405, "Metodo non supportato.");
    }
    if (path === "/api/connectors/google" && method === "POST") {
      if (!knowledge?.ownerMemory && user.role !== "owner") throw new HttpError(403, "Solo il proprietario collega account Google.");
      const started = googleConnector.begin(user);
      if (actingUser) {
        googleConnector.pending.delete(started.nonce);
        return send(res, 409, { error: "Google sign-in requires your browser session. Open the returned Cora page and connect the account there.", browserAction: { path: "/#/settings/connettori/google", identity: user.id } });
      }
      const name = config.insecureCookies ? "cora_google" : "__Host-cora_google";
      return send(res, 200, { url: started.url }, { "Set-Cookie": `${name}=${started.nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${config.insecureCookies ? "" : "; Secure"}` });
    }
    const connector = /^\/api\/connectors\/(gc_[a-f0-9]{16})$/.exec(path);
    if (connector && ["PUT", "DELETE"].includes(method)) {
      if (knowledge?.ownerMemory ? googleConnector.records().find((entry) => entry.id === connector[1])?.connectedBy !== user.id : user.role !== "owner") throw new HttpError(403, "Connettore privato.");
      if (method === "DELETE") { googleConnector.disconnect(connector[1]); return send(res, 200, { ok: true }); }
      const body = await readJson(req, 8000);
      if (knowledge?.ownerMemory && Array.isArray(body.agents) && body.agents.some((id) => !knowledge.canManage(store.agent(id), user))) throw new HttpError(403, "Agente privato.");
      googleConnector.update(connector[1], body);
      return send(res, 200, googleConnector.view(user));
    }
    if (path === "/api/mail/channel") {
      if (method === "GET") return send(res, 200, { ...email.view(), ...(knowledge?.ownerMemory ? { agents: email.view().agents.filter((entry) => ownsEntry(entry, user) || knowledge.canManage(store.agent(entry.id), user)) } : {}), canManage: user.role === "owner" });
      if (method === "PUT") {
        if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario cambia le regole email generali.");
        return send(res, 200, await email.update(await readJson(req, 20000)));
      }
    }
    const agentEmail = /^\/api\/agents\/([\w-]+)\/email(?:\/(refresh|signature))?$/.exec(path);
    if (agentEmail) {
      const agent = store.agent(agentEmail[1]);
      if (!agent) throw new HttpError(404, "Agente non trovato.");
      if (method === "GET" && !agentEmail[2]) { await email.poll(agent); return send(res, 200, { ...email.view(agent), canManage: Boolean(knowledge?.ownerMemory || user.role === "owner") }); }
      if (method === "GET" && agentEmail[2] === "signature") {
        const rendered = await email.compose(agent, { body_text: "" }, "preview", false);
        return send(res, 200, Buffer.from(rendered.png, "base64"), { "Content-Type": "image/png" });
      }
      if (method === "POST" && agentEmail[2] === "refresh") {
        await email.poll(agent);
        return send(res, 200, email.view(agent));
      }
      if (method === "PUT" && !agentEmail[2]) {
        if (!knowledge?.ownerMemory && user.role !== "owner") throw new HttpError(403, "Solo il proprietario cambia le regole email dell'agente.");
        return send(res, 200, await email.update(await readJson(req, 20000), agent));
      }
    }
    if (path === "/api/mail/domains" && method === "GET") return send(res, 200, { ...mailDomains.view(), canManage: user.role === "owner" });
    if (path === "/api/mail/accounts" && method === "POST") {
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario collega account Resend.");
      const account = await mailDomains.connect(await readJson(req, 4096));
      activity({ type: "settings", text: `account email ${account.name} collegato` });
      return send(res, 201, account);
    }
    const mailAccount = /^\/api\/mail\/accounts\/(ma_[a-f0-9]{16})(?:\/(check))?$/.exec(path);
    if (mailAccount && ["POST", "PUT"].includes(method)) {
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario cambia gli account Resend.");
      return send(res, 200, method === "PUT" ? await mailDomains.connect({ ...await readJson(req, 4096), id: mailAccount[1] }) : await mailDomains.checkAccount(mailAccount[1]));
    }
    if (path === "/api/mail/domains" && method === "POST") {
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario aggiunge domini email.");
      return send(res, 201, await mailDomains.addDomain(await readJson(req, 4096)));
    }
    const mailDomain = /^\/api\/mail\/domains\/(md_[a-f0-9]{16})\/(check|verify)$/.exec(path);
    if (mailDomain && method === "POST") {
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario verifica i domini email.");
      return send(res, 200, await mailDomains.checkDomain(mailDomain[1], { verify: mailDomain[2] === "verify" }));
    }
    const agentMailbox = /^\/api\/agents\/([\w-]+)\/mailbox$/.exec(path);
    if (agentMailbox) {
      const agent = store.agent(agentMailbox[1]);
      if (!agent) throw new HttpError(404, "Agente non trovato.");
      if (method === "GET") return send(res, 200, { mailbox: store.value(`agentMailbox:${agent.id}`, null), ...mailDomains.view(), canCustomize: Boolean(agent.enabled && agent.tools) });
      if (method === "PUT") {
        const mailbox = await mailDomains.assign(agent, await readJson(req, 4096));
        activity({ type: "settings", agentId: agent.id, text: `indirizzo email aggiornato: ${mailbox.email}` });
        return send(res, 200, mailbox);
      }
    }
    if (path === "/api/context" && method === "GET") return send(res, 200, { ...contextSources({ config, store, subscriptions, brain }), canWriteFiles: user.role === "owner" });
    const contextFile = /^\/api\/context\/files\/([A-Za-z0-9._-]{1,80})$/.exec(path);
    if (contextFile && method === "PUT") {
      if (user.role !== "owner") throw new HttpError(403, "solo l'owner scrive i file del server");
      const id = writeContextFile({ config, store, subscriptions }, contextFile[1], await readJson(req));
      return send(res, 200, contextSources({ config, store, subscriptions, brain }).sources.find((source) => source.id === id));
    }
    if (path === "/api/context/documents" && method === "POST") {
      const document = store.saveContextDocument(await readJson(req), { userId: user.id });
      return send(res, 201, document);
    }
    const contextDocument = /^\/api\/context\/documents\/(ctx_[a-f0-9]{12})$/.exec(path);
    if (contextDocument) {
      const id = contextDocument[1];
      if (!store.contextDocument(id)) throw new HttpError(404, "file di contesto non trovato");
      if (method === "PUT") return send(res, 200, store.saveContextDocument(await readJson(req), { id, userId: user.id }));
      if (method === "DELETE") { store.deleteContextDocument(id); return send(res, 200, { ok: true }); }
    }
    if (path === "/api/brain" || path.startsWith("/api/brain/")) {
      const canManage = Boolean(knowledge?.ownerMemory || user.role === "owner");
      const brainOwnerId = knowledge?.ownerMemory ? url.searchParams.get("ownerId") || user.id : user.id;
      const userBrain = knowledge?.forUser(user, brainOwnerId) || companyBrain;
      const userLibrarian = knowledge?.ownerMemory ? librarian?.forOwner(brainOwnerId) : librarian;
      if (!userBrain?.enabled) {
        if (path === "/api/brain" && method === "GET") return send(res, 200, { enabled: false, canManage, kinds: BRAIN_KINDS });
        throw new HttpError(409, "il brain non è collegato: serve CORA_BRAIN_DATABASE_URL in hush");
      }
      const manage = () => { if (!canManage) throw new HttpError(403, "solo l'owner cambia il brain"); };
      const author = `owner:${user.name || user.email || "Owner"}`;
      if (path === "/api/brain" && method === "GET") {
        return send(res, 200, { enabled: true, canManage, canConfigure: user.role === "owner", ownerMemory: Boolean(knowledge?.ownerMemory), ownerId: brainOwnerId, scopes: knowledge?.ownerMemory ? knowledge.brainScopes(user) : [], canShare: brainOwnerId === user.id, kinds: BRAIN_KINDS, stats: await userBrain.stats(), lastRun: await userBrain.state("lastRun"), running: Boolean(userLibrarian?.running || userLibrarian?.pending), progress: userLibrarian?.running ? userLibrarian.progress : null });
      }
      if (path === "/api/brain/live" && method === "GET") {
        manage();
        const progress = userLibrarian?.running ? userLibrarian.progress : null;
        const trace = progress?.traceId && traces ? traces.get(progress.traceId) : null;
        return send(res, 200, {
          running: Boolean(userLibrarian?.running || userLibrarian?.pending), progress,
          trace: trace ? { id: trace.id, model: trace.model, status: trace.status, startedAt: trace.startedAt, steps: (trace.steps || []).slice(-LIVE_STEPS) } : null,
        });
      }
      if (path === "/api/brain/graph" && method === "GET") return send(res, 200, await userBrain.graph());
      if (path === "/api/brain/sharing" && method === "GET" && knowledge?.ownerMemory) return send(res, 200, {
        people: store.sharingPeople(user),
      });
      if (path === "/api/brain/pages" && method === "GET") {
        const q = String(url.searchParams.get("q") || "").trim();
        const pages = q ? await userBrain.search(q, { limit: 30 }) : await userBrain.pages({ kind: String(url.searchParams.get("kind") || ""), status: url.searchParams.get("status") === "archived" ? "archived" : "live" });
        return send(res, 200, { pages });
      }
      if (path === "/api/brain/pages" && method === "POST") {
        manage();
        const body = await readJson(req, 65536);
        if (await userBrain.page(body.slug || body.title || "")) throw new HttpError(409, "una pagina con questo nome c'è già");
        const written = await userBrain.write({ ...body, author, review: "approved", note: String(body.note || "scritta dal proprietario") });
        userLibrarian?.requestRun({ reason: "pagina aggiunta" });
        return send(res, 201, written.page);
      }
      const brainShare = /^\/api\/brain\/pages\/([a-z0-9-]{2,60})\/sharing$/.exec(path);
      if (brainShare && method === "PUT" && knowledge?.ownerMemory) {
        if (brainOwnerId !== user.id) throw new HttpError(403, "Solo il proprietario originale condivide la pagina con altre persone.");
        if (brainShare[1].startsWith("shared-")) throw new HttpError(403, "Solo il proprietario condivide la pagina.");
        return send(res, 200, await knowledge.share(user.id, brainShare[1], await readJson(req, 12000)));
      }
      const brainPage = /^\/api\/brain\/pages\/([a-z0-9-]{2,60})$/.exec(path);
      if (brainPage) {
        const page = await userBrain.page(brainPage[1]);
        if (!page) throw new HttpError(404, "pagina non trovata");
        if (method === "GET") return send(res, 200, page);
        manage();
        if (method === "PUT") {
          const body = await readJson(req, 65536);
          const written = await userBrain.write({ slug: page.slug, kind: body.kind ?? page.kind, title: body.title ?? page.title, summary: body.summary ?? page.summary, body: body.body ?? page.body, author, review: "approved", note: String(body.note || "corretta dal proprietario") });
          userLibrarian?.requestRun({ reason: "pagina aggiornata" });
          return send(res, 200, written.page);
        }
        if (method === "DELETE") return send(res, 200, await userBrain.archive(page.slug, { author, note: "archiviata dal proprietario", review: "approved" }));
      }
      if (path === "/api/brain/diary" && method === "GET") {
        const from = new Date(url.searchParams.get("from") || ""), to = new Date(url.searchParams.get("to") || "");
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > 2 * 86400000) throw new HttpError(400, "Giorno non valido");
        if (!userBrain.diary) throw new HttpError(404, "Questo Brain non ha un diario");
        return send(res, 200, await userBrain.diary({ from, to }));
      }
      if (path === "/api/brain/review" && method === "GET") return send(res, 200, { queue: await userBrain.reviewQueue() });
      if (path === "/api/brain/review" && method === "POST") {
        manage();
        const body = await readJson(req, 65536);
        const result = await userBrain.review({ ids: Array.isArray(body.ids) ? body.ids.map(String) : [], all: body.all === true, decision: body.decision, by: author });
        userLibrarian?.requestRun({ reason: "revisione" });
        return send(res, 200, result);
      }
      if (path === "/api/brain/run" && method === "POST") {
        manage();
        if (userLibrarian?.running) return send(res, 202, { started: false, running: true });
        userLibrarian?.run({ reason: "pannello" }).catch((error) => activity({ type: "error", text: `bibliotecario: ${error.message}` }));
        return send(res, 202, { started: true, running: true });
      }
      throw new HttpError(404, "not found");
    }
    const agentOwners = /^\/api\/agents\/([\w-]+)\/owners$/.exec(path);
    if (agentOwners) {
      const agent = store.agent(agentOwners[1]);
      if (!agent) throw new HttpError(404, "Agente non trovato.");
      if (!knowledge?.canManage(agent, user)) throw new HttpError(403, "Agente privato.");
      const people = [...store.sharingPeople(user), { id: user.id, name: user.name || user.email, email: user.email }];
      const contacts = (await agentPermissionsView(agent, user)).people;
      for (const person of store.agentOwners(agent)) if (!contacts.some(contact => contact.id === person.id)) contacts.push(person);
      const primaryId = agent.brainOwnerId || user.id;
      const version = JSON.stringify([primaryId, agent.coOwnerIds || [], store.agentOwnerChats(agent)]);
      if (method === "GET") return send(res, 200, { version, primaryId, users: knowledge.proprietorIds(agent), contacts: store.agentOwnerChats(agent), people, chatPeople: contacts });
      if (method === "PUT") {
        const body = await readJson(req, 12000);
        if (body.version !== undefined && body.version !== version) throw new HttpError(409, "I proprietari sono cambiati. Ricarica prima di salvare.");
        if (!Array.isArray(body.users) || body.users.length > 20 || !body.users.includes(primaryId) || body.users.some(id => !people.some(person => person.id === id))) throw new HttpError(400, "Scegli i proprietari dello spazio e mantieni il proprietario originale.");
        if (!Array.isArray(body.contacts) || body.contacts.length > 20 || body.contacts.some(id => !contacts.some(person => person.id === id))) throw new HttpError(400, "Scegli persone conosciute nei canali dell'agente.");
        const selectedAccount = store.subscription(agent.subscriptionId || "");
        if (selectedAccount?.connectedBy?.id && knowledge.proprietorIds(agent).includes(selectedAccount.connectedBy.id) && !body.users.includes(selectedAccount.connectedBy.id)) throw new HttpError(409, "L’agente usa l’account di questa persona. Cambia account prima di rimuoverla.");
        const updated = store.updateAgent(agent.id, { brainOwnerId: primaryId, coOwnerIds: body.users.filter(id => id !== primaryId), ownerIds: body.contacts });
        broadcast({ type: "agent-owners" });
        return send(res, 200, { ...await publicAgent(updated), ownersVersion: JSON.stringify([primaryId, updated.coOwnerIds || [], store.agentOwnerChats(updated)]) });
      }
      throw new HttpError(405, "Metodo non supportato.");
    }
    const agentPermissions = /^\/api\/agents\/([\w-]+)\/permissions$/.exec(path);
    if (agentPermissions) {
      const agent = store.agent(agentPermissions[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      if (!["GET", "PUT"].includes(method)) throw new HttpError(405, "metodo non supportato");
      const view = await agentPermissionsView(agent, user);
      if (method === "PUT") {
        if (!view.canManage) throw new HttpError(403, "Solo il proprietario dell'agente cambia le autorizzazioni.");
        const body = await readJson(req, 2048);
        const person = view.people.find((entry) => entry.id === body.id);
        if (!person || person.inherent || typeof body.allowed !== "boolean") throw new HttpError(400, "Persona o autorizzazione non valida.");
        // Recheck ownership after the channel access lookups.
        checkAgentMemory(agent.id, user);
        const grants = store.settings.permissions.map((grant) => ({ ...grant }));
        const grant = grants.find((entry) => entry.id === person.id);
        if (grant?.agents.includes("*")) {
          if (!body.allowed && !grant.excludedAgents?.includes(agent.id) && grant.excludedAgents?.length >= 50) throw new HttpError(409, "Troppe eccezioni per questa persona.");
          grant.excludedAgents = body.allowed ? (grant.excludedAgents || []).filter((id) => id !== agent.id) : [...new Set([...(grant.excludedAgents || []), agent.id])];
        } else if (grant) {
          if (body.allowed && !grant.agents.includes(agent.id) && grant.agents.length >= 50) throw new HttpError(409, "Troppi agenti autorizzati per questa persona.");
          grant.agents = body.allowed ? [...new Set([...grant.agents, agent.id])] : grant.agents.filter((id) => id !== agent.id);
        }
        else if (body.allowed) {
          if (grants.length >= 100) throw new HttpError(409, "Troppe persone autorizzate.");
          grants.push({ id: person.id, name: person.name, agents: [agent.id] });
        }
        store.updateSettings({ permissions: grants });
        return send(res, 200, { ...view, people: view.people.map((entry) => ({ ...entry, allowed: store.hasAgentPermission(entry.id, agent.id) })) });
      }
      return send(res, 200, view);
    }
    if (path === "/api/permissions") {
      if (method === "PUT") {
        if (user.role !== "owner") throw new HttpError(403, "solo l'owner può dare permessi agli agenti");
        const body = await readJson(req, 65536);
        if (!Array.isArray(body.grants)) throw new HttpError(400, "permessi non validi");
        const names = new Map(store.speakers(1000).map((person) => [`${person.transport}:${person.userId}`, person.name]));
        store.updateSettings({ permissions: body.grants.map((grant) => ({ ...grant, name: names.get(String(grant?.id)) || grant?.name })) });
      } else if (method !== "GET") throw new HttpError(405, "metodo non supportato");
      return send(res, 200, permissionsView(user));
    }
    if (path === "/api/access" || path.startsWith("/api/access/")) {
      if (user.role !== "owner") throw new HttpError(403, "solo l'owner può gestire gli accessi");
      if (path === "/api/access" && method === "GET") return send(res, 200, {
        ...store.accessPolicy(), invitations: invitations.view(), canInvite: Boolean(cloud), users: store.panelUsers().map((entry) => ({ ...entry, allowed: store.allowsPanelUser({ ...entry, emailVerified: true }) })), audit: store.accessAudit(),
      });
      if (path === "/api/access" && method === "PUT") {
        const previous = new Set(store.accessPolicy().emails);
        const policy = store.updateAccessPolicy(await readJson(req, 16384));
        invalidateConnections();
        invitations.prune();
        const blocked = new Set(store.panelUsers().filter((person) => person.blocked).map((person) => person.email));
        const added = policy.emails.filter((email) => !previous.has(email) && !blocked.has(email));
        for (let offset = 0; offset < added.length; offset += 4) await Promise.all(added.slice(offset, offset + 4).map((email) => invitations.send(email, user)));
        return send(res, 200, { ...policy, invitations: invitations.view() });
      }
      if (path === "/api/access/invitations" && method === "POST") {
        const body = await readJson(req, 1024);
        await invitations.send(body.email, user);
        return send(res, 200, { invitations: invitations.view() });
      }
      const member = /^\/api\/access\/users\/([a-zA-Z0-9_-]{1,160})$/.exec(path);
      if (member && method === "PUT") {
        const body = await readJson(req, 1024);
        if (typeof body.blocked !== "boolean") throw new HttpError(400, "stato accesso non valido");
        const updated = store.blockPanelUser(member[1], body.blocked);
        invalidateConnections();
        return send(res, 200, updated);
      }
      throw new HttpError(404, "not found");
    }
    const canStopFlow = (agentId) => knowledge ? knowledge.canManage(store.agent(agentId), user) : user.role === "owner";
    const privateThreads = Boolean(knowledge?.ownerMemory || store.agents().some((agent) => agent.sealed));
    const visibleThreadAgents = knowledge?.agentsFor(user) || store.agents();
    const threadScope = privateThreads ? {
      agentIds: visibleThreadAgents.map((agent) => agent.id),
      emptyThreadIds: Object.entries(store.value("threadCreators", {})).filter(([, id]) => id === user.id).map(([id]) => id),
    } : {};
    const requireThreadManagement = async (id) => {
      if (!privateThreads) return;
      const own = await orchestrator.threadDetail(id, threadScope);
      if (!own) throw new HttpError(404, "thread non trovato");
      const all = (await orchestrator.threadBoard()).threads.find((thread) => thread.id === id);
      const participants = [...store.threadParticipantIds(id), ...(all?.listening || []).map((agent) => agent.id)];
      if (participants.some((id) => !canStopFlow(id))) throw new HttpError(403, "Il thread contiene agenti di altri proprietari");
    };
    if (path === "/api/threads" && method === "GET") {
      const board = await orchestrator.threadBoard(threadScope);
      if (privateThreads) {
        const parents = new Set(visibleThreadAgents.flatMap((agent) => orchestrator.channels.listFor(agent).map((channel) => channel.parentId || channel.id)));
        board.parents = user.role === "owner" ? board.parents.filter((parent) => parents.has(parent.id)) : [];
      }
      board.threads = board.threads.map((thread) => ({ ...thread, flows: thread.flows.map((flow) => ({ ...flow, canStop: canStopFlow(flow.agentId) })) }));
      return send(res, 200, board);
    }
    const threadPage = /^\/api\/threads\/([\w:.%-]{3,160})$/.exec(path);
    if (threadPage && !["rename", "stop", "close"].includes(threadPage[1]) && method === "GET") {
      const detail = await orchestrator.threadDetail(decodeURIComponent(threadPage[1]), threadScope);
      if (!detail) throw new HttpError(404, "thread non trovato");
      if (knowledge) detail.traces = detail.traces.filter((trace) => ownsEntry(trace, user));
      detail.thread.flows = detail.thread.flows.map((flow) => ({ ...flow, canStop: canStopFlow(flow.agentId) }));
      return send(res, 200, detail);
    }
    if (["/api/threads", "/api/threads/rename", "/api/threads/close"].includes(path) && method === "POST" && user.role !== "owner") {
      throw new HttpError(403, "Solo il proprietario");
    }
    if (path === "/api/threads" && method === "POST") {
      const body = await readJson(req, 4000);
      if (privateThreads) {
        const parents = new Set(visibleThreadAgents.flatMap((agent) => orchestrator.channels.listFor(agent).map((channel) => channel.parentId || channel.id)));
        if (!parents.has(body.parentId)) throw new HttpError(403, "canale non autorizzato");
      }
      try {
        const created = await orchestrator.createPlatformThread(body);
        store.setValue("threadCreators", { ...store.value("threadCreators", {}), [created.id]: user.id });
        return send(res, 201, created);
      } catch (error) { throw new HttpError(error.status || 400, error.message); }
    }
    if (path === "/api/threads/rename" && method === "POST") {
      const body = await readJson(req, 4000);
      await requireThreadManagement(String(body.id || ""));
      try { return send(res, 200, await orchestrator.renamePlatformThread(body.id, body.name)); }
      catch (error) { throw new HttpError(error.status || 400, error.message); }
    }
    if (path === "/api/threads/stop" && method === "POST") {
      const body = await readJson(req, 4000);
      const id = String(body.id || ""), agentId = String(body.agentId || "");
      if (agentId) {
        if (!canStopFlow(agentId)) throw new HttpError(403, "Solo il proprietario dell’agente");
        return send(res, 200, orchestrator.stopThread(id, agentId));
      }
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario");
      const own = store.activeThreadSessions().filter((session) => session.channelId === id && canStopFlow(session.agentId));
      return send(res, 200, { stopped: own.reduce((count, session) => count + orchestrator.stopThread(id, session.agentId).stopped, 0) });
    }
    if (path === "/api/threads/close" && method === "POST") {
      const body = await readJson(req, 4000);
      await requireThreadManagement(String(body.id || ""));
      try { return send(res, 200, await orchestrator.closePlatformThread(String(body.id || ""))); }
      catch (error) { throw new HttpError(error.status || 400, error.message); }
    }
    if (path === "/api/state" && method === "GET") {
      const [agents, models, imageReady] = await Promise.all([
        Promise.all((knowledge?.agentsFor(user) || store.agents()).map(publicAgent)),
        llm.listModels(),
        boxes.imageExists().catch(() => false),
      ]);
      return send(res, 200, {
        settings: store.settings,
        encryptionRequired: encrypted.enabled,
        currentUser: user,
        access: { hosted: Boolean(cloud), canManage: user.role === "owner" },
        transport: channels.active,
        transports: channels.enabled,
        discord: discord.status(),
        telegram: telegram.status(),
        slack: slack ? { ...slack.status(), channels: channels.slackCatalog(), apps: slackApps?.status() || null, appSync: slackApps?.configured ? slackApps.record("main") : null } : null,
        channels: channels.list(),
        discordChannels: discord.listChannels(store.settings.guildIds),
        guilds: discord.status().guilds,
        requests: store.pendingRequests().filter((entry) => ownsEntry(entry, user)),
        push: push ? push.status(knowledge?.ownerMemory ? user.id : "") : { enabled: false, publicKey: "", devices: 0 },
        agents,
        routines: store.routines().filter((entry) => ownsEntry(entry, user)).map(routineView),
        models,
        providers: llm.providers(),
        ollamaCloud: llm.cloudAccount || { signedIn: false, signinUrl: "" },
        // Which keys are stored, apart from whether the thing they unlock is reachable some other way.
        keys: { ollama: Boolean(llm.ollamaKey), orcarouter: Boolean(llm.routers.orcarouter.key), typesafe: Boolean(brain.doc?.key), soniox: Boolean(voice?.enabled), deepseek: Boolean(llm.deepseek?.key) },
        keyHints: user.role === "owner" ? Object.fromEntries(Object.entries({ ollama: llm.ollamaKey, orcarouter: llm.routers.orcarouter.key, typesafe: brain.doc?.key, soniox: voice?.key, deepseek: llm.deepseek?.key }).map(([provider, value]) => [provider, keyHint(value)])) : {},
        doc: { installed: Boolean(brain.doc?.installed), ...(brain.doc?.installed ? brain.doc.activity() : {}) },
        subscriptions: subscriptions.list().filter((entry) => !knowledge?.ownerMemory || entry.connectedBy?.id === user.id),
        credentials: credentials ? credentials.list(user) : [],
        quotaAccounts: quotaAccountsFor(user),
        providerUsage: providerQuotasFor(user),
        boxImage: { name: config.boxImage, ready: imageReady },
        timezone: config.timezone,
        artifacts: artifacts ? { reviews: artifacts.reviewsFor(user).length, ...(user.role === "owner" ? { space: artifacts.space() } : {}) } : null,
      });
    }
    if (path === "/api/subscriptions" && method === "GET") return send(res, 200, subscriptions.list().filter((entry) => !knowledge?.ownerMemory || entry.connectedBy?.id === user.id));
    if (path === "/api/subscriptions" && method === "POST") {
      const body = await readJson(req, 4096);
      if (store.subscriptions().length >= 50) throw new HttpError(409, "troppe subscription: rimuovi quelle inutilizzate");
      return send(res, 201, store.createSubscription({ provider: body.provider, label: body.label, connectedBy: { id: user.id, name: user.name || user.email } }));
    }
    const subscriptionMatch = /^\/api\/subscriptions\/(sub_[a-f0-9]{12})(?:\/(login|code|cancel|check|usage))?$/.exec(path);
    if (subscriptionMatch) {
      const [, id, action] = subscriptionMatch;
      if (action === "usage" && method === "GET") {
        if (!canReadQuota(store.subscription(id), user)) throw new HttpError(404, "subscription non trovata");
        return send(res, 200, subscriptions.usage.get(id));
      }
      if (!store.subscription(id) || (knowledge?.ownerMemory && store.subscription(id).connectedBy?.id !== user.id)) throw new HttpError(404, "subscription non trovata");
      if (!action && method === "GET") return send(res, 200, subscriptions.view(id));
      if (!action && method === "DELETE") {
        await subscriptions.remove(id);
        return send(res, 200, { ok: true });
      }
      if (action === "login" && method === "POST") return send(res, 202, await subscriptions.start(id, { id: user.id, name: user.name || user.email }));
      if (action === "code" && method === "POST") {
        const body = await readJson(req, 8192);
        return send(res, 202, subscriptions.submitCode(id, body.code));
      }
      if (action === "cancel" && method === "POST") return send(res, 200, await subscriptions.cancel(id));
      if (action === "check" && method === "POST") return send(res, 200, await subscriptions.check(id));
    }
    const providerUsageMatch = /^\/api\/providers\/(ollama|deepseek)\/usage$/.exec(path);
    if (providerUsageMatch && method === "GET") {
      if (user.role !== "owner" || !canReadQuota(subscriptions.usage.record(`provider_${providerUsageMatch[1]}`), user)) throw new HttpError(404, "collegamento non trovato");
      return send(res, 200, subscriptions.usage.get(`provider_${providerUsageMatch[1]}`));
    }
    const providerKeyMatch = /^\/api\/providers\/(ollama|orcarouter|typesafe|soniox|deepseek)\/key$/.exec(path);
    if (providerKeyMatch && method === "PUT") {
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario gestisce le chiavi dello spazio.");
      const body = await readJson(req, 4096);
      const key = String(body.key || "").trim();
      if (!key || key.length > 2048 || /[\r\n\x00]/.test(key)) throw new HttpError(400, "chiave API non valida");
      const provider = providerKeyMatch[1];
      // A Soniox key is tried before it is kept: a wrong one never reaches hush.
      if (provider === "soniox") {
        if (!voice) throw new HttpError(409, "la voce non è disponibile su questa istanza");
        try { await voice.check(key); } catch { throw new HttpError(400, "Soniox non accetta questa chiave"); }
      }
      // So is a DeepSeek key, against DeepSeek's own model list.
      if (provider === "deepseek") {
        const answer = await fetch(`${config.deepseekApi || "https://api.deepseek.com"}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
        if (!answer) throw new HttpError(502, "DeepSeek non risponde: riprova tra poco");
        await answer.body?.cancel().catch(() => {});
        if (!answer.ok) throw new HttpError(400, "DeepSeek non accetta questa chiave");
      }
      try { await storeSecret({ ollama: "CORA_OLLAMA_API_KEY", orcarouter: "CORA_ORCAROUTER_API_KEY", typesafe: "CORA_TYPESAFE_API_KEY", soniox: "CORA_SONIOX_API_KEY", deepseek: "CORA_DEEPSEEK_API_KEY" }[provider], key); }
      catch { throw new HttpError(502, "impossibile salvare la chiave in modo sicuro"); }
      if (provider === "soniox") {
        voice.setKey(key);
        return send(res, 200, { provider, configured: true, keyHint: keyHint(key) });
      }
      // TypeSafe is not a model provider: its key is doc's, for the checks on what agents say.
      if (provider === "typesafe") {
        if (brain.doc) brain.doc.key = key;
        return send(res, 200, { provider, configured: true, keyHint: keyHint(key) });
      }
      if (provider === "ollama") llm.ollamaKey = key;
      else if (provider === "deepseek") llm.deepseek.key = key;
      else llm.routers.orcarouter.key = key;
      if (["ollama", "deepseek"].includes(provider)) subscriptions.usage.invalidate(`provider_${provider}`);
      llm.cache = { at: 0, models: [] };
      return send(res, 200, { provider, configured: true, keyHint: keyHint(key) });
    }
    if (path === "/api/credentials" && method === "GET") return send(res, 200, credentials ? credentials.list(user) : []);
    if (path === "/api/credentials" && method === "POST") {
      if (!credentials) throw new HttpError(409, "impossibile conservare la chiave");
      const body = await readJson(req, 8192);
      const provider = body.provider === "deepseek" ? "deepseek" : body.provider === "ollama" ? "ollama" : "";
      if (!provider) throw new HttpError(400, "provider non valido");
      const secret = String(body.secret || "");
      let models;
      try { models = await llm.listHermesKeyModels(provider, secret); }
      catch (error) { throw new HttpError(error.status || 400, error.message); }
      const record = credentials.create({ provider, secret, label: body.label, connectedBy: { id: user.id, name: user.name || user.email } });
      return send(res, 201, { ...record, models });
    }
    const credentialMatch = /^\/api\/credentials\/(key_[a-f0-9]{12})(?:\/models)?$/.exec(path);
    if (credentialMatch && credentials) {
      const record = store.credential(credentialMatch[1]);
      if (!record || record.connectedBy?.id !== user.id) throw new HttpError(404, "chiave non trovata");
      if (path.endsWith("/models") && method === "GET") {
        try { return send(res, 200, { models: await llm.listHermesKeyModels(record.provider, credentials.secret(record.id)) }); }
        catch (error) { throw new HttpError(error.status || 400, error.message); }
      }
      if (method === "DELETE") {
        credentials.remove(record.id, user);
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, "not found");
    }
    const hermesModelsMatch = /^\/api\/hermes\/models$/.exec(path);
    if (hermesModelsMatch && method === "GET") {
      const backend = url.searchParams.get("backend") === "deepseek" ? "deepseek" : url.searchParams.get("backend") === "ollama" ? "ollama" : "";
      if (!backend) throw new HttpError(400, "provider non valido");
      const apiKey = backend === "ollama" ? llm.ollamaKey : llm.deepseek?.key;
      if (!apiKey) throw new HttpError(409, "manca la chiave dello space");
      try { return send(res, 200, { models: await llm.listHermesKeyModels(backend, apiKey) }); }
      catch (error) { throw new HttpError(error.status || 400, error.message); }
    }

    // The voices agents can speak with, and a sample of one, for the agent's Voice panel.
    if (path === "/api/voices" && method === "GET") {
      if (!voice?.enabled) return send(res, 200, { configured: false, languages: VOICE_LANGUAGES, voices: [] });
      try { return send(res, 200, { configured: true, languages: VOICE_LANGUAGES, voices: await voice.voices() }); }
      catch (error) { throw new HttpError(502, error.message); }
    }
    if (path === "/api/voices/preview" && method === "POST") {
      if (!voice?.enabled) throw new HttpError(409, "collega Soniox in Impostazioni → Soniox");
      const body = await readJson(req, 4096);
      const language = VOICE_LANGUAGES.includes(body.language) ? body.language : "it";
      const sample = String(body.text || "").trim().slice(0, 300) || (language === "en" ? "Hi, this is my voice. I answer like this when you talk to me." : "Ciao, questa è la mia voce. Ti rispondo così quando mi parli.");
      try {
        const audio = await voice.synthesize(sample, { voice: String(body.voice || "").slice(0, 40), language, format: "mp3" });
        res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": audio.length, "Cache-Control": "no-store" });
        return res.end(audio);
      } catch (error) { throw new HttpError(502, error.message); }
    }
    if (path === "/api/doc/probe" && method === "POST") return send(res, 200, brain.doc ? await brain.doc.probe() : { installed: false, runs: false, jev: false });
    if (path === "/api/doc/rules" && (method === "GET" || method === "PUT")) {
      const doc = brain.doc;
      if (!doc?.supportsRules) throw new HttpError(409, doc?.installed ? "questa versione di doc non ha i controlli configurabili: aggiornala" : "doc non è installato su questa macchina");
      const builtins = await doc.builtins();
      if (method === "PUT") {
        const body = await readJson(req, 64 * 1024);
        const known = new Set(builtins.map((rule) => `${rule.on}:${rule.key}`));
        const off = [...new Set((Array.isArray(body.off) ? body.off : []).filter((entry) => known.has(entry)))];
        if (!Array.isArray(body.add) || body.add.length > 20) throw new HttpError(400, "al massimo 20 controlli tuoi");
        const taken = new Set(builtins.map((rule) => rule.key));
        const add = body.add.map((rule) => {
          const clean = cleanDocRule(rule, taken);
          taken.add(clean.key);
          return clean;
        });
        doc.saveRules({ off, add });
      }
      return send(res, 200, {
        builtins: builtins.map((rule) => ({ ...rule, enabled: !doc.rules.off.includes(`${rule.on}:${rule.key}`) && !doc.rules.off.includes(rule.key) })),
        added: doc.rules.add,
        keySet: Boolean(doc.key),
        brains: brainsInUse(store.agents(), store.settings.defaultModel),
      });
    }
    if (path === "/api/doc/rules/test" && method === "POST") {
      const doc = brain.doc;
      if (!doc?.supportsRules) throw new HttpError(409, "doc non può provare i controlli su questa macchina");
      if (!doc.key) throw new HttpError(409, "per provare un controllo serve la chiave TypeSafe");
      const body = await readJson(req, 16 * 1024);
      const rule = cleanDocRule(body.rule);
      const brains = brainsInUse(store.agents(), store.settings.defaultModel);
      if (!brains.length) throw new HttpError(409, "nessun agente attivo con cui provarlo");
      for (const [id, job] of ruleTests) if (Date.now() - job.startedAt > 30 * 60000) ruleTests.delete(id);
      if ([...ruleTests.values()].filter((job) => job.status === "running").length >= 3) throw new HttpError(429, "ci sono già prove in corso: aspetta che finiscano");
      const id = randomBytes(8).toString("hex");
      const job = { status: "running", startedAt: Date.now(), total: brains.length, target: rule.on.includes("reply") ? "reply" : "comment", results: [] };
      ruleTests.set(id, job);
      testRule({ rule, brains, doc, llm, onResult: (result) => job.results.push(result), signal: AbortSignal.timeout(10 * 60000) })
        .catch(() => {})
        .finally(() => { job.status = "done"; });
      return send(res, 202, { id, total: job.total, target: job.target });
    }
    const ruleTestMatch = /^\/api\/doc\/rules\/test\/([a-f0-9]{16})$/.exec(path);
    if (ruleTestMatch && method === "GET") {
      const job = ruleTests.get(ruleTestMatch[1]);
      if (!job) throw new HttpError(404, "prova non trovata");
      return send(res, 200, { status: job.status, total: job.total, target: job.target, results: job.results });
    }
    if (path === "/api/subscriptions/resident/check" && method === "POST") {
      if (knowledge?.ownerMemory) throw new HttpError(403, "Le subscription personali si collegano dal proprio account.");
      await subscriptions.discoverResidents();
      return send(res, 200, subscriptions.list().filter((record) => record.resident));
    }
    if (path === "/api/settings" && method === "PUT") {
      if (knowledge?.ownerMemory && user.role !== "owner") throw new HttpError(403, "Solo il proprietario gestisce le impostazioni dello spazio.");
      const before = channels.active;
      const enabledBefore = channels.enabled;
      const residentsBefore = store.settings.useResidentSubscriptions;
      const keysBefore = store.settings.sshKeys.join("\n");
      // Permissions change only through /api/permissions, which only the owner may call.
      const { permissions: _ignored, ...changes } = await readJson(req);
      // A Slack channel switched off is remembered, so it stays off when an app is in it again.
      if (Array.isArray(changes.slackChannelIds)) {
        const on = new Set(changes.slackChannelIds.map(String));
        const known = new Set([...store.settings.slackMutedChannelIds, ...channels.slackCatalog().map((channel) => channel.id)]);
        changes.slackMutedChannelIds = [...known].filter((id) => !on.has(id));
      }
      const settings = store.updateSettings(changes);
      if (settings.useResidentSubscriptions && !residentsBefore) await subscriptions.discoverResidents();
      if (settings.sshKeys.join("\n") !== keysBefore) {
        for (const agent of store.agents()) {
          boxes.inspect(agent.id).then((state) => state.running && boxes.syncAccess(agent)).catch(() => {});
        }
      }
      const enabled = channels.enabled;
      const added = enabled.filter((kind) => !enabledBefore.includes(kind));
      // A platform switched on next to others starts empty: each agent joins it from its own page.
      if (added.length && enabled.length > added.length) {
        for (const agent of store.agents()) store.updateAgent(agent.id, { platformsOff: [...new Set([...agent.platformsOff, ...added])] });
      }
      if (settings.transport !== before || enabled.join() !== enabledBefore.join()) {
        channels.apply();
        tgBots?.sync();
        const names = enabled.map((kind) => TRANSPORT_LABELS[kind] || kind).join(", ");
        activity({ type: "settings", text: enabled.length > 1 ? `Cora ora vive su ${names}; i messaggi privati per te su ${TRANSPORT_LABELS[settings.transport] || settings.transport}` : `Cora ora vive su ${names}` });
      }
      return send(res, 200, settings);
    }
    if (path === "/api/push" && method === "GET") return send(res, 200, push ? push.status(knowledge?.ownerMemory ? user.id : "") : { enabled: false });
    if (path === "/api/push/subscribe" && method === "POST") {
      if (!push?.enabled) throw new HttpError(409, "notifiche non configurate sul server");
      const body = await readJson(req, 8192);
      store.addPushSubscription(body.subscription || {}, String(body.device || req.headers["user-agent"] || "").slice(0, 200), user.id);
      activity({ type: "settings", text: "notifiche attivate su un dispositivo" });
      return send(res, 200, push.status(knowledge?.ownerMemory ? user.id : ""));
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const body = await readJson(req, 8192);
      if (knowledge?.ownerMemory && store.pushSubscriptions().some((subscription) => subscription.endpoint === body.endpoint && subscription.userId !== user.id)) throw new HttpError(403, "Dispositivo privato.");
      store.removePushSubscription(String(body.endpoint || ""));
      return send(res, 200, push ? push.status(knowledge?.ownerMemory ? user.id : "") : { enabled: false });
    }
    if (path === "/api/push/test" && method === "POST") {
      if (!push?.enabled) throw new HttpError(409, "notifiche non configurate sul server");
      const english = store.settings.language === "en";
      const result = await push.notify({ userId: knowledge?.ownerMemory ? user.id : "", title: "Cora", body: english ? "Notifications work: the agents will reach you here." : "Le notifiche funzionano: gli agenti ti scriveranno qui.", url: "/#/settings", tag: "test" });
      if (!result.sent) throw new HttpError(502, "nessun dispositivo ha accettato la notifica");
      return send(res, 200, result);
    }
    if (path === "/api/telegram/token" && method === "PUT") {
      const body = await readJson(req, 4096);
      const token = String(body.token || "").trim();
      if (!/^\d{5,15}:[\w-]{30,60}$/.test(token)) throw new HttpError(400, "non sembra un token di BotFather (numeri:lettere)");
      let user;
      try {
        user = await new Telegram({ token, apiBase: config.telegramApi }).request("getMe");
      } catch (error) {
        if (error.status === 401 || error.status === 404) throw new HttpError(400, "Telegram rifiuta questo token: copialo di nuovo da BotFather");
        throw error;
      }
      if (!user?.is_bot) throw new HttpError(400, "questo token non è di un bot");
      if (tgBots?.agentIdForUser(user.id)) throw new HttpError(400, "questo è il bot di un agente: per ascoltare serve un bot a parte");
      await storeSecret("CORA_TELEGRAM_BOT_TOKEN", token);
      telegram.useToken(token);
      if (channels.on("telegram")) telegram.start();
      activity({ type: "telegram", text: `token del bot Telegram salvato in hush (@${user.username})` });
      return send(res, 200, { telegram: telegram.status(), bot: { id: String(user.id), username: user.username, name: user.first_name } });
    }
    if (path === "/api/slack/token" && method === "PUT" && slack) {
      const body = await readJson(req, 8192);
      const botToken = String(body.botToken || "").trim();
      const appToken = String(body.appToken || "").trim();
      if (!/^xoxb-[\w-]{10,}$/.test(botToken)) throw new HttpError(400, "il token del bot comincia con xoxb- (OAuth & Permissions)");
      if (!/^xapp-[\w-]{10,}$/.test(appToken)) throw new HttpError(400, "il token a livello app comincia con xapp- (Basic Information)");
      const probe = new Slack({ botToken, appToken, apiBase: config.slackApi });
      let user;
      try {
        user = await probe.identity();
        await probe.request("apps.connections.open", {}, { auth: "app" });
      } catch (error) {
        if (error.slack) throw new HttpError(400, `Slack rifiuta questi token (${error.slack})`);
        throw error;
      }
      if (skBots?.agentIdForUser(user.id)) throw new HttpError(400, "questa è l'app di un agente: quella principale è a parte");
      await storeSecret("CORA_SLACK_BOT_TOKEN", botToken);
      await storeSecret("CORA_SLACK_APP_TOKEN", appToken);
      slack.useTokens(botToken, appToken);
      if (probe.team?.id) store.updateSettings({ slackTeamId: probe.team.id });
      if (channels.on("slack")) slack.start();
      activity({ type: "slack", text: `token dell'app Slack salvati in hush (@${user.name})` });
      return send(res, 200, { slack: slack.status(), bot: { id: user.id, username: user.name }, team: probe.team });
    }
    // Slack's app configuration token: from then on the apps' name, description and icon follow the panel.
    if (path === "/api/slack/config-token" && method === "PUT" && slackApps) {
      const body = await readJson(req, 4096);
      const token = String(body.token || "").trim();
      if (!/^xoxe-[\w-]{10,}$/.test(token)) throw new HttpError(400, "serve il refresh token, quello che comincia con xoxe- (Your App Configuration Tokens)");
      try {
        await slackApps.connect(token);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      activity({ type: "slack", text: `token di configurazione Slack salvato in hush (${SLACK_CONFIG_SECRET}): le app seguono il pannello` });
      syncSlackApps();
      return send(res, 200, { apps: slackApps.status() });
    }
    if (path === "/api/slack/apps/sync" && method === "POST" && slackApps) {
      if (!slackApps.configured) throw new HttpError(409, "manca il token di configurazione di Slack");
      return send(res, 200, { records: await syncSlackApps() });
    }
    if (path === "/api/slack/channels" && method === "GET" && slack) {
      return send(res, 200, await channels.refreshSlackCatalog());
    }
    if (path === "/api/hardware" && method === "GET") {
      // Asking the cards costs a process: a few seconds of memory is plenty for a panel.
      const key = JSON.stringify(store.settings.ollamaHosts);
      if (!hardware.at || hardware.key !== key || Date.now() - hardware.at > 10000) {
        hardware.at = Date.now();
        hardware.key = key;
        hardware.value = await llm.hardware({ hosts: store.settings.ollamaHosts }).catch(() => ({ ollama: { url: "", local: false, reachable: false, version: "" }, gpus: [], hosts: [], loaded: [] }));
      }
      return send(res, 200, hardware.value);
    }
    if (path === "/api/ollama/pull" && method === "POST") {
      const body = await readJson(req, 2048);
      const name = String(body.model || "").trim();
      if (!/^[\w./:@-]{2,120}$/.test(name)) throw new HttpError(400, "non sembra il nome di un modello");
      const hosts = llm.ollamaHostList(store.settings.ollamaHosts);
      const host = hosts.find((item) => item.url === String(body.host || "").replace(/\/$/, "")) || hosts.find((item) => item.local) || hosts[0];
      if (!host?.local) throw new HttpError(400, "si scaricano modelli solo su un Ollama di questa macchina");
      if (pulls.has(`${host.url}|${name}`)) return send(res, 200, { started: false, already: true });
      pulls.add(`${host.url}|${name}`);
      activity({ type: "settings", text: `scarico il modello ${name}` });
      pullModel(host.url, name, (event) => broadcast({ type: "ollama-pull", host: host.url, model: name, ...event }))
        .then((done) => {
          activity({ type: "settings", text: done.ok ? `modello ${name} pronto` : `modello ${name}: ${done.error}` });
          broadcast({ type: "ollama-pull", host: host.url, model: name, done: true, ok: done.ok, error: done.error || "" });
        })
        .finally(() => pulls.delete(`${host.url}|${name}`));
      return send(res, 202, { started: true, host: host.url, model: name });
    }
    if (path === "/api/activity" && method === "GET") {
      return send(res, 200, store.recentActivity(300).filter((entry) => ownsEntry(entry, user)));
    }
    if (path === "/api/cron/preview" && method === "GET") {
      try {
        return send(res, 200, { next: nextRuns(url.searchParams.get("expr") || "", config.timezone, 3).map((date) => date.toISOString()) });
      } catch (error) {
        throw new HttpError(400, error.message);
      }
    }
    // The picture Cora would draw, for the panel to show while an agent is being made.
    if (path === "/api/avatars/preview" && method === "GET") {
      const seed = String(url.searchParams.get("seed") || "").replace(/[^\w-]/g, "").slice(0, 40) || "cora";
      const color = String(url.searchParams.get("color") || "").toLowerCase();
      return send(res, 200, drawnAvatar(seed, /^#[0-9a-f]{6}$/.test(color) ? color : "#e8a33d"), { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
    }

    if (path === "/api/transport-accounts" && method === "GET") {
      if (user.role !== "owner") throw new HttpError(403, "Solo il proprietario collega gli account Slack e Telegram degli agenti.");
      const heard = channels.list()[0]?.id || "";
      const slackChannel = slackIds(heard)?.channelId || store.settings.slackChannelIds[0];
      const telegramChat = telegramChatId(heard) || store.settings.telegramChatIds[0];
      const accounts = [];
      for (const agent of store.agents()) {
        accounts.push({
          id: agent.id,
          name: agent.name,
          slackBot: skBots ? await skBots.status(agent, slackChannel) : null,
          telegramBot: tgBots ? await tgBots.status(agent, telegramChat) : null,
        });
      }
      return send(res, 200, { agents: accounts });
    }


    const checkCredentialChoice = (previous, body) => {
      const model = body.model !== undefined ? body.model : previous?.model || "";
      const credentialId = body.credentialId !== undefined ? String(body.credentialId || "") : previous?.credentialId || "";
      if (credentialId && credentialId !== (previous?.credentialId || "")) {
        const record = store.credential(credentialId);
        if (!record || record.connectedBy?.id !== user.id) throw new HttpError(403, "Chiave privata.");
      }
      const backend = modelKeyBackend(model);
      if (backend && !credentialId) {
        const ready = backend === "ollama" ? Boolean(llm.ollamaKey) : Boolean(llm.deepseek?.key);
        if (!ready) throw new HttpError(400, "scegli una tua chiave oppure configura quella dello space");
      }
    };
    if (path === "/api/agents" && method === "POST") {
      const body = await readJson(req);
      // Whom an agent answers to is the owner of the space's choice.
      if (user?.role !== "owner") delete body.ownerId;
      delete body.brainSource;
      delete body.coOwnerIds; delete body.ownerIds;
      body.brainOwnerId = user.id;
      if (knowledge?.ownerMemory && body.subscriptionId && store.subscription(body.subscriptionId)?.connectedBy?.id !== user.id) throw new HttpError(403, "Subscription privata.");
      checkCredentialChoice(null, body);
      const agent = store.createAgent(body);
      bots?.sync();
      tgBots?.sync();
      skBots?.sync();
      activity({ type: "agent", agentId: agent.id, text: `creato ${agent.name}` });
      ensureBoxSoon(agent);
      return send(res, 201, await publicAgent(agent));
    }

    let match = /^\/api\/agents\/([\w-]+)$/.exec(path);
    if (match) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      if (method === "GET") return send(res, 200, await publicAgent(agent));
      if (method === "PUT") {
        const body = await readJson(req);
        if (user?.role !== "owner") delete body.ownerId;
        delete body.brainSource;
        delete body.brainOwnerId;
        // The seal is set in the agent's Brain, where only its owners reach; named grants stay.
        delete body.sealed;
        delete body.coOwnerIds; delete body.ownerIds;
        if (body.core !== undefined) checkAgentMemory(agent.id, user);
        if (knowledge?.ownerMemory && body.subscriptionId && body.subscriptionId !== agent.subscriptionId && store.subscription(body.subscriptionId)?.connectedBy?.id !== user.id) throw new HttpError(403, "Subscription privata.");
        checkCredentialChoice(agent, body);
        if (agent.brainSource === "external") delete body.core;
        const updated = store.updateAgent(agent.id, body);
        bots?.envName(agent);
        skBots?.envNames(agent);
        bots?.sync();
        tgBots?.sync();
        // A new name, description or image reaches the agent's Slack app on its own.
        skBots?.sync();
        ensureBoxSoon(updated);
        return send(res, 200, await publicAgent(updated));
      }
      if (method === "DELETE") {
        await boxes.remove(agent.id, { volume: url.searchParams.get("purge") === "1" }).catch(() => {});
        store.deleteAgent(agent.id);
        bots?.sync();
        tgBots?.sync();
        skBots?.sync();
        activity({ type: "agent", text: `eliminato ${agent.name}` });
        return send(res, 200, { ok: true });
      }
    }

    match = /^\/api\/agents\/([\w-]+)\/knowledge(?:\/(check))?$/.exec(path);
    if (match && knowledge) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "Agente non trovato.");
      if (!knowledge.canManage(agent, user)) throw new HttpError(403, "Solo il proprietario dell'agente può accedere al suo Brain.");
      if (!match[2] && method === "GET") return send(res, 200, knowledge.view(agent, user));
      if (!match[2] && method === "PUT") {
        const updated = await knowledge.configure(agent, await readJson(req, 12000), user);
        broadcast({ type: "agents" });
        broadcast({ type: "agent-owners" });
        return send(res, 200, knowledge.view(updated, user));
      }
      if (match[2] && method === "POST") {
        if (agent.brainSource !== "external") throw new HttpError(409, "Seleziona il Brain esterno prima di verificarlo.");
        const pages = await knowledge.forAgent(agent).pages({ fresh: true });
        return send(res, 200, { ok: true, pages: pages.length, readonly: true });
      }
      throw new HttpError(405, "method not allowed");
    }

    match = /^\/api\/agents\/([\w-]+)\/(memories|core|sleep|diary)(?:\/([\w-]+))?$/.exec(path);
    if (match) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const [, , section, itemId] = match;
      const sealed = Boolean(knowledge?.isSealed(agent));
      if ((knowledge?.ownerMemory || sealed) && !knowledge.canManage(agent, user)) throw new HttpError(403, "Solo il proprietario dell'agente può accedere alla sua memoria.");
      if (agent.brainSource === "external") {
        if (!knowledge?.canManage(agent, user)) throw new HttpError(403, "Solo il proprietario dell'agente può accedere al suo Brain.");
        if (section === "memories" && !itemId && method === "GET") return send(res, 200, { source: "external", readonly: true, knowledge: knowledge.view(agent, user), core: "", coreHistory: [], facts: [], shared: [], brain: true, diary: [], lastSleepAt: "", sleeping: false });
        throw new HttpError(409, "Il Brain esterno è in sola lettura. La memoria interna resta esclusa.");
      }
      if (section === "memories" && !itemId && method === "GET") {
        return send(res, 200, {
          source: "internal", knowledge: knowledge?.view(agent, user),
          core: agent.core,
          coreHistory: store.coreHistory(agent.id),
          facts: knowledge?.ownerMemory || sealed ? knowledge.ownerKeys(agent.id).flatMap((key) => store.memories(key)) : store.memories(agent.id),
          sealed,
          ownerMemory: Boolean(knowledge?.ownerMemory),
          // With a company brain, what everyone knows lives there: once the librarian has read the shared memories, agents no longer get them.
          shared: knowledge?.ownerMemory || sealed || companyBrain?.holdsShared ? [] : store.memories(SHARED),
          brain: Boolean(companyBrain?.enabled) && !sealed,
          diary: store.diary(agent.id),
          lastSleepAt: agent.lastSleepAt,
          sleeping: brain.sleeping.has(agent.id),
        });
      }
      if (section === "memories" && !itemId && method === "POST") {
        const body = await readJson(req);
        if (body.shared && companyBrain?.enabled && !sealed) return send(res, 201, { noted: await noteForBrain(body.text, agent, user) });
        const memory = store.addMemory(knowledge?.ownerMemory || sealed ? knowledge.memoryKey(agent) : body.shared ? SHARED : agent.id, body.text, "manual", { pinned: body.pinned });
        return send(res, 201, memory);
      }
      if (section === "memories" && itemId) {
        const found = store.findMemory(itemId);
        if (!found || (knowledge?.ownerMemory || sealed ? !knowledge.ownerKeys(agent.id).includes(found.key) : found.key !== agent.id && found.key !== SHARED)) throw new HttpError(404, "ricordo non trovato");
        if (method === "PUT") {
          const body = await readJson(req);
          let key = found.key;
          // Sharing a memory, with a company brain, hands it to the librarian: the agent keeps its own copy.
          if (body.shared === true && key !== SHARED && companyBrain?.enabled && !sealed) return send(res, 200, { ...found.memory, noted: await noteForBrain(found.memory.text, agent, user) });
          if (!knowledge?.ownerMemory && !sealed && body.shared !== undefined && Boolean(body.shared) !== (key === SHARED)) {
            const target = body.shared ? SHARED : agent.id;
            store.moveMemory(key, itemId, target);
            key = target;
          }
          return send(res, 200, store.updateMemory(key, itemId, { text: body.text, pinned: body.pinned }));
        }
        if (method === "DELETE") {
          store.deleteMemory(found.key, itemId);
          return send(res, 200, { ok: true });
        }
      }
      if (section === "core" && method === "PUT") {
        const body = await readJson(req);
        return send(res, 200, { core: store.setCore(agent.id, String(body.text || ""), "manual").core });
      }
      if (section === "sleep" && method === "POST") {
        brain.sleep(agent, { force: true })
          .then((result) => { if (result.status === "nothing") activity({ type: "sleep", agentId: agent.id, text: "niente di nuovo da riordinare" }); })
          .catch((error) => activity({ type: "error", agentId: agent.id, text: `sonno: ${error.message}` }));
        return send(res, 202, { ok: true });
      }
      if (section === "diary" && itemId && method === "DELETE") {
        if (!store.deleteDiary(agent.id, itemId)) throw new HttpError(404, "pagina non trovata");
        return send(res, 200, { ok: true });
      }
    }

    match = /^\/api\/rooms\/(web(?:-[\w-]+)?)\/messages$/.exec(path);
    if (match) {
      const room = match[1] === "web" ? knowledge?.roomFor(user) || "web" : match[1];
      if (knowledge?.ownerMemory && isSalotto(room) && room !== knowledge.roomFor(user)) throw new HttpError(403, "Stanza privata.");
      const agentId = roomAgentId(room);
      if (!isWebRoom(room) || (agentId && !store.agent(agentId))) throw new HttpError(404, "stanza non trovata");
      if (agentId) checkAgentMemory(agentId, user);
      if (method === "GET") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 80));
        const running = [...(traces?.live.values() || [])].filter((trace) => trace.channelId === room).map((trace) => trace.summary());
        return send(res, 200, { room, messages: store.recentMessages(room, limit), running });
      }
      if (method === "POST") {
        const body = await readJson(req, 16384);
        const text = String(body.text || "").trim();
        if (!text) throw new HttpError(400, "messaggio vuoto");
        if (text.length > 3000) throw new HttpError(400, "messaggio troppo lungo (max 3000 caratteri)");
        if (agentId && !store.agent(agentId).enabled) throw new HttpError(409, "l'agente è muto: accendilo dal profilo");
        return send(res, 201, await orchestrator.onWebMessage({ room, text, user }));
      }
    }

    match = /^\/api\/agents\/([\w-]+)\/traces$/.exec(path);
    if (match && method === "GET") {
      if (!store.agent(match[1])) throw new HttpError(404, "agente non trovato");
      checkAgentMemory(match[1], user);
      // ?goal= gives only the turns that worked toward that goal.
      const goal = url.searchParams.has("goal") ? String(url.searchParams.get("goal")) : null;
      const live = [...(traces?.live.values() || [])].filter((trace) => trace.agentId === match[1] && (goal === null || trace.goal === goal)).map((trace) => trace.summary());
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
      return send(res, 200, [...live, ...store.traces(match[1], limit, { goal }).filter((trace) => !live.some((item) => item.id === trace.id))]);
    }

    match = /^\/api\/agents\/([\w-]+)\/goals$/.exec(path);
    if (match && method === "GET") {
      if (!store.agent(match[1])) throw new HttpError(404, "agente non trovato");
      return send(res, 200, { goals: store.goalUsage(match[1]) });
    }

    if (path === "/api/usage" && method === "GET") {
      const days = Math.min(366, Math.max(30, Number(url.searchParams.get("days")) || 365));
      return send(res, 200, { days, today: new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), usage: store.usageByDay(days, config.timezone).filter((entry) => ownsEntry(entry, user)) });
    }

    if (path === "/api/traces" && method === "GET") {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 12));
      const live = [...(traces?.live.values() || [])].map((trace) => trace.summary());
      return send(res, 200, [...live, ...store.recentTraces(limit).filter((trace) => !live.some((item) => item.id === trace.id))].filter((trace) => ownsEntry(trace, user)).slice(0, limit));
    }

    match = /^\/api\/traces\/(tr_[0-9a-f]+)$/.exec(path);
    if (match && method === "GET") {
      const trace = traces ? traces.get(match[1]) : store.trace(match[1]);
      if (!trace) throw new HttpError(404, "ragionamento non trovato");
      if (!ownsEntry(trace, user)) throw new HttpError(403, "Questo ragionamento appartiene a un altro proprietario.");
      return send(res, 200, trace);
    }

    if (path.startsWith("/api/artifacts") && artifacts) return artifactsApi(req, res, url, user);
    if (path.startsWith("/api/secrets") && vault) return secretsApi(req, res, url, user);

    match = /^\/api\/files\/([0-9a-f]{24})$/.exec(path);
    if (match && method === "GET" && config.filesDir) {
      const file = join(config.filesDir, match[1]);
      if (!existsSync(file)) throw new HttpError(404, "file non trovato");
      const meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
      if (knowledge?.ownerMemory && meta.ownerId !== user.id) {
        const direct = meta.agentId && knowledge.canManage(store.agent(meta.agentId), user);
        const rooms = knowledge.agentsFor(user).map(agent => `web-${agent.id}`);
        const legacy = !meta.agentId && rooms.length && store.stmt(`SELECT 1 FROM messages WHERE channel_id IN (${rooms.map(() => "?").join(",")}) AND json_extract(meta, '$.file.id') = ? LIMIT 1`).get(...rooms, match[1]);
        if (!direct && !legacy) throw new HttpError(404, "file non trovato");
      }
      // Pictures and the agents' voice messages play in the page; everything else downloads.
      const inline = /^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|ogg))$/.test(meta.type);
      return send(res, 200, readFileSync(file), {
        "Content-Type": inline ? meta.type : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${meta.name.replace(/"/g, "")}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
    }

    // The agent's own GitHub App: the owner makes it from here and installs it on GitHub.
    match = /^\/api\/agents\/([\w-]+)\/github(?:\/(manifest|check|install|installations\/(\d+)))?$/.exec(path);
    if (match && github) {
      if (user?.role !== "owner") throw new HttpError(403, "l'app GitHub di un agente la gestisce il proprietario");
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      try {
        if (!match[2] && method === "GET") return send(res, 200, github.view(agent));
        if (match[2] === "manifest" && method === "POST") return send(res, 200, github.begin(agent));
        if (match[2] === "check" && method === "POST") return send(res, 200, await github.check(agent));
        if (match[2] === "install" && method === "POST") return send(res, 200, github.installLink(agent));
        if (match[3] && method === "PUT") return send(res, 200, await github.approve(agent, Number(match[3]), (await readJson(req, 1024)).approved === true));
        if (!match[2] && method === "DELETE") return send(res, 200, await github.forget(agent));
      } catch (error) {
        if (error.status) throw new HttpError(error.status, error.message);
        throw error;
      }
      throw new HttpError(405, "method not allowed");
    }

    match = /^\/api\/agents\/([\w-]+)\/slack-bot$/.exec(path);
    if (match && method === "PUT" && skBots) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const body = await readJson(req, 8192);
      const botToken = String(body.botToken || "").trim();
      const appToken = String(body.appToken || "").trim();
      if (!/^xoxb-[\w-]{10,}$/.test(botToken)) throw new HttpError(400, "il token del bot comincia con xoxb- (OAuth & Permissions)");
      if (!/^xapp-[\w-]{10,}$/.test(appToken)) throw new HttpError(400, "il token a livello app comincia con xapp- (Basic Information)");
      const { user } = await skBots.verify(agent, { botToken, appToken, teamId: store.settings.slackTeamId, mainUserId: slack?.user?.id || "" });
      const names = skBots.envNames(agent);
      await storeSecret(names.bot, botToken);
      await storeSecret(names.app, appToken);
      activity({ type: "slack", agentId: agent.id, text: `token dell'app Slack salvati in hush (@${user.name})` });
      await skBots.attach(agent, { botToken, appToken });
      return send(res, 200, await publicAgent(store.agent(agent.id)));
    }

    // A picture of one's own for an agent (the panel sends it already square, as a PNG), or back to Cora's drawing.
    match = /^\/api\/agents\/([\w-]+)\/avatar$/.exec(path);
    if (match && (method === "PUT" || method === "DELETE")) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      let image = null;
      if (method === "PUT") {
        const encoded = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(String((await readJson(req, 4 * 1024 * 1024)).image || ""))?.[1];
        image = encoded ? Buffer.from(encoded, "base64") : null;
        const size = pngSize(image);
        if (!size) throw new HttpError(400, "l'immagine deve essere un PNG");
        if (size.width !== size.height || size.width < 512 || size.width > 2000) throw new HttpError(400, "l'immagine deve essere quadrata, tra 512 e 2000 pixel");
      }
      const updated = store.setAvatarImage(agent.id, image);
      bots?.sync();
      skBots?.sync();
      activity({ type: "agent", agentId: agent.id, text: image ? `nuova immagine per ${agent.name}` : `${agent.name} torna all'immagine disegnata da Cora` });
      return send(res, 200, await publicAgent(updated));
    }

    match = /^\/api\/agents\/([\w-]+)\/slack-app$/.exec(path);
    if (match && method === "POST" && skBots) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      if (!slackApps?.configured) throw new HttpError(409, "manca il token di configurazione di Slack");
      const record = await skBots.syncApp(agent, { force: true });
      if (!record) throw new HttpError(409, "l'app Slack di questo agente non è collegata");
      return send(res, 200, await publicAgent(store.agent(agent.id)));
    }

    match = /^\/api\/agents\/([\w-]+)\/telegram-setup$/.exec(path);
    if (match && tgBots) {
      if (method !== "GET") throw new HttpError(405, "metodo non supportato");
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      return send(res, 200, await telegramSetup({ agent, store, telegram, tgBots, channels, traces,
        chatId: url.searchParams.get("chatId") || "", probe: url.searchParams.get("probe") || "", since: url.searchParams.get("since") || "" }));
    }

    match = /^\/api\/agents\/([\w-]+)\/telegram-bot$/.exec(path);
    if (match && method === "PUT" && tgBots) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const body = await readJson(req, 4096);
      const token = String(body.token || "").trim();
      if (!/^\d{5,15}:[\w-]{30,60}$/.test(token)) throw new HttpError(400, "non sembra un token di BotFather (numeri:lettere)");
      const user = await tgBots.verify(agent, token, { mainUserId: telegram.user?.id });
      await storeSecret(telegramBotEnvName(agent), token);
      activity({ type: "telegram", agentId: agent.id, text: `token del bot Telegram salvato in hush (@${user.username})` });
      await tgBots.attach(agent, token);
      return send(res, 200, await publicAgent(store.agent(agent.id)));
    }

    match = /^\/api\/agents\/([\w-]+)\/bot$/.exec(path);
    if (match && method === "DELETE" && bots) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      bots.detach(agent);
      activity({ type: "discord", agentId: agent.id, text: "app Discord scollegata" });
      return send(res, 200, await publicAgent(agent));
    }
    if (match && method === "PUT" && bots) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const body = await readJson(req, 4096);
      const token = String(body.token || "").trim().replace(/^Bot\s+/i, "");
      if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token)) throw new HttpError(400, "non sembra un token di bot: copialo da Bot \u2192 Reset Token");
      const user = await bots.verify(agent, token, { mainUserId: bots.listener() ? null : discord.user?.id });
      await storeSecret(bots.envName(agent), token);
      activity({ type: "discord", agentId: agent.id, text: `token del bot salvato in hush (${user.username})` });
      await bots.attach(agent, token);
      return send(res, 200, await publicAgent(store.agent(agent.id)));
    }

    if (["/api/routines/history", "/api/routines/archive"].includes(path) && method === "GET") {
      const options = Object.fromEntries(["agentId", "kind", "query", "limit", "offset"].map((key) => [key, url.searchParams.get(key) || ""]));
      if (options.kind && !["routine", "reminder"].includes(options.kind)) throw new HttpError(400, "tipo di attività non valido");
      return send(res, 200, path.endsWith("/history") ? store.routineHistory({ ...options, ...(knowledge?.ownerMemory ? { agentIds: knowledge.agentsFor(user).map((agent) => agent.id) } : {}) }) : store.routineArchive({ ...options, ...(knowledge?.ownerMemory ? { agentIds: knowledge.agentsFor(user).map((agent) => agent.id) } : {}) }));
    }

    match = /^\/api\/agents\/([\w-]+)\/routines$/.exec(path);
    if (match && method === "POST") {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const body = await readJson(req);
      if (body.kind !== "reminder") try { nextRuns(body.schedule, config.timezone, 1); } catch (error) { throw new HttpError(400, error.message); }
      return send(res, 201, routineView(store.createRoutine(agent.id, body)));
    }

    match = /^\/api\/routines\/([\w-]+)(\/run)?$/.exec(path);
    if (match) {
      const routine = store.routine(match[1]);
      if (!routine || !ownsEntry(routine, user)) throw new HttpError(404, "routine non trovata");
      if (match[2] && method === "POST") {
        orchestrator.runRoutine(routine, { manual: true }).catch(() => {});
        return send(res, 202, { ok: true });
      }
      if (!match[2] && method === "PUT") {
        const body = await readJson(req);
        if (body.schedule !== undefined) {
          try { nextRuns(body.schedule, config.timezone, 1); } catch (error) { throw new HttpError(400, error.message); }
        }
        return send(res, 200, routineView(store.updateRoutine(routine.id, body)));
      }
      if (!match[2] && method === "DELETE") {
        store.deleteRoutine(routine.id);
        return send(res, 200, { ok: true });
      }
    }

    match = /^\/api\/agents\/([\w-]+)\/box\/(start|stop|restart|screenshot|upgrade|access|tailscale)$/.exec(path);
    if (match) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const action = match[2];
      if (action === "access" && method === "GET") {
        const state = await boxes.inspect(agent.id);
        const port = state.sshPort || store.sshPort(agent.id);
        return send(res, 200, {
          running: state.running,
          outdated: Boolean(state.outdated),
          ssh: { port, user: "agent", jump: config.sshJump, command: `ssh -J ${config.sshJump} -p ${port} agent@127.0.0.1`, ready: Boolean(state.sshPort) },
          tailscale: state.running ? await boxes.tailscale(agent.id) : { state: "off" },
        });
      }
      if (action === "tailscale" && method === "POST") {
        const state = await boxes.inspect(agent.id);
        if (!state.running) throw new HttpError(409, "desktop spento: accendilo prima");
        const status = await boxes.tailscaleConnect(agent);
        activity({ type: "box", agentId: agent.id, text: status.state === "Running" ? `Tailscale: ${status.host} con SSH` : "Tailscale: in attesa di autorizzazione" });
        return send(res, 200, status);
      }
      if (action === "upgrade" && method === "POST") {
        await boxes.upgrade(agent);
        activity({ type: "box", agentId: agent.id, text: "desktop aggiornato" });
        return send(res, 200, await boxes.inspect(agent.id));
      }
      if (action === "screenshot" && method === "GET") {
        const state = await boxes.inspect(agent.id);
        if (!state.running) throw new HttpError(409, "desktop spento");
        const image = await boxes.screenshot(agent.id);
        return send(res, 200, image, { "Content-Type": "image/jpeg" });
      }
      if (method === "POST") {
        if (action === "start") await boxes.ensure(agent);
        if (action === "stop") await boxes.stop(agent.id);
        if (action === "restart") await boxes.restart(agent.id);
        activity({ type: "box", agentId: agent.id, text: action });
        return send(res, 200, await boxes.inspect(agent.id));
      }
    }

    throw new HttpError(404, "not found");
  }

  /**
   * The artifacts in the panel: folders, their commits, the reviews. Files come back
   * inert — media plays, text reads as text, anything else downloads: nothing an
   * agent made ever runs on the panel's own address.
   */
  async function artifactsApi(req, res, url, user) {
    const path = url.pathname;
    const method = req.method;
    const by = { kind: "user", id: user.id, name: user.name || user.email || "Owner" };
    if (path === "/api/artifacts" && method === "GET") {
      return send(res, 200, {
        folders: store.artifactFolders().filter((folder) => artifacts.canReadMember(folder, user)).map((folder) => artifacts.folderView(folder)),
        reviews: artifacts.reviewsFor(user).map((commit) => artifacts.commitSummary(commit)),
        encryptionRequired: encrypted.enabled,
        legacyFolders: encrypted.enabled ? store.artifactFolders().filter((folder) => artifacts.canReadMember(folder, user) && !encryptedFolder(store, folder.id) && (folder.head || store.artifactCommits(folder.id, { limit: 1 }).length)).length : 0,
        quota: artifacts.space(),
        people: store.sharingPeople(user),
        canManage: Boolean(knowledge?.ownerMemory || user.role === "owner"),
        levelShares: store.artifactShares().filter((share) => share.prefix && share.status === "active").reduce((out, share) => ({ ...out, [share.prefix]: (out[share.prefix] || 0) + 1 }), {}),
      });
    }
    if (path === "/api/artifacts/folders" && method === "POST") {
      const body = await readJson(req, 16384);
      const owner = knowledge?.ownerMemory || user.role === "owner";
      if (!owner && body.memberAccess !== undefined) throw new HttpError(403, "solo il proprietario cambia l'accesso del team");
      const folder = artifacts.createFolder({
        path: body.path, title: body.title, description: body.description, kind: body.kind, writers: body.writers,
        policy: owner ? body.policy : "review", reviewers: owner ? body.reviewers : [], memberAccess: owner ? body.memberAccess : undefined, createdBy: by,
      });
      return send(res, 201, artifacts.folderView(folder));
    }
    let match = /^\/api\/artifacts\/folders\/(af_[a-f0-9]{12})(?:\/(restore|shares|blobs|upload|remove|events))?$/.exec(path);
    if (match) {
      const folder = store.artifactFolder(match[1]);
      if (!folder) throw new HttpError(404, "cartella non trovata");
      if (!artifacts.canReadMember(folder, user)) throw new HttpError(403, "non hai accesso a questa cartella");
      if (method === "POST" && ((encryptedFolder(store, folder.id) && ["restore", "shares", "blobs", "upload", "remove"].includes(match[2])) || (encrypted.enabled && ["restore", "blobs", "upload", "remove"].includes(match[2])))) throw new HttpError(409, "Questa cartella usa lo Spazio cifrato: usa i suoi controlli di sblocco.");
      // Uploads from the panel: each file on its own as raw bytes, then one commit that places them.
      if (match[2] === "blobs" && method === "POST") {
        const length = req.headers["content-length"] === undefined ? NaN : Number(req.headers["content-length"]);
        return send(res, 201, await artifacts.receive(folder.id, user, req, length));
      }
      // Who opened, viewed and downloaded what through the folder's links, and what changed on them.
      if (match[2] === "events" && method === "GET") {
        if (!artifacts.canReview(folder, user)) throw new HttpError(403, "il registro lo vedono il proprietario e i revisori della cartella");
        return send(res, 200, { events: store.artifactEvents(folder.id, { shareId: url.searchParams.get("share") || "", before: Number(url.searchParams.get("before")) || 0, limit: 200 }) });
      }
      if (match[2] === "upload" && method === "POST") {
        const body = await readJson(req, 2 * 1024 * 1024);
        return send(res, 201, await artifacts.commitUpload(folder.id, { user, dir: body.dir, base: body.base, files: body.files, message: body.message }));
      }
      // Files or subfolders taken out: a commit without them, like an upload.
      if (match[2] === "remove" && method === "POST") {
        const body = await readJson(req, 256 * 1024);
        return send(res, 201, await artifacts.removeFiles(folder.id, { user, base: body.base, paths: body.paths, message: body.message }));
      }
      if (match[2] === "restore" && method === "POST") {
        const body = await readJson(req, 4096);
        return send(res, 200, await artifacts.restore(folder.id, String(body.commit || ""), user));
      }
      if (match[2] === "shares" && method === "POST") {
        if (!artifacts.canReview(folder, user)) throw new HttpError(403, "condividono una cartella solo il proprietario e i suoi revisori");
        const body = await readJson(req, 32768);
        const share = artifacts.createShare(folder.id, { label: body.label, view: body.view, access: body.access, commit: body.commit, expiresAt: body.expiresAt, root: body.root, createdBy: by });
        return send(res, 201, share);
      }
      if (match[2]) throw new HttpError(404, "not found");
      if (method === "GET") {
        const head = folder.head ? artifacts.store.artifactCommit(folder.head) : null;
        return send(res, 200, {
          folder: artifacts.folderView(folder),
          encrypted: encryptedFolder(store, folder.id),
          encryptedEnabled: true,
          encryptionRequired: encrypted.enabled,
          legacyPlaintext: encrypted.enabled && !encryptedFolder(store, folder.id) && Boolean(head || store.artifactCommits(folder.id, { limit: 1 }).length),
          canEncrypt: (folder.ownerId || (folder.createdBy?.kind === "user" ? folder.createdBy.id : "")) === user.id,
          canReview: artifacts.canReview(folder, user),
          canUpload: artifacts.canUpload(folder, user),
          canManage: artifacts.canManage(folder, user),
          people: artifacts.canManage(folder, user) ? store.sharingPeople(user) : [],
          effectiveAccess: artifacts.canManage(folder, user) ? Object.fromEntries(store.sharingPeople(user).map((person) => [person.id, artifacts.memberPermission(folder, person)])) : {},
          inherited: artifacts.canManage(folder, user) ? Object.fromEntries(store.sharingPeople(user).map((person) => [person.id, artifacts.levelGrant(folder, person.id)]).filter(([, grant]) => grant.permission !== "none")) : {},
          shareHosting: Boolean(artifacts.shareSuffix),
          shareSuffix: artifacts.shareSuffix,
          shares: store.artifactShares(folder.id).map((share) => artifacts.shareView(share)),
          activity: artifacts.canReview(folder, user) ? store.artifactEventCounts(folder.id) : {},
          commits: store.artifactCommits(folder.id, { limit: 200 }).map((commit) => artifacts.commitSummary(commit)),
          tree: head ? [...artifacts.readTree(head.tree).entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, file]) => ({ path: name, sha: file.sha, size: file.size })) : [],
        });
      }
      if (method === "PUT") {
        if (!artifacts.canReview(folder, user)) throw new HttpError(403, "cambiano una cartella solo il proprietario e i suoi revisori");
        const body = await readJson(req, 16384);
        return send(res, 200, artifacts.folderView(artifacts.updateFolder(folder.id, body, user)));
      }
      if (method === "DELETE") {
        if (!artifacts.canManage(folder, user)) throw new HttpError(403, "solo il proprietario elimina una cartella");
        artifacts.deleteFolder(folder.id);
        activity({ type: "artifact", text: `${by.name} ha eliminato la cartella ${folder.path}` });
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, "method not allowed");
    }
    match = /^\/api\/artifacts\/commits\/(ac_[a-f0-9]{12})(?:\/(review|view|files\/.+|objects\/[a-f0-9]{64}))?$/.exec(path);
    if (match) {
      const commit = store.artifactCommit(match[1]);
      if (!commit) throw new HttpError(404, "commit non trovato");
      const folder = store.artifactFolder(commit.folderId);
      if (!folder) throw new HttpError(404, "cartella non trovata");
      if (!artifacts.canReadMember(folder, user)) throw new HttpError(403, "non hai accesso a questa cartella");
      if (!match[2] && method === "GET") {
        const canReview = artifacts.canReview(folder, user);
        return send(res, 200, { ...artifacts.commitView(commit.id), canReview, previewUrl: canReview ? artifacts.previewUrl(commit.id) : "" });
      }
      // A file the browser renders itself (a PDF, a web page) is framed from an address apart from the panel, for ten minutes.
      if (match[2] === "view" && method === "GET") {
        const name = String(url.searchParams.get("path") || "");
        if (!artifacts.fileAt(commit.id, name)) throw new HttpError(404, "file non trovato");
        const site = /\.html?$/i.test(name);
        // A page of a commit nobody approved yet runs only for who reviews it, as on its preview host; others read its source.
        if (site && commit.status !== "published" && !artifacts.canReview(folder, user)) return send(res, 200, { url: "" });
        const view = shares.rawUrl(commit.id, name, 10, { site });
        if (!view) throw new HttpError(404, "l'anteprima a parte c'è solo negli spazi su usecora.space");
        return send(res, 200, { url: view });
      }
      if (match[2] === "review" && method === "POST") {
        const body = await readJson(req, 8192);
        return send(res, 200, await artifacts.review(commit.id, { decision: String(body.decision || ""), note: body.note, user }));
      }
      if (match[2] && method === "GET") {
        let file;
        if (match[2].startsWith("files/")) {
          let name;
          try { name = decodeURIComponent(match[2].slice("files/".length)); } catch { throw new HttpError(400, "percorso non valido"); }
          file = artifacts.fileAt(commit.id, name);
        } else {
          const sha = match[2].slice("objects/".length);
          // A file the commit replaced or removed: what the reviewer compares against.
          const held = artifacts.objectInCommit(commit.id, sha);
          if (held) file = { ...held, path: url.searchParams.get("name") || sha };
        }
        if (!file) throw new HttpError(404, "file non trovato");
        return inertFile(req, res, file, url.searchParams.get("download") === "1");
      }
      throw new HttpError(405, "method not allowed");
    }
    // A level of the paths (clienti, clienti/acme): what is inside it, and links that serve all of it.
    match = /^\/api\/artifacts\/level(?:\/(shares|events|access))?$/.exec(path);
    if (match) {
      const level = String(url.searchParams.get("path") || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
      if (!level || store.artifactFolderByPath(level)) throw new HttpError(404, "livello non trovato");
      const inside = artifacts.groupFolders(level).filter((folder) => artifacts.canReadMember(folder, user));
      if (!inside.length) throw new HttpError(404, "livello non trovato");
      const canShare = artifacts.canShareGroup(level, user);
      const id = `ag:${level}`;
      if (match[1] === "shares" && method === "POST") {
        if (!canShare) throw new HttpError(403, "condivide un livello solo chi rivede almeno una delle sue cartelle");
        const body = await readJson(req, 32768);
        return send(res, 201, artifacts.createShare(id, { label: body.label, view: body.view, access: body.access, commit: body.commit, expiresAt: body.expiresAt, root: body.root, createdBy: by }));
      }
      if (match[1] === "access" && method === "PUT") {
        const access = artifacts.updateLevelAccess(level, await readJson(req, 65536), user);
        activity({ type: "artifact", text: `${by.name} ha cambiato l'accesso del team al livello ${level}` });
        return send(res, 200, access);
      }
      if (match[1] === "events" && method === "GET") {
        if (!canShare) throw new HttpError(403, "il registro lo vede chi rivede le cartelle di questo livello");
        return send(res, 200, { events: store.artifactEvents(id, { shareId: url.searchParams.get("share") || "", before: Number(url.searchParams.get("before")) || 0, limit: 200 }) });
      }
      if (match[1] || method !== "GET") throw new HttpError(405, "method not allowed");
      return send(res, 200, {
        path: level,
        folders: inside.map((folder) => ({ ...artifacts.folderView(folder), served: canShare && artifacts.canReview(folder, user) })),
        canShare,
        canManage: artifacts.canManageGroup(level, user),
        access: artifacts.canManageGroup(level, user) ? artifacts.levelAccess(level, user) : null,
        managed: inside.filter((folder) => artifacts.canManage(folder, user)).length,
        people: canShare || artifacts.canManageGroup(level, user) ? store.sharingPeople(user) : [],
        shareHosting: Boolean(artifacts.shareSuffix),
        shareSuffix: artifacts.shareSuffix,
        shares: store.artifactShares(id).map((share) => artifacts.shareView(share)),
        activity: canShare ? store.artifactEventCounts(id) : {},
      });
    }
    match = /^\/api\/artifacts\/shares\/(as_[a-f0-9]{12})$/.exec(path);
    if (match) {
      const share = store.artifactShare(match[1]);
      const folder = share ? artifacts.shareFolder(share.folderId) : null;
      if (!share || !folder) throw new HttpError(404, "link non trovato");
      if (folder.group ? !artifacts.canShareGroup(folder.path, user) : !artifacts.canReview(folder, user)) throw new HttpError(403, "cambiano un link solo il proprietario e i revisori della cartella");
      if (method === "PUT") return send(res, 200, artifacts.updateShare(share.id, await readJson(req, 32768), user));
      if (method === "DELETE") {
        store.deleteArtifactShare(share.id);
        artifacts.shareEvent(share, "deleted", by);
        activity({ type: "artifact", text: `${by.name} ha eliminato il link ${share.label}` });
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, "method not allowed");
    }
    throw new HttpError(404, "not found");
  }

  /**
   * The vault in the panel: names, what they are for, who may use them, never a value.
   * Everyone in the space sees the list; only the owner puts, replaces, asks, sends.
   */
  async function secretsApi(req, res, url, user) {
    const path = url.pathname;
    const method = req.method;
    const by = { kind: "user", id: user.id, name: user.name || user.email || "Owner" };
    const owner = knowledge?.ownerMemory || user.role === "owner";
    const ownsSecretRecord = (record) => !knowledge?.ownerMemory || Boolean(record && vault.canManage(record, user));
    const secretRoute = /^\/api\/secrets\/([A-Z][A-Z0-9_]{1,63})(?:\/|$)/.exec(path);
    if (secretRoute && !ownsSecretRecord(store.vaultSecret(secretRoute[1]))) throw new HttpError(404, "segreto non trovato");
    const requestRoute = /^\/api\/secrets\/requests\/(vr_[a-f0-9]{12})$/.exec(path);
    if (requestRoute && !ownsSecretRecord(vault.requests().find((record) => record.id === requestRoute[1]))) throw new HttpError(404, "richiesta non trovata");
    const sendRoute = /^\/api\/secrets\/sends\/(vx_[a-f0-9]{12})/.exec(path);
    if (sendRoute && !ownsSecretRecord(vault.sends().find((record) => record.id === sendRoute[1]))) throw new HttpError(404, "invio non trovato");
    if (path === "/api/secrets" && method === "GET") {
      return send(res, 200, {
        enabled: vault.enabled, canManage: owner, secrets: vault.list(user), peopleSends: Boolean(vault.shareSuffix && vault.access),
        requests: owner ? vault.requests().filter(ownsSecretRecord).filter((request) => request.status === "open" && !request.expired) : [],
        sends: owner ? vault.sends().filter(ownsSecretRecord).filter((item) => item.status === "proposed" || (item.status === "active" && !item.expired)) : [],
      });
    }
    if (!owner) throw new HttpError(403, "la cassaforte la gestisce solo il proprietario");
    if (path === "/api/secrets" && method === "POST") {
      const body = await readJson(req, 96 * 1024);
      return send(res, 201, vault.put({ name: body.name, value: body.value, description: body.description, agents: body.agents, by }));
    }
    if (path === "/api/secrets/requests" && method === "POST") {
      const body = await readJson(req, 8192);
      return send(res, 201, vault.requestLink({ name: body.name, description: body.description, agents: body.agents, hours: body.hours, by }));
    }
    // The vault's log: who opened what was sent, who filled a request, which agent used what, every change.
    if (path === "/api/secrets/events" && method === "GET") {
      return send(res, 200, { events: vault.events({ name: url.searchParams.get("name") || "", before: Number(url.searchParams.get("before")) || 0 }).filter((entry) => !knowledge?.ownerMemory || ownsSecretRecord(store.vaultSecret(entry.name))) });
    }
    let match = /^\/api\/secrets\/requests\/(vr_[a-f0-9]{12})$/.exec(path);
    if (match && method === "DELETE") {
      vault.cancelRequest(match[1], by);
      return send(res, 200, { ok: true });
    }
    match = /^\/api\/secrets\/sends\/(vx_[a-f0-9]{12})(?:\/(approve))?$/.exec(path);
    if (match && match[2] === "approve" && method === "POST") {
      const body = await readJson(req, 32768);
      return send(res, 200, vault.approveSend(match[1], by, { access: body.access, views: body.views, days: body.days, note: body.note }));
    }
    if (match && !match[2] && method === "DELETE") {
      vault.revokeSend(match[1], by);
      return send(res, 200, { ok: true });
    }
    match = /^\/api\/secrets\/([A-Z][A-Z0-9_]{1,63})(?:\/(sends))?$/.exec(path);
    if (match && match[2] === "sends" && method === "POST") {
      const body = await readJson(req, 8192);
      return send(res, 201, vault.createSend({ name: match[1], views: body.views, days: body.days, note: body.note, access: body.access, by }));
    }
    if (match && !match[2] && method === "PUT") {
      const body = await readJson(req, 96 * 1024);
      if (body.value !== undefined) return send(res, 200, vault.put({ name: match[1], value: body.value, description: body.description, agents: body.agents, by }));
      return send(res, 200, vault.update(match[1], body, by));
    }
    if (match && !match[2] && method === "DELETE") {
      vault.remove(match[1], by);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, "not found");
  }

  /** One stored file for the panel: media inline (with ranges), text as plain text, the rest as a download. */
  async function inertFile(req, res, file, download) {
    const name = file.path.split("/").at(-1) || "file";
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    let type = download ? "" : INERT_MEDIA[extension] || "";
    if (!type && !download && file.size <= 2 * 1024 * 1024) {
      const data = await artifacts.readFile(file);
      if (data && !data.subarray(0, 8192).includes(0) && TEXTUAL.test(data.subarray(0, 8192).toString("utf8"))) type = "text/plain; charset=utf-8";
    }
    const headers = {
      "Content-Type": type || "application/octet-stream",
      "Content-Disposition": `${type ? "inline" : "attachment"}; filename="${name.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
      "Accept-Ranges": "bytes",
      "Referrer-Policy": "no-referrer",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      if (start >= file.size || start > end) {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${file.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return artifacts.stream(file.sha, { start, end }, file.storage).on("error", () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": file.size });
    if (req.method === "HEAD") return res.end();
    artifacts.stream(file.sha, null, file.storage).on("error", () => res.destroy()).pipe(res);
  }

  /**
   * A notice from usecora.space (someone joined the waitlist), signed with the
   * cloud's key: this installation only needs the public key (CORA_CLOUD_KEY).
   */
  async function cloudNotice(req, res) {
    if (!config.cloudKey) throw new HttpError(404, "not found");
    const body = await readJson(req, 8192);
    const fields = verifyPass(config.cloudKey, body.notice, { audience: "notices" });
    if (!fields || !firstUse(fields)) throw new HttpError(403, "notice refused");
    await orchestrator.cloudNotice(fields);
    return send(res, 200, { ok: true });
  }

  /** A pass from usecora.space, or a one-time link made on the host, becomes this panel's usual session. */
  function signInFrom(req, res, url) {
    let ok = false;
    let identity;
    if (url.pathname === "/auth/cloud" && cloud) {
      const fields = verifyPass(cloud.key, url.searchParams.get("pass"), { audience: cloud.audience });
      identity = fields?.sub ? cloudIdentity(fields) : null;
      ok = Boolean(identity && store.allowsPanelUser(identity) && firstUse(fields));
      activity({ type: ok ? "settings" : "warning", text: ok ? `accesso da usecora.space (${fields.email || fields.sub})` : "pass di usecora.space rifiutato" });
    }
    if (url.pathname === "/auth/link" && sessionKey) {
      const [expires, nonce, mac] = String(url.searchParams.get("token") || "").split(".");
      ok = Boolean(expires && nonce && mac && Number(expires) > Date.now() && safeEqual(mac, sign(sessionKey, `link.${expires}.${nonce}`))
        && firstUse({ jti: `link.${nonce}`, exp: Number(expires) }));
      activity({ type: ok ? "settings" : "warning", text: ok ? "accesso col link d'emergenza" : "link d'emergenza rifiutato" });
    }
    if (!ok) {
      res.writeHead(302, { Location: "/?signin=refused", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      return res.end();
    }
    res.writeHead(302, { Location: safeNext(url.searchParams.get("next")), "Set-Cookie": sessionCookie(identity), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.end();
  }

  /**
   * The cloud asks before it mails a sign-in link: may this address open that share?
   * It only sends when the answer is yes, and tells the visitor the same either way.
   */
  async function cloudShareAccess(req, res) {
    if (!cloud || !artifacts) throw new HttpError(404, "not found");
    const body = await readJson(req, 8192);
    const fields = verifyPass(cloud.key, body.pass, { audience: `share-access:${cloud.audience}` });
    if (!fields?.email || !fields.host || !firstUse(fields)) throw new HttpError(403, "refused");
    const target = shares.match({ headers: { host: String(fields.host) } });
    const resolved = target ? artifacts.resolveHost(target.label) || vault?.resolveHost?.(target.label) || null : null;
    // Only a link for named people is opened by email; a public or password link never sends one.
    const forPeople = resolved && (resolved.kind === "preview" || (resolved.share.access.mode || "people") === "people");
    const allowed = Boolean(forPeople && artifacts.allows(resolved, { email: fields.email, via: "email" }));
    // A secret's name stays in the vault: the mail says only that a secret waits.
    const title = !allowed ? "" : resolved.kind === "send" ? (store.settings.language === "en" ? "a secret sent through Cora" : "un segreto mandato con Cora") : resolved.folder.title;
    return send(res, 200, { allowed, title, language: store.settings.language || "it" });
  }

  async function cloudAccess(req, res) {
    if (!cloud) throw new HttpError(404, "not found");
    const body = await readJson(req, 8192);
    const fields = verifyPass(cloud.key, body.pass, { audience: `access:${cloud.audience}` });
    if (!fields?.sub || !firstUse(fields)) throw new HttpError(403, "accesso non autorizzato a questa istanza");
    return send(res, 200, { allowed: store.allowsPanelUser(cloudIdentity(fields)) });
  }

  const clients = new Set();
  const broadcast = (entry) => {
    const line = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of clients) if (ownsEntry(entry, client.coraUser)) {
      if (knowledge?.ownerMemory && isSalotto(entry.room)) client.write(`data: ${JSON.stringify({ ...entry, room: "web" })}\n\n`);
      else client.write(line);
    }
  };

  function events(req, res) {
    if (!authed(req)) return send(res, 401, { error: "login richiesto" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    clients.add(res);
    res.coraUser = sessionUser(req);
    const connection = { user: sessionUser(req), close: () => { clients.delete(res); res.write(`data: ${JSON.stringify({ type: "access-revoked" })}\n\n`); res.end(); accessConnections.delete(connection); } };
    accessConnections.add(connection);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
      accessConnections.delete(connection);
    });
  }

  async function boxTarget(req) {
    const match = /^\/box\/([\w-]+)(\/.*)?$/.exec(new URL(req.url, "http://x").pathname);
    if (!match) return null;
    const agent = store.agent(match[1]);
    if (!agent) throw new HttpError(404, "agente non trovato");
    checkAgentMemory(agent.id, sessionUser(req));
    const state = await boxes.inspect(agent.id);
    if (!state.running || !state.port) throw new HttpError(409, "desktop spento: avvialo dal pannello");
    const rest = req.url.slice(`/box/${match[1]}`.length) || "/";
    return { port: state.port, path: rest.startsWith("/") ? rest : `/${rest}` };
  }

  async function proxyBox(req, res) {
    if (!authed(req)) return send(res, 401, "login richiesto");
    const target = await boxTarget(req);
    const headers = { ...req.headers, host: `127.0.0.1:${target.port}` };
    delete headers.cookie;
    const upstream = http.request({ host: "127.0.0.1", port: target.port, method: req.method, path: target.path, headers }, (response) => {
      res.writeHead(response.statusCode || 502, { ...response.headers, "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'" });
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) send(res, 502, "desktop non raggiungibile");
      else res.destroy();
    });
    req.pipe(upstream);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const shared = shares.match(req);
    if (shared) {
      try {
        return await shares.handle(req, res, shared);
      } catch (error) {
        activity({ type: "error", text: `link ${shared.label}: ${error.message}` });
        if (!res.headersSent) send(res, 500, "error");
        else res.destroy();
        return;
      }
    }
    try {
      const mailEvent = /^\/mail\/events\/(ag_[a-z0-9]+)\/([a-f0-9]{24})$/.exec(url.pathname);
      if (mailEvent && email && req.method === "POST") {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new HttpError(413, "event too large"); chunks.push(chunk); }
        await email.acceptEvent(mailEvent[1], mailEvent[2], Buffer.concat(chunks), req.headers["x-ambox-signature"]);
        return send(res, 200, { ok: true });
      }
      const mailImage = /^\/mail\/media\/([A-Za-z0-9_-]{24})\.(png|gif)$/.exec(url.pathname);
      if (mailImage && email && ["GET", "HEAD"].includes(req.method)) {
        const body = email.media(mailImage[1], { png: mailImage[2] === "png", head: req.method === "HEAD" });
        return send(res, body ? 200 : 404, req.method === "HEAD" ? Buffer.alloc(0) : body || "", { "Content-Type": mailImage[2] === "png" ? "image/png" : "image/gif", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "no-store" });
      }
      // A request page posts a plain form: it checks its own origin, and the link is the key.
      if (url.pathname.startsWith("/send/")) return await vaultPages(req, res, url);
      if (url.pathname === "/mcp") return await panelMcp.handle(req, res, readJson);
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.headers["x-cora"] !== "1") throw new HttpError(403, "missing X-Cora header");
        const origin = req.headers.origin;
        if (origin && originHost(origin) !== req.headers.host) throw new HttpError(403, "cross-origin request");
      }
      if (foreignRequest(req, url.pathname)) throw new HttpError(403, "cross-site request");
      if (url.pathname === "/healthz") return send(res, 200, "ok");
      moveLegacyCookie(req, res);
      if (url.pathname === "/auth/cloud" || url.pathname === "/auth/link") return signInFrom(req, res, url);
      if (url.pathname === "/api/cloud/access" && req.method === "POST") return await cloudAccess(req, res);
      if (url.pathname === "/api/cloud/invitation" && req.method === "POST") {
        if (!cloud) throw new HttpError(404, "not found");
        const body = await readJson(req, 8192);
        const fields = verifyPass(cloud.key, body.pass, { audience: `invitation:${cloud.audience}` });
        const invitation = fields && firstUse(fields) && invitations.claim(fields.nonce);
        if (!invitation) throw new HttpError(403, "invito non autorizzato");
        return send(res, 200, invitation);
      }
      if (url.pathname === "/api/cloud/notice" && req.method === "POST") return await cloudNotice(req, res);
      if (url.pathname === "/api/cloud/share-access" && req.method === "POST") return await cloudShareAccess(req, res);
      if (url.pathname === "/api/events") return events(req, res);
      const picture = /^\/avatars\/([\w-]+)\.png$/.exec(url.pathname);
      if (picture && (req.method === "GET" || req.method === "HEAD")) return avatarFile(res, url, picture[1]);
      if (url.pathname === "/connectors/google/callback" && googleConnector && req.method === "GET") {
        const name = config.insecureCookies ? "cora_google" : "__Host-cora_google";
        let status = 200, message = "Account Google collegato. Scegli gli agenti che possono usarlo.";
        try {
          await googleConnector.finish({ ...Object.fromEntries(url.searchParams), nonce: parseCookies(req.headers.cookie)[name] || "" });
          store.setValue("googleConnectorNotice", message);
        } catch { status = 400; message = "Collegamento Google non riuscito o scaduto. Riprova da Connettori."; store.setValue("googleConnectorNotice", message); }
        const body = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${status === 200 ? '<meta http-equiv="refresh" content="1;url=/#/settings/connettori/google">' : ""}<title>Google · Cora</title><style>${SEND_STYLE}</style></head><body><main>${SEND_MARK}<h1>Google</h1><p>${message}</p><a class="button" href="/#/settings/connettori/google">Torna a Connettori</a></main></body></html>`;
        return send(res, status, body, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "Set-Cookie": `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.insecureCookies ? "" : "; Secure"}` });
      }
      const oauthBack = /^\/connectors\/oauth\/([a-z][a-z0-9-]{1,40})\/callback$/.exec(url.pathname);
      if (oauthBack && keyConnectors && KEY_SERVICES[oauthBack[1]] && req.method === "GET") {
        const service = oauthBack[1], title = KEY_SERVICES[service].name;
        const name = config.insecureCookies ? "cora_oauth" : "__Host-cora_oauth";
        let status = 200, message = `${title} autorizzato. Scegli gli agenti che possono usarlo.`;
        try { await keyConnectors.finishOAuth(service, Object.fromEntries(url.searchParams), parseCookies(req.headers.cookie)[name] || ""); }
        catch (error) { status = 400; message = error instanceof KeyConnectorError ? error.message : `Autorizzazione ${title} non riuscita. Riprova da Connettori.`; }
        const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        const back = `/#/settings/connettori/${service}`;
        const body = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${status === 200 ? `<meta http-equiv="refresh" content="1;url=${back}">` : ""}<title>${escape(title)} · Cora</title><style>${SEND_STYLE}</style></head><body><main>${SEND_MARK}<h1>${escape(title)}</h1><p>${escape(message)}</p><a class="button" href="${back}">Torna a Connettori</a></main></body></html>`;
        return send(res, status, body, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "Set-Cookie": `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.insecureCookies ? "" : "; Secure"}` });
      }
      if (url.pathname.startsWith("/github/") && github && (req.method === "GET" || req.method === "HEAD")) return await githubReturn(res, url);
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname.startsWith("/box/")) return await proxyBox(req, res);
      const file = STATIC[url.pathname];
      if (file && (req.method === "GET" || req.method === "HEAD")) {
        const body = readFileSync(join(WEB_DIR, file[0]));
        return send(res, 200, body, {
          "Content-Type": file[1],
          "Content-Security-Policy": panelCsp,
          "X-Frame-Options": "SAMEORIGIN",
          "Cache-Control": "no-cache",
        });
      }
      throw new HttpError(404, "not found");
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) activity({ type: "error", text: `web ${req.method} ${url.pathname}: ${error.message}` });
      if (!res.headersSent) send(res, status, { error: error.message });
      else res.destroy();
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    const reject = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    try {
      if (shares.match(req)) return reject(404, "Not Found");
      if (!authed(req)) return reject(401, "Unauthorized");
      const origin = req.headers.origin;
      if (origin && originHost(origin) !== req.headers.host) return reject(403, "Forbidden");
      if (foreignRequest(req, new URL(req.url, "http://localhost").pathname)) return reject(403, "Forbidden");
      const target = await boxTarget(req);
      const user = sessionUser(req);
      if (!user) return reject(401, "Unauthorized");
      if (!target) return reject(404, "Not Found");
      const upstream = net.connect(target.port, "127.0.0.1", () => {
        const lines = [`${req.method} ${target.path} HTTP/1.1`];
        for (const [name, value] of Object.entries(req.headers)) {
          const lower = name.toLowerCase();
          if (lower === "cookie" || lower === "origin") continue;
          if (lower === "host") lines.push(`Host: 127.0.0.1:${target.port}`);
          else if (Array.isArray(value)) value.forEach((item) => lines.push(`${name}: ${item}`));
          else if (value != null) lines.push(`${name}: ${value}`);
        }
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      const connection = { user, close: () => { socket.destroy(); upstream.destroy(); accessConnections.delete(connection); } };
      accessConnections.add(connection);
      socket.on("close", () => { upstream.destroy(); accessConnections.delete(connection); });
      const close = connection.close;
      upstream.on("error", close);
      socket.on("error", close);
    } catch (error) {
      reject(error.status || 502, "Bad Gateway");
    }
  });

  /** Someone has the panel open and visible (the page drops its event stream when hidden). */
  const watching = () => clients.size > 0;

  return { server, broadcast, watching, stopInvitations: () => invitations.stop() };
}
