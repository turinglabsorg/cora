import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { botEnvName } from "./agent-bots.js";
import { passLedger, verifyPass } from "./pass.js";
import { telegramChatId } from "./channels.js";
import { Telegram } from "./telegram.js";
import { telegramBotEnvName } from "./telegram-bots.js";
import { isWebRoom, roomAgentId } from "./rooms.js";
import { nextRuns } from "./scheduler.js";
import { SHARED } from "./store.js";
import { contextSources } from "./context.js";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const COOKIE = "cora_session";
const SESSION_DAYS = 30;
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/assets/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/assets/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/assets/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/assets/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/assets/icon-192.png": ["icon-192.png", "image/png"],
  "/assets/icon-512.png": ["icon-512.png", "image/png"],
  "/assets/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
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

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
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

export function createWeb({ config, store, subscriptions, discord, telegram, channels, boxes, llm, orchestrator, brain, bots, tgBots, activity, storeSecret, traces, push = null }) {
  const sessionKey = config.sessionKey || config.adminPassword;
  const failures = [];
  // On usecora.space the cloud signs people in; this panel only checks the pass it hands over.
  const cloud = config.cloudUrl && config.cloudKey && config.cloudSpace ? {
    url: config.cloudUrl.replace(/\/$/, ""),
    key: config.cloudKey,
    audience: `${config.cloudSpace}.${new URL(config.cloudUrl).host}`,
    login: `${config.cloudUrl.replace(/\/$/, "")}/go/${config.cloudSpace}`,
    logout: `${config.cloudUrl.replace(/\/$/, "")}/logout`,
  } : null;
  const firstUse = passLedger();

  const localOwner = () => store.panelUser("local-owner") || store.registerPanelUser({ id: "local-owner", name: "Owner", email: "", role: "owner", source: "local" });
  const sessionHash = (token) => createHash("sha256").update(token).digest("hex");
  const sessionCookie = (identity = localOwner()) => {
    const user = store.registerPanelUser(identity);
    const expires = Date.now() + SESSION_DAYS * 86400000;
    const token = randomBytes(32).toString("base64url");
    store.createPanelSession(sessionHash(token), user.id, expires);
    const value = `v2.${token}.${sign(sessionKey, `session.v2.${token}`)}`;
    store.auditAccess(user.id, "sign-in");
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${config.insecureCookies ? "" : "; Secure"}`;
  };

  const sessionUser = (req) => {
    if (!sessionKey) return null;
    const value = parseCookies(req.headers.cookie)[COOKIE];
    if (!value) return null;
    const parts = value.split(".");
    if (parts[0] === "v2") {
      const [, token, signature, extra] = parts;
      if (!token || !signature || extra || !safeEqual(signature, sign(sessionKey, `session.v2.${token}`))) return null;
      return store.panelSession(sessionHash(token));
    }
    const [expires, signature, extra] = parts;
    if (extra || !expires || !signature || Number(expires) < Date.now() || !safeEqual(signature, sign(sessionKey, `session.${expires}`))) return null;
    return localOwner();
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
      ...headers,
    });
    res.end(payload);
  };

  const boxStatus = async (agent) => {
    try {
      return await Promise.race([boxes.inspect(agent.id), new Promise((resolve) => setTimeout(() => resolve({ status: "unknown" }), 5000))]);
    } catch (error) {
      return { status: "error", error: error.message };
    }
  };

  const publicAgent = async (agent) => ({
    ...agent,
    memoryCount: store.memoryCount(agent.id),
    box: await boxStatus(agent),
    bot: bots ? bots.status(agent, store.settings.guildIds[0]) : null,
    telegramBot: tgBots ? await tgBots.status(agent, telegramChatId(channels.list()[0]?.id) || store.settings.telegramChatIds[0]) : null,
  });

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

  async function api(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    if (path === "/api/me" && method === "GET") {
      const user = sessionUser(req);
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
    const user = sessionUser(req);
    if (!user) throw new HttpError(401, "login richiesto");
    if (!["GET", "HEAD"].includes(method) && path !== "/api/logout") {
      const action = path.startsWith("/api/context") ? "context" : path.startsWith("/api/access") ? "access-policy" : path.startsWith("/api/rooms") ? "message" : path.startsWith("/api/agents") ? "agent" : path.startsWith("/api/subscriptions") || path.startsWith("/api/providers") ? "connections" : "settings";
      res.once("finish", () => { if (res.statusCode < 400) { try { store.auditAccess(user.id, action); } catch {} } });
    }
    if (path === "/api/logout" && method === "POST") {
      const token = parseCookies(req.headers.cookie)[COOKIE]?.split(".")[1];
      if (token) store.deletePanelSession(sessionHash(token));
      return send(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.insecureCookies ? "" : "; Secure"}` });
    }

    if (path === "/api/context" && method === "GET") return send(res, 200, contextSources({ config, store, subscriptions, brain }));
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
    if (path === "/api/access" || path.startsWith("/api/access/")) {
      if (user.role !== "owner") throw new HttpError(403, "solo l'owner può gestire gli accessi");
      if (path === "/api/access" && method === "GET") return send(res, 200, {
        ...store.accessPolicy(), users: store.panelUsers().map((entry) => ({ ...entry, allowed: store.allowsPanelUser({ ...entry, emailVerified: true }) })), audit: store.accessAudit(),
      });
      if (path === "/api/access" && method === "PUT") {
        const policy = store.updateAccessPolicy(await readJson(req, 16384));
        invalidateConnections();
        return send(res, 200, policy);
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
    if (path === "/api/state" && method === "GET") {
      const [agents, models, imageReady] = await Promise.all([
        Promise.all(store.agents().map(publicAgent)),
        llm.listModels(),
        boxes.imageExists().catch(() => false),
      ]);
      return send(res, 200, {
        settings: store.settings,
        currentUser: user,
        access: { hosted: Boolean(cloud), canManage: user.role === "owner" },
        transport: channels.active,
        discord: discord.status(),
        telegram: telegram.status(),
        channels: channels.list(),
        discordChannels: discord.listChannels(store.settings.guildIds),
        guilds: discord.status().guilds,
        requests: store.pendingRequests(),
        push: push ? push.status() : { enabled: false, publicKey: "", devices: 0 },
        agents,
        routines: store.routines().map(routineView),
        models,
        providers: llm.providers(),
        subscriptions: subscriptions.list(),
        boxImage: { name: config.boxImage, ready: imageReady },
        timezone: config.timezone,
      });
    }
    if (path === "/api/subscriptions" && method === "GET") return send(res, 200, subscriptions.list());
    if (path === "/api/subscriptions" && method === "POST") {
      const body = await readJson(req, 4096);
      if (store.subscriptions().length >= 50) throw new HttpError(409, "troppe subscription: rimuovi quelle inutilizzate");
      return send(res, 201, store.createSubscription({ provider: body.provider, label: body.label }));
    }
    const subscriptionMatch = /^\/api\/subscriptions\/(sub_[a-f0-9]{12})(?:\/(login|code|cancel|check))?$/.exec(path);
    if (subscriptionMatch) {
      const [, id, action] = subscriptionMatch;
      if (!store.subscription(id)) throw new HttpError(404, "subscription non trovata");
      if (!action && method === "GET") return send(res, 200, subscriptions.view(id));
      if (!action && method === "DELETE") {
        await subscriptions.remove(id);
        return send(res, 200, { ok: true });
      }
      if (action === "login" && method === "POST") return send(res, 202, await subscriptions.start(id));
      if (action === "code" && method === "POST") {
        const body = await readJson(req, 8192);
        return send(res, 202, subscriptions.submitCode(id, body.code));
      }
      if (action === "cancel" && method === "POST") return send(res, 200, await subscriptions.cancel(id));
      if (action === "check" && method === "POST") return send(res, 200, await subscriptions.check(id));
    }
    const providerKeyMatch = /^\/api\/providers\/(ollama|orcarouter)\/key$/.exec(path);
    if (providerKeyMatch && method === "PUT") {
      const body = await readJson(req, 4096);
      const key = String(body.key || "").trim();
      if (!key || key.length > 2048 || /[\r\n\x00]/.test(key)) throw new HttpError(400, "chiave API non valida");
      const provider = providerKeyMatch[1];
      try { await storeSecret(provider === "ollama" ? "CORA_OLLAMA_API_KEY" : "CORA_ORCAROUTER_API_KEY", key); }
      catch { throw new HttpError(502, "impossibile salvare la chiave in modo sicuro"); }
      if (provider === "ollama") llm.ollamaKey = key;
      else llm.routers.orcarouter.key = key;
      llm.cache = { at: 0, models: [] };
      return send(res, 200, { provider, configured: true });
    }
    if (path === "/api/subscriptions/resident/check" && method === "POST") {
      await subscriptions.discoverResidents();
      return send(res, 200, subscriptions.list().filter((record) => record.resident));
    }
    if (path === "/api/settings" && method === "PUT") {
      const before = channels.active;
      const residentsBefore = store.settings.useResidentSubscriptions;
      const keysBefore = store.settings.sshKeys.join("\n");
      const settings = store.updateSettings(await readJson(req));
      if (settings.useResidentSubscriptions && !residentsBefore) await subscriptions.discoverResidents();
      if (settings.sshKeys.join("\n") !== keysBefore) {
        for (const agent of store.agents()) {
          boxes.inspect(agent.id).then((state) => state.running && boxes.syncAccess(agent)).catch(() => {});
        }
      }
      if (settings.transport !== before) {
        channels.apply();
        activity({ type: "settings", text: `Cora ora vive su ${settings.transport === "telegram" ? "Telegram" : "Discord"}` });
      }
      return send(res, 200, settings);
    }
    if (path === "/api/push" && method === "GET") return send(res, 200, push ? push.status() : { enabled: false });
    if (path === "/api/push/subscribe" && method === "POST") {
      if (!push?.enabled) throw new HttpError(409, "notifiche non configurate sul server");
      const body = await readJson(req, 8192);
      store.addPushSubscription(body.subscription || {}, String(body.device || req.headers["user-agent"] || "").slice(0, 200));
      activity({ type: "settings", text: "notifiche attivate su un dispositivo" });
      return send(res, 200, push.status());
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const body = await readJson(req, 8192);
      store.removePushSubscription(String(body.endpoint || ""));
      return send(res, 200, push ? push.status() : { enabled: false });
    }
    if (path === "/api/push/test" && method === "POST") {
      if (!push?.enabled) throw new HttpError(409, "notifiche non configurate sul server");
      const english = store.settings.language === "en";
      const result = await push.notify({ title: "Cora", body: english ? "Notifications work: the agents will reach you here." : "Le notifiche funzionano: gli agenti ti scriveranno qui.", url: "/#/settings", tag: "test" });
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
      if (channels.active === "telegram") telegram.start();
      activity({ type: "telegram", text: `token del bot Telegram salvato in hush (@${user.username})` });
      return send(res, 200, { telegram: telegram.status(), bot: { id: String(user.id), username: user.username, name: user.first_name } });
    }
    if (path === "/api/activity" && method === "GET") {
      return send(res, 200, store.recentActivity(300));
    }
    if (path === "/api/cron/preview" && method === "GET") {
      try {
        return send(res, 200, { next: nextRuns(url.searchParams.get("expr") || "", config.timezone, 3).map((date) => date.toISOString()) });
      } catch (error) {
        throw new HttpError(400, error.message);
      }
    }
    if (path === "/api/agents" && method === "POST") {
      const agent = store.createAgent(await readJson(req));
      bots?.sync();
      tgBots?.sync();
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
        const updated = store.updateAgent(agent.id, await readJson(req));
        bots?.sync();
        tgBots?.sync();
        ensureBoxSoon(updated);
        return send(res, 200, await publicAgent(updated));
      }
      if (method === "DELETE") {
        await boxes.remove(agent.id, { volume: url.searchParams.get("purge") === "1" }).catch(() => {});
        store.deleteAgent(agent.id);
        bots?.sync();
        tgBots?.sync();
        activity({ type: "agent", text: `eliminato ${agent.name}` });
        return send(res, 200, { ok: true });
      }
    }

    match = /^\/api\/agents\/([\w-]+)\/(memories|core|sleep|diary)(?:\/([\w-]+))?$/.exec(path);
    if (match) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const [, , section, itemId] = match;
      if (section === "memories" && !itemId && method === "GET") {
        return send(res, 200, {
          core: agent.core,
          coreHistory: store.coreHistory(agent.id),
          facts: store.memories(agent.id),
          shared: store.memories(SHARED),
          diary: store.diary(agent.id),
          lastSleepAt: agent.lastSleepAt,
          sleeping: brain.sleeping.has(agent.id),
        });
      }
      if (section === "memories" && !itemId && method === "POST") {
        const body = await readJson(req);
        const memory = store.addMemory(body.shared ? SHARED : agent.id, body.text, "manual", { pinned: body.pinned });
        return send(res, 201, memory);
      }
      if (section === "memories" && itemId) {
        const found = store.findMemory(itemId);
        if (!found || (found.key !== agent.id && found.key !== SHARED)) throw new HttpError(404, "ricordo non trovato");
        if (method === "PUT") {
          const body = await readJson(req);
          let key = found.key;
          if (body.shared !== undefined && Boolean(body.shared) !== (key === SHARED)) {
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
      const room = match[1];
      const agentId = roomAgentId(room);
      if (!isWebRoom(room) || (agentId && !store.agent(agentId))) throw new HttpError(404, "stanza non trovata");
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
      const live = [...(traces?.live.values() || [])].filter((trace) => trace.agentId === match[1]).map((trace) => trace.summary());
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
      return send(res, 200, [...live, ...store.traces(match[1], limit).filter((trace) => !live.some((item) => item.id === trace.id))]);
    }

    if (path === "/api/usage" && method === "GET") {
      const days = Math.min(366, Math.max(30, Number(url.searchParams.get("days")) || 365));
      return send(res, 200, { days, today: new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), usage: store.usageByDay(days, config.timezone) });
    }

    if (path === "/api/traces" && method === "GET") {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 12));
      const live = [...(traces?.live.values() || [])].map((trace) => trace.summary());
      return send(res, 200, [...live, ...store.recentTraces(limit).filter((trace) => !live.some((item) => item.id === trace.id))].slice(0, limit));
    }

    match = /^\/api\/traces\/(tr_[0-9a-f]+)$/.exec(path);
    if (match && method === "GET") {
      const trace = traces ? traces.get(match[1]) : store.trace(match[1]);
      if (!trace) throw new HttpError(404, "ragionamento non trovato");
      return send(res, 200, trace);
    }

    match = /^\/api\/files\/([0-9a-f]{24})$/.exec(path);
    if (match && method === "GET" && config.filesDir) {
      const file = join(config.filesDir, match[1]);
      if (!existsSync(file)) throw new HttpError(404, "file non trovato");
      const meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
      const inline = /^image\/(png|jpeg|gif|webp)$/.test(meta.type);
      return send(res, 200, readFileSync(file), {
        "Content-Type": inline ? meta.type : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${meta.name.replace(/"/g, "")}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
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
    if (match && method === "PUT" && bots) {
      const agent = store.agent(match[1]);
      if (!agent) throw new HttpError(404, "agente non trovato");
      const body = await readJson(req, 4096);
      const token = String(body.token || "").trim().replace(/^Bot\s+/i, "");
      if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token)) throw new HttpError(400, "non sembra un token di bot: copialo da Bot \u2192 Reset Token");
      const user = await bots.verify(agent, token, { mainUserId: bots.listener() ? null : discord.user?.id });
      await storeSecret(botEnvName(agent), token);
      activity({ type: "discord", agentId: agent.id, text: `token del bot salvato in hush (${user.username})` });
      await bots.attach(agent, token);
      return send(res, 200, await publicAgent(store.agent(agent.id)));
    }

    if (["/api/routines/history", "/api/routines/archive"].includes(path) && method === "GET") {
      const options = Object.fromEntries(["agentId", "kind", "query", "limit", "offset"].map((key) => [key, url.searchParams.get(key) || ""]));
      if (options.kind && !["routine", "reminder"].includes(options.kind)) throw new HttpError(400, "tipo di attività non valido");
      return send(res, 200, path.endsWith("/history") ? store.routineHistory(options) : store.routineArchive(options));
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
      if (!routine) throw new HttpError(404, "routine non trovata");
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
    for (const client of clients) client.write(line);
  };

  function events(req, res) {
    if (!authed(req)) return send(res, 401, { error: "login richiesto" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    clients.add(res);
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
      res.writeHead(response.statusCode || 502, { ...response.headers, "Cache-Control": "no-store" });
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
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.headers["x-cora"] !== "1") throw new HttpError(403, "missing X-Cora header");
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "cross-origin request");
      }
      if (url.pathname === "/healthz") return send(res, 200, "ok");
      if (url.pathname === "/auth/cloud" || url.pathname === "/auth/link") return signInFrom(req, res, url);
      if (url.pathname === "/api/cloud/access" && req.method === "POST") return await cloudAccess(req, res);
      if (url.pathname === "/api/cloud/notice" && req.method === "POST") return await cloudNotice(req, res);
      if (url.pathname === "/api/events") return events(req, res);
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname.startsWith("/box/")) return await proxyBox(req, res);
      const file = STATIC[url.pathname];
      if (file && (req.method === "GET" || req.method === "HEAD")) {
        const body = readFileSync(join(WEB_DIR, file[0]));
        return send(res, 200, body, {
          "Content-Type": file[1],
          "Content-Security-Policy": CSP,
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
      if (!authed(req)) return reject(401, "Unauthorized");
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return reject(403, "Forbidden");
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

  return { server, broadcast, watching };
}
