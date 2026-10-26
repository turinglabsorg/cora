import { EN } from "./i18n.js";

const LANGS = { it: "Italiano", en: "English" };
const LANG = (() => {
  let saved = "";
  try { saved = localStorage.getItem("cora.lang") || ""; } catch {}
  if (LANGS[saved]) return saved;
  return /^it\b/i.test(navigator.language || "") ? "it" : "en";
})();
const LOCALE = LANG === "it" ? "it-IT" : "en-GB";

/** The UI is written in Italian; in English every fixed text goes through the dictionary. */
function tr(text, vars) {
  let out = LANG === "en" && typeof text === "string" ? EN[text] ?? text : text;
  if (vars) out = String(out).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
  return out;
}

/** Text that is never translated: names, messages, memories, anything people or agents wrote. */
function raw(text) {
  return document.createTextNode(String(text ?? ""));
}

function setLanguage(lang) {
  try { localStorage.setItem("cora.lang", lang); } catch {}
  location.reload();
}

const PROVIDERS = {
  claude: "Claude (abbonamento)",
  codex: "ChatGPT (abbonamento)",
  ollama: "Ollama Cloud",
  orcarouter: "OrcaRouter",
  hermes: "Hermes Agent",
};
const PROVIDER_HINTS = {
  claude: "Claude Code non trovato su questa macchina",
  codex: "Codex non trovato su questa macchina",
  ollama: "manca CORA_OLLAMA_API_KEY in hush",
  orcarouter: "manca CORA_ORCAROUTER_API_KEY in hush",
  hermes: "Hermes non trovato su questa macchina",
};
const PROVIDER_SHORT = { claude: "Claude", codex: "ChatGPT", ollama: "Ollama", orcarouter: "OrcaRouter", hermes: "Hermes" };
const PRESETS = [
  ["Ogni mattina 9:00", "0 9 * * *"],
  ["Ogni sera 21:00", "0 21 * * *"],
  ["Lun-ven 8:30", "30 8 * * 1-5"],
  ["Lunedì 10:00", "0 10 * * 1"],
  ["Ogni ora", "0 * * * *"],
  ["Ogni 15 minuti", "*/15 * * * *"],
];
const TABS = [
  ["profilo", "Profilo", "user"],
  ["chat", "Chat", "chat"],
  ["memoria", "Memoria", "book"],
  ["routine", "Routine", "clock"],
  ["desktop", "Desktop", "monitor"],
  ["ragionamento", "Ragionamento", "bulb"],
  ["attivita", "Attività", "pulse"],
];
const SALOTTO = "web";
const TRACE_KIND = { chat: "conversazione", routine: "routine", sleep: "sonno" };
const TRACE_STATUS = { running: ["in corso", "agent"], done: ["ha risposto", "ok"], pass: ["passa", ""], error: ["errore", "err"], interrupted: ["interrotto", "err"] };
const TRANSPORTS = {
  discord: { label: "Discord", icon: "hash" },
  telegram: { label: "Telegram", icon: "send" },
};
const STATE_LABEL = {
  ready: "in onda", connecting: "si collega…", reconnecting: "si ricollega…", idle: "pronto", stopped: "spento",
  "missing-token": "senza token", error: "errore",
};

const ICONS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.3A8.5 8.5 0 1 1 21 11.5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  book: '<path d="M2.5 4.5h6a3.5 3.5 0 0 1 3.5 3.5v12.5a2.5 2.5 0 0 0-2.5-2.5h-7z"/><path d="M21.5 4.5h-6A3.5 3.5 0 0 0 12 8v12.5a2.5 2.5 0 0 1 2.5-2.5h7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 21h8M12 16.5V21"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  logout: '<path d="M15 3.5h3.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H15M10 16.5l4.5-4.5L10 7.5M14.5 12H3.5"/>',
  send: '<path d="M21.5 2.5 10.5 13.5M21.5 2.5l-7 19-4-8-8-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3.5 6h17M9 6V4h6v2M18.5 6l-.9 13.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/>',
  pin: '<path d="M12 16.5V22M8 3.5h8l-1 6 3.5 4.5v2h-13v-2L9 9.5z"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 17.7 17M20 4.5v7h-7"/>',
  moon: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M16 7l3 3M18.5 4.5l2 2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  back: '<path d="M15 18.5 8.5 12 15 5.5"/>',
  next: '<path d="m9 18.5 6.5-6.5L9 5.5"/>',
  external: '<path d="M14 3.5h6.5V10M20.5 3.5 11 13M19 14v5.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H10"/>',
  power: '<path d="M12 2.5v9M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 2.5v4M14.5 2.5v4M9.5 17.5v4M14.5 17.5v4M2.5 9.5h4M2.5 14.5h4M17.5 9.5h4M17.5 14.5h4"/>',
  tool: '<path d="M14.7 6.3a4.2 4.2 0 0 0-5.6 5.3L3 17.7 6.3 21l6.1-6.1a4.2 4.2 0 0 0 5.3-5.6l-2.7 2.7-2.6-.6-.6-2.6z"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 2 20.5h20z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  file: '<path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5z"/><path d="M14 3v4.5h4.5"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  maximize: '<path d="M8 3.5H3.5V8M16 3.5h4.5V8M8 20.5H3.5V16M16 20.5h4.5V16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m7 9 3 3-3 3M12.5 15H17"/>',
  upgrade: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8 11l4-4 4 4"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  ask: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 3.8M12 17.2v.01"/>',
};

const app = document.getElementById("app");

/**
 * On iOS the standalone PWA's fixed layout is taller than what you can see, and
 * the keyboard covers the bottom. Size the app to the real visible viewport, and
 * while the keyboard is up (an input focused and the viewport much shorter) mark
 * the root so the tab bar hides and the composer rests on the keyboard.
 */
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    const typing = document.activeElement && document.activeElement.matches("input, textarea");
    const kbd = Boolean(typing) && window.innerHeight - vv.height > 120;
    document.documentElement.classList.toggle("kbd-open", kbd);
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  document.addEventListener("focusin", apply);
  document.addEventListener("focusout", () => setTimeout(apply, 50));
  apply();
}
fitViewport();
const S = { data: null, activity: [], events: null, timers: [], refreshTimer: null, live: null };

/* ---------- dom ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "vars") for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "placeholder" || key === "title" || key === "aria-label") el.setAttribute(key, tr(value));
    else if (key === "value") el.value = value;
    else if (key === "checked") el.checked = Boolean(value);
    else if (key === "selected") el.selected = Boolean(value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(typeof kid === "string" ? tr(kid) : String(kid)));
  }
  return el;
}

function icon(name, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `ico${cls ? ` ${cls}` : ""}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || "";
  return svg;
}

function btn(label, { icon: name, cls = "", onclick, href, type = "button", disabled, title, target } = {}) {
  const kids = [name ? icon(name) : null, label ? h("span", {}, label) : null];
  const classes = `btn${label ? "" : " only-icon"}${cls ? ` ${cls}` : ""}`;
  if (href) return h("a", { class: classes, href, target, rel: target ? "noopener" : null, title, "aria-label": label ? null : title }, kids);
  return h("button", { type, class: classes, onclick, disabled, title, "aria-label": label ? null : title }, kids);
}

function panel({ icon: name, title, hint, actions, cls = "", tag = "section" } = {}, ...body) {
  return h(tag, { class: `panel${cls ? ` ${cls}` : ""}` },
    title ? h("header", { class: "panel-head" },
      name ? h("span", { class: "panel-ico" }, icon(name)) : null,
      h("div", { class: "panel-title" }, h("h2", {}, title), hint ? h("p", {}, hint) : null),
      actions ? h("div", { class: "panel-actions" }, actions) : null) : null,
    body.flat(Infinity).filter(Boolean).length ? h("div", { class: "panel-body" }, body) : null);
}

function pageHead(title, subtitle, actions) {
  return h("div", { class: "page-head" },
    h("div", { class: "page-title" }, h("h1", {}, title), subtitle ? h("p", {}, subtitle) : null),
    actions ? h("div", { class: "page-actions" }, actions) : null);
}

function field(label, control, hint, cls = "") {
  return h("label", { class: `field${cls ? ` ${cls}` : ""}` }, h("span", { class: "label" }, label), control, hint ? h("small", {}, hint) : null);
}

function switchInput(name, label, checked, hint) {
  return h("label", { class: "switch" },
    h("input", { type: "checkbox", name, checked }),
    h("span", { class: "rocker" }),
    h("span", { class: "switch-text" }, label, hint ? h("small", {}, hint) : null));
}

function avatar(agent, size = "") {
  const el = h("span", { class: `avatar${size ? ` ${size}` : ""}`, vars: { "--ring": agent.color || "#f2a93b" } });
  if (agent.avatarUrl) el.append(h("img", { src: agent.avatarUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
  else el.append((agent.name || "?").slice(0, 2));
  return el;
}

function badge(text, cls = "", name = "") {
  return h("span", { class: `badge${cls ? ` ${cls}` : ""}` }, name ? icon(name) : null, text);
}

function tag(text, cls = "") {
  return h("span", { class: `tag${cls ? ` ${cls}` : ""}` }, text);
}

function codeLine(text) {
  return h("div", { class: "code-line" }, h("code", {}, text), btn("", { icon: "copy", cls: "sm ghost", title: "Copia", onclick: () => {
    navigator.clipboard?.writeText(text).then(() => toast("Copiato"), () => toast("Non riesco a copiare: selezionalo a mano", true));
  } }));
}

function empty(name, text, action) {
  return h("div", { class: "empty" }, icon(name), h("p", {}, text), action || null);
}

/* ---------- api ---------- */
async function api(path, { method = "GET", body } = {}) {
  const headers = { "X-Cora": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  if (response.status === 401 && path !== "/api/login") {
    renderLogin();
    throw new Error("login richiesto");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function toast(text, error = false) {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast${error ? " err" : ""}`, role: "status" }, icon(error ? "alert" : "check"), h("span", {}, tr(text)));
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

async function guard(promise, okText) {
  try {
    const result = await promise;
    if (okText) toast(okText);
    return result;
  } catch (error) {
    if (error.message !== "login richiesto") toast(error.message, true);
    return null;
  }
}

function clearTimers() {
  S.timers.forEach((timer) => clearInterval(timer));
  S.timers = [];
}

/* ---------- formatting ---------- */
function fmtTime(iso, withDay = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: S.data?.timezone || "Europe/Rome",
    ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}),
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function channelName(id) {
  if (!id) return "";
  if (id === SALOTTO) return "salotto";
  if (/^web-/.test(id)) return tr("chat con {name}", { name: S.data?.agents.find((agent) => agent.id === id.slice(4))?.name || "?" });
  if (/^tg:/.test(id)) return S.data?.telegram.chats.find((chat) => chat.id === id.slice(3))?.title || "chat Telegram";
  const channel = [...(S.data?.channels || []), ...(S.data?.discordChannels || [])].find((item) => item.id === id);
  return channel ? `#${channel.name}` : `#${id}`;
}

function channelChipLabel(channel) {
  if (channel.kind === "telegram") return channel.name;
  return `${channel.thread ? "↳ " : "#"}${channel.name}`;
}

function modelLabel(model, { short = false } = {}) {
  if (!model) return tr("predefinito · {model}", { model: modelLabel(S.data?.settings.defaultModel || "", { short }) });
  const known = S.data?.models.find((item) => item.id === model);
  const provider = model.split("/")[0];
  const names = short ? PROVIDER_SHORT : PROVIDERS;
  return `${names[provider] || provider} · ${known?.label || model.split("/").slice(1).join("/")}`;
}

function transportInfo(kind = S.data.transport) {
  const status = kind === "telegram" ? S.data.telegram : S.data.discord;
  let where;
  if (kind === "telegram") {
    const chats = S.data.settings.telegramChatIds.map((id) => S.data.telegram.chats.find((chat) => chat.id === id)?.title || id);
    where = chats.length ? chats.join(", ") : "nessuna chat accesa";
  } else {
    const guilds = S.data.discord.guilds.filter((guild) => S.data.settings.guildIds.includes(guild.id)).map((guild) => guild.name);
    where = guilds.length ? guilds.join(", ") : "nessun server acceso";
  }
  return { kind, ...TRANSPORTS[kind], state: status.state, error: status.error, user: status.user, where };
}

function shade(hex) {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((value >> 16) & 255) * 0.55)}, ${Math.round(((value >> 8) & 255) * 0.55)}, ${Math.round((value & 255) * 0.55)})`;
}

/* ---------- data and live events ---------- */
async function loadState() {
  S.data = await api("/api/state");
  updateLamp();
  return S.data;
}

function scheduleRefresh() {
  clearTimeout(S.refreshTimer);
  S.refreshTimer = setTimeout(async () => {
    await guard(loadState());
    if (route()[0] === "banco" && document.querySelector(".agent-grid")) renderDashboard();
  }, 900);
}

function connectEvents() {
  if (S.events) return;
  S.events = new EventSource("/api/events");
  S.events.onmessage = (event) => {
    let entry;
    try { entry = JSON.parse(event.data); } catch { return; }
    if (["web-message", "web-typing", "trace"].includes(entry.type)) {
      S.live?.(entry);
      return;
    }
    if (entry.type === "request") {
      guard(loadState()).then(drawRequests);
      return;
    }
    if (entry.type === "telegram-chats") {
      if (route()[0] === "settings" && !document.activeElement?.matches("input, textarea, select")) guard(loadState()).then(() => renderSettings());
      return;
    }
    if ((entry.type === "discord" || entry.type === "telegram") && entry.state && S.data) {
      S.data[entry.type].state = entry.state;
      S.data[entry.type].error = entry.error;
      updateLamp();
      return;
    }
    S.activity.push(entry);
    if (S.activity.length > 500) S.activity.splice(0, S.activity.length - 500);
    for (const list of document.querySelectorAll(".feed")) {
      if (list.dataset.agent && list.dataset.agent !== entry.agentId) continue;
      list.querySelector(".feed-empty")?.remove();
      list.prepend(feedLine(entry));
    }
    if (["memory", "sleep", "routine-end", "routine-start", "box", "agent", "settings"].includes(entry.type)) scheduleRefresh();
    const [page, agentId, tab] = route();
    if (["memory", "sleep"].includes(entry.type) && page === "agent" && tab === "memoria" && agentId === entry.agentId && !document.activeElement?.matches("textarea, input")) renderAgent();
  };
}

/* ---------- shell ---------- */
function route() {
  return location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
}

function lamp() {
  return h("span", { class: "onair" }, h("i"), h("span", {}, "…"));
}

function updateLamp() {
  if (!S.data) return;
  const info = transportInfo();
  const cls = info.state === "ready" ? "on" : ["connecting", "reconnecting", "idle"].includes(info.state) ? "wait" : "err";
  for (const el of document.querySelectorAll(".onair")) {
    el.className = `onair ${cls}`;
    el.title = info.error || `${info.label}: ${tr(STATE_LABEL[info.state] || info.state)}`;
    el.lastChild.textContent = info.state === "ready" ? "On air" : tr(STATE_LABEL[info.state] || info.state);
  }
}

function agentDot(agent) {
  return h("i", { class: `dot${agent.enabled ? " on" : ""}`, title: agent.enabled ? "In onda" : "Muto" });
}

function shell(content, { title = "Cora", back = "", mode = "" } = {}) {
  clearTimers();
  const [section, current] = route();
  const nav = [
    ["agenti", "Agenti", "users", ["agenti", "agent", "new"].includes(section)],
    ["", "Salotto", "chat", section === ""],
    ["banco", "Banco", "grid", section === "banco"],
    ["settings", "Impostazioni", "sliders", section === "settings"],
  ];
  const info = transportInfo();
  app.replaceChildren(h("div", { class: `app${mode ? ` mode-${mode}` : ""}` },
    h("aside", { class: "sidebar" },
      h("a", { class: "brand", href: "#/" }, h("img", { src: "/assets/icon-192.png", alt: "" }), h("span", {}, h("b", {}, "Cora"), h("small", {}, "resident agents"))),
      h("a", { class: "onair-card", href: "#/settings" },
        h("span", { class: "panel-ico" }, icon(info.icon)),
        h("span", { class: "grow" }, h("b", {}, info.label), h("small", {}, info.where)),
        lamp()),
      h("nav", { class: "side-nav" }, nav.map(([key, label, name, active]) => h("a", { href: `#/${key}`, class: active ? "active" : "" }, icon(name), h("span", {}, label)))),
      h("div", { class: "side-agents" },
        h("span", { class: "label" }, "Agenti"),
        S.data.agents.map((agent) => h("a", { href: `#/agent/${agent.id}/chat`, class: section === "agent" && current === agent.id ? "active" : "" }, avatar(agent, "xs"), h("span", { class: "grow" }, raw(agent.name)), agentDot(agent))),
        h("a", { href: "#/new", class: section === "new" ? "active" : "" }, h("span", { class: "avatar xs add" }, icon("plus")), h("span", { class: "grow" }, "Nuovo agente"))),
      h("button", { class: "side-logout", type: "button", onclick: logout }, icon("logout"), h("span", {}, "Esci"))),
    h("header", { class: "appbar" },
      back ? h("a", { class: "icon-btn", href: back, "aria-label": "Indietro" }, icon("back")) : h("a", { class: "appbar-brand", href: "#/" }, h("img", { src: "/assets/icon-192.png", alt: "Cora" })),
      h("h1", {}, title),
      lamp()),
    h("main", { class: "content" }, h("div", { class: "wrap" }, content)),
    h("nav", { class: "tabbar" }, nav.map(([key, label, name, active]) => h("a", { href: `#/${key}`, class: active ? "active" : "" }, icon(name), h("span", {}, label))))));
  updateLamp();
}

async function logout() {
  await guard(api("/api/logout", { method: "POST" }));
  S.events?.close();
  S.events = null;
  // On usecora.space, leaving the panel also signs out there, or the next visit would walk straight back in.
  if (S.cloud) {
    location.href = S.cloud.logout;
    return;
  }
  renderLogin();
}

/* ---------- requests ---------- */
function requestsStrip() {
  return h("div", { class: "requests-slot" }, requestCards());
}

function requestCards() {
  const requests = S.data?.requests || [];
  if (!requests.length) return [];
  return h("section", { class: "requests" },
    h("div", { class: "requests-head" }, icon("ask"), h("b", {}, requests.length === 1 ? "Una richiesta per te" : tr("{count} richieste per te", { count: requests.length }))),
    requests.map((request) => {
      const agent = S.data.agents.find((item) => item.id === request.agentId);
      return h("a", { class: "request-card", href: request.channelId === "web" ? "#/" : `#/agent/${request.agentId}/chat` },
        agent ? avatar(agent, "sm") : null,
        h("span", { class: "grow" }, h("b", {}, raw(agent?.name || "?")), h("span", { class: "row-text" }, raw(request.content))),
        h("span", { class: "row-meta" }, fmtTime(request.at)),
        icon("next", "chev"));
    }));
}

function drawRequests() {
  for (const slot of document.querySelectorAll(".requests-slot")) slot.replaceChildren(...[requestCards()].flat());
}

/* ---------- feed ---------- */
const FEED_ICON = { tool: "tool", say: "chat", message: "chat", pass: "next", memory: "edit", sleep: "moon", "routine-start": "play", "routine-end": "stop", error: "alert", warning: "alert", box: "monitor", discord: "hash", telegram: "send", settings: "sliders", agent: "user" };

function feedLine(entry) {
  const agent = S.data?.agents.find((item) => item.id === entry.agentId);
  const who = entry.agentName || agent?.name || entry.author || "cora";
  let what = entry.text || "";
  if (entry.type === "tool") what = `${entry.tool} ${entry.args || ""}${entry.ok === false ? " ✗" : ""}`;
  if (entry.type === "pass") what = tr("passa");
  if (entry.type === "routine-start") what = tr("routine «{name}»", { name: entry.text });
  if (entry.type === "routine-end") what = tr(entry.ok ? "routine finita «{name}»" : "routine fallita «{name}»", { name: entry.text });
  if (entry.type === "say" && entry.file) what = `${entry.text} 📎`;
  if ((entry.type === "discord" || entry.type === "telegram") && !entry.text) what = entry.state;
  const whoEl = h("span", { class: "who" }, raw(who));
  if (agent?.color && entry.type === "say") whoEl.style.color = shade(agent.color);
  return h("li", { class: entry.type },
    h("span", { class: "feed-ico" }, icon(FEED_ICON[entry.type] || "info")),
    h("div", { class: "feed-text" },
      h("div", { class: "feed-meta" }, h("time", {}, fmtTime(entry.at)), whoEl, entry.channelId ? h("span", { class: "where" }, raw(channelName(entry.channelId))) : null),
      h("span", { class: "what" }, raw(what))),
    entry.traceId && entry.agentId && entry.type !== "tool" ? h("a", { class: "why", href: `#/agent/${entry.agentId}/ragionamento/${entry.traceId}`, title: "Ragionamento", "aria-label": "Ragionamento" }, icon("bulb")) : null);
}

function feed(agentId) {
  const entries = S.activity.filter((entry) => !["discord", "telegram"].includes(entry.type) || entry.text).filter((entry) => !agentId || entry.agentId === agentId).slice(-150).reverse();
  return h("ul", { class: "feed", "data-agent": agentId || null },
    entries.length ? entries.map(feedLine) : h("li", { class: "feed-empty" }, "Silenzio in sala."));
}

/* ---------- dashboard ---------- */
function banners() {
  const out = [];
  const info = transportInfo();
  if (info.state === "missing-token") out.push(h("a", { class: "banner err", href: "#/settings" }, icon("key"), h("span", {}, h("b", {}, info.kind === "telegram" ? "Telegram senza token. " : "Nessuno ascolta Discord. "), info.kind === "telegram" ? "Incolla il token del bot (da BotFather) nelle impostazioni." : "Attiva «Message Content Intent» nella pagina Bot dell'app Discord di almeno un agente: Cora ascolterà con quel bot.")));
  else if (info.state === "error") out.push(h("a", { class: "banner err", href: "#/settings" }, icon("alert"), h("span", {}, h("b", {}, `${info.label}: `), raw(info.error))));
  if (info.kind === "telegram" && info.state !== "missing-token" && !S.data.settings.telegramChatIds.length) {
    out.push(h("a", { class: "banner", href: "#/settings" }, icon("info"), h("span", {}, h("b", {}, "Nessuna chat Telegram accesa. "), "Aggiungi il bot a un gruppo e accendi la chat nelle impostazioni.")));
  }
  if (!S.data.boxImage.ready) out.push(h("div", { class: "banner" }, icon("monitor"), h("span", {}, h("b", {}, "Immagine desktop mancante. "), tr("Va costruita {image} su questa macchina.", { image: S.data.boxImage.name }))));
  const missing = Object.entries(S.data.providers || {}).filter(([, ok]) => !ok).map(([key]) => PROVIDERS[key]);
  if (missing.length) out.push(h("div", { class: "banner" }, icon("chip"), h("span", {}, h("b", {}, "Provider non disponibili: "), `${missing.join(", ")}.`)));
  return out.length ? h("div", { class: "banners" }, out) : null;
}

function statCard({ icon: name, value, label, sub, href }) {
  return h(href ? "a" : "div", { class: "stat", href },
    h("span", { class: "panel-ico" }, icon(name)),
    h("span", { class: "stat-text" }, h("b", {}, value), h("span", { class: "label" }, label), sub ? h("small", {}, sub) : null));
}

function agentAccount(agent) {
  if (S.data.transport === "telegram") return agent.telegramBot?.user ? ["Bot suo", "on"] : ["Bot principale", ""];
  return agent.bot?.user ? ["Bot suo", "on"] : ["Webhook", ""];
}

function agentCard(agent, index) {
  const running = agent.box?.running;
  const monitor = h("a", { class: "monitor", href: `#/agent/${agent.id}/desktop`, "aria-label": `Desktop di ${agent.name}` });
  if (running) {
    const img = h("img", { alt: "", src: `/api/agents/${agent.id}/box/screenshot?t=${Date.now()}` });
    img.addEventListener("error", () => monitor.replaceChildren(h("span", { class: "dark" }, icon("monitor"), "Segnale assente")));
    monitor.append(img);
  } else monitor.append(h("span", { class: "dark" }, icon("monitor"), agent.tools ? "Desktop spento" : "Senza computer"));
  const pct = Math.round(agent.chattiness * 100);
  const routines = S.data.routines.filter((routine) => routine.agentId === agent.id && routine.enabled).length;
  const [account, accountOn] = agentAccount(agent);
  return h("article", { class: `agent-card${agent.enabled ? "" : " off"}`, vars: { "--ring": agent.color || "#f2a93b", "--delay": `${index * 50}ms` } },
    monitor,
    h("a", { class: "agent-ident", href: `#/agent/${agent.id}/chat` },
      avatar(agent),
      h("span", { class: "grow" }, h("b", {}, raw(agent.name)), h("small", { title: modelLabel(agent.model) }, modelLabel(agent.model, { short: true }))),
      icon("next", "chev")),
    h("div", { class: "meter", title: `Loquacità ${pct}` }, h("span", { class: "label" }, "Loquacità"), h("span", { class: "track" }, h("span", { class: "fill", vars: { width: `${pct}%` } })), h("span", { class: "label" }, pct)),
    h("div", { class: "badges" },
      badge(agent.enabled ? "In onda" : "Muto", agent.enabled ? "on" : "", "radio"),
      badge(running ? "Desktop" : "Spento", running ? "on" : "", "monitor"),
      badge(account, accountOn, TRANSPORTS[S.data.transport].icon),
      badge(String(routines), routines ? "on" : "", "clock"),
      badge(String(agent.memoryCount), agent.memoryCount ? "on" : "", "book")),
    h("div", { class: "agent-actions" },
      btn("Chat", { icon: "chat", href: `#/agent/${agent.id}/chat`, cls: "sm" }),
      btn("Desktop", { icon: "monitor", href: `#/agent/${agent.id}/desktop`, cls: "sm" }),
      btn("", { icon: "bulb", href: `#/agent/${agent.id}/ragionamento`, cls: "sm", title: "Ragionamento" })));
}

function traceRow(trace, { withAgent = false } = {}) {
  const agent = S.data.agents.find((item) => item.id === trace.agentId);
  const [label, cls] = TRACE_STATUS[trace.status] || [trace.status, ""];
  const lead = withAgent && agent
    ? avatar(agent, "sm")
    : h("span", { class: `status-ico ${cls}` }, icon(trace.status === "error" ? "alert" : trace.status === "pass" ? "next" : trace.kind === "sleep" ? "moon" : trace.kind === "routine" ? "clock" : "chat"));
  return h("a", { class: "row-link", href: `#/agent/${trace.agentId}/ragionamento/${trace.id}` },
    lead,
    h("span", { class: "grow" },
      h("span", { class: "row-meta" }, withAgent && agent ? h("b", {}, raw(agent.name)) : null, tag(label, cls), tag(TRACE_KIND[trace.kind] || trace.kind), raw(`${fmtTime(trace.startedAt, true)} · ${traceWhere(trace)} · ${duration(trace)}`)),
      h("span", { class: "row-text" }, trace.error || trace.output ? raw(trace.error || trace.output) : trace.status === "running" ? "…" : "(niente)"),
      trace.tools?.length ? h("span", { class: "row-tools" }, trace.tools.map((tool) => h("span", {}, icon("tool"), tool))) : null),
    icon("next", "chev"));
}

async function renderDashboard() {
  const agents = S.data.agents;
  const info = transportInfo();
  const desktops = agents.filter((agent) => agent.box?.running).length;
  const active = S.data.routines.filter((routine) => routine.enabled);
  const next = active.filter((routine) => routine.nextRunAt).sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];
  const recent = (await guard(api("/api/traces?limit=8"))) || [];
  if (route()[0] !== "banco") return;
  const who = info.user ? (info.kind === "telegram" ? `@${info.user.username}` : info.user.username) : "";
  shell([
    pageHead(h("span", {}, "Co", h("em", {}, "ra")), tr("Vive su {transport}: {where}.", { transport: info.label, where: tr(info.where) }), [btn("Salotto", { icon: "chat", href: "#/" }), btn("Nuovo agente", { icon: "plus", href: "#/new", cls: "primary" })]),
    banners(),
    requestsStrip(),
    h("div", { class: "stats" },
      statCard({ icon: info.icon, value: info.label, label: STATE_LABEL[info.state] || info.state, sub: who ? tr("come {who}", { who }) : "", href: "#/settings" }),
      statCard({ icon: "radio", value: `${agents.filter((agent) => agent.enabled).length}/${agents.length}`, label: "agenti in onda", href: "#/agenti" }),
      statCard({ icon: "monitor", value: desktops, label: "desktop accesi" }),
      statCard({ icon: "clock", value: active.length, label: "routine attive", sub: next ? tr("prossima {time} · {name}", { time: fmtTime(next.nextRunAt), name: agents.find((agent) => agent.id === next.agentId)?.name || "" }) : "" })),
    panel({ icon: "users", title: "Agenti", hint: "Ognuno con il suo cervello, la sua memoria e il suo computer.", actions: btn("", { icon: "plus", href: "#/new", title: "Nuovo agente", cls: "sm" }) },
      agents.length ? h("div", { class: "agent-grid" }, agents.map(agentCard)) : empty("users", "Ancora nessun agente.", btn("Crea il primo", { icon: "plus", href: "#/new", cls: "primary" }))),
    h("div", { class: "split" },
      panel({ icon: "pulse", title: "Telescrivente", hint: "Tutto quello che succede, in diretta.", cls: "teletype" }, feed()),
      panel({ icon: "bulb", title: "Ultimi ragionamenti", hint: "Cosa hanno pensato e fatto, turno per turno." },
        recent.length ? h("div", { class: "rows" }, recent.map((trace) => traceRow(trace, { withAgent: true }))) : empty("bulb", "Nessun turno ancora."))),
  ], { title: "Banco" });
  S.timers.push(setInterval(() => {
    for (const img of document.querySelectorAll(".agent-card .monitor img")) img.src = img.src.replace(/t=\d+/, `t=${Date.now()}`);
  }, 20000));
  S.timers.push(setInterval(() => scheduleRefresh(), 30000));
}

function renderAgents() {
  const agents = S.data.agents;
  shell([
    pageHead("Agenti", tr("{on} in onda su {total}.", { on: agents.filter((agent) => agent.enabled).length, total: agents.length }), [btn("Nuovo agente", { icon: "plus", href: "#/new", cls: "primary" })]),
    panel({ icon: "users", title: "Gli agenti", hint: "Tocca un agente per aprire la chat; da lì profilo, memoria, routine e desktop." },
      agents.length ? h("div", { class: "rows" }, agents.map((agent) => {
        const [account] = agentAccount(agent);
        return h("a", { class: "row-link", href: `#/agent/${agent.id}/chat` },
          avatar(agent),
          h("span", { class: "grow" },
            h("span", { class: "row-title" }, raw(agent.name), agentDot(agent)),
            h("span", { class: "row-meta" }, `${modelLabel(agent.model, { short: true })} · ${tr(agent.box?.running ? "desktop acceso" : "desktop spento")} · ${tr(account).toLowerCase()}`)),
          icon("next", "chev"));
      })) : empty("users", "Ancora nessun agente.", btn("Crea il primo", { icon: "plus", href: "#/new", cls: "primary" }))),
  ], { title: "Agenti" });
}

/* ---------- agent ---------- */
function modelSelect(name, current, { allowDefault = true } = {}) {
  const select = h("select", { name });
  if (allowDefault) select.append(h("option", { value: "" }, tr("Predefinito ({model})", { model: modelLabel(S.data.settings.defaultModel) })));
  const groups = {};
  for (const model of S.data.models) (groups[model.provider] ||= []).push(model);
  for (const provider of Object.keys(PROVIDERS)) {
    const list = groups[provider];
    if (!list?.length) continue;
    select.append(h("optgroup", { label: PROVIDERS[provider] },
      list.map((model) => h("option", { value: model.id, selected: model.id === current }, `${model.label}${model.vision ? tr(" · vede") : ""}${model.tools ? "" : tr(" · senza strumenti")}`))));
  }
  if (current && !S.data.models.some((model) => model.id === current)) select.append(h("option", { value: current, selected: true }, tr("{model} (non disponibile ora)", { model: current })));
  return select;
}

/**
 * The model list, plus a box to type any model id (provider/model) that the
 * list does not show. When the box is filled it wins, and the list dims.
 */
function modelPicker(name, current, options) {
  const select = modelSelect(name, current, options);
  const custom = h("input", { type: "text", name: `${name}Custom`, autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "oppure scrivi l'id, es. orcarouter/deepseek/deepseek-v4.1-flash" });
  custom.addEventListener("input", () => { select.disabled = Boolean(custom.value.trim()); });
  return h("div", { class: "model-pick" }, select, custom);
}

/** The model a form asks for: the typed id if there is one, otherwise the list. */
function pickedModel(data, name) {
  return String(data.get(`${name}Custom`) || "").trim() || data.get(name) || "";
}

function channelChips(selected) {
  const chosen = new Set(selected);
  const wrap = h("div", { class: "chips", "data-channels": "" });
  for (const channel of S.data.channels) {
    const chip = h("button", { type: "button", class: `chip${chosen.has(channel.id) ? " on" : ""}`, "data-id": channel.id }, icon(channel.kind === "telegram" ? "send" : "hash"), raw(channelChipLabel(channel).replace(/^#/, "")));
    chip.addEventListener("click", () => chip.classList.toggle("on"));
    wrap.append(chip);
  }
  if (!S.data.channels.length) wrap.append(h("small", {}, S.data.transport === "telegram" ? "Nessuna chat Telegram accesa: accendile nelle impostazioni." : "Nessun canale visibile (Discord non collegato?)."));
  return wrap;
}

function armedButton(label, armedLabel, { icon: name = "trash", onconfirm }) {
  const button = btn(label, { icon: name, cls: "danger" });
  let armed = false;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.classList.add("armed");
      button.lastChild.textContent = armedLabel;
      setTimeout(() => { armed = false; button.classList.remove("armed"); button.lastChild.textContent = label; }, 4000);
      return;
    }
    await onconfirm();
  });
  return button;
}

function agentForm(agent) {
  const isNew = !agent.id;
  const nameInput = h("input", { type: "text", name: "name", value: agent.name || "", required: true, maxlength: 32, placeholder: "es. Marta", autocomplete: "off" });
  const avatarInput = h("input", { type: "url", name: "avatarUrl", value: agent.avatarUrl || "", placeholder: "https://… (png o jpg)" });
  const fader = h("input", { type: "range", class: "fader", name: "chattiness", min: 0, max: 100, value: Math.round((agent.chattiness ?? 0.5) * 100) });
  const faderValue = h("b", { class: "fader-value" }, fader.value);
  fader.addEventListener("input", () => { faderValue.textContent = fader.value; });
  const hidden = (agent.channelIds || []).filter((id) => !S.data.channels.some((channel) => channel.id === id));
  const form = h("form", { class: "stack" },
    panel({ icon: "user", title: "Identità", hint: "Come si chiama e come appare." },
      h("div", { class: "grid2" },
        field("Nome", nameInput),
        field("Colore", h("input", { type: "color", name: "color", value: agent.color || "#e8a33d" })),
        h("div", { class: "field full" }, h("span", { class: "label" }, "Avatar"),
          h("div", { class: "input-row" }, avatarInput,
            btn("Genera", { icon: "spark", onclick: () => {
              const seed = encodeURIComponent(nameInput.value || "cora");
              avatarInput.value = `https://api.dicebear.com/9.x/notionists/png?seed=${seed}&size=256&backgroundColor=f2a93b,e9dfcc,8cc56a,6fa8dc`;
            } }))))),
    panel({ icon: "chip", title: "Cervello", hint: "Con che modello pensa e cosa può usare." },
      h("div", { class: "stack-sm" },
        field("Modello", modelPicker("model", agent.model || "")),
        field("Ragionamento: livello", h("select", { name: "effort" },
          [["", "Automatico"], ["low", "Basso"], ["medium", "Medio"], ["high", "Alto"]].map(([value, label]) => h("option", { value, selected: (agent.effort || (agent.think ? "high" : "")) === value }, label))),
        "Quanto pensa prima di rispondere: più alto è più accurato ma più lento."),
        switchInput("tools", "Usa il suo computer", agent.tools ?? true, "Un desktop Linux tutto suo, che vedi anche tu."))),
    panel({ icon: "spark", title: "Carattere", hint: "Chi è, come parla, cosa gli interessa, che rapporto ha con gli altri." },
      h("textarea", { name: "personality", class: "tall", placeholder: "Chi è, come parla, cosa gli interessa, cosa odia, che rapporto ha con gli altri agenti e con te…" }, agent.personality || "")),
    panel({ icon: "radio", title: "Ascolto", hint: "Quanto interviene e dove." },
      h("div", { class: "stack-sm" },
        h("div", { class: "field" }, h("span", { class: "field-row" }, h("span", { class: "label" }, "Loquacità"), faderValue), fader,
          h("small", {}, "Quanto spesso interviene quando nessuno lo chiama per nome. Se lo nomini risponde sempre.")),
        h("div", { class: "field" }, h("span", { class: "label" }, tr("Canali {transport}", { transport: TRANSPORTS[S.data.transport].label })), channelChips(agent.channelIds || []),
          h("small", {}, "Nessuno selezionato = li ascolta tutti.")),
        switchInput("enabled", "In onda", agent.enabled ?? true, "Spento non ascolta e non parla, da nessuna parte."))),
    h("div", { class: "savebar" },
      isNew ? null : armedButton("Elimina", "Conferma", { onconfirm: async () => {
        if (await guard(api(`/api/agents/${agent.id}`, { method: "DELETE" }), `${agent.name} eliminato`)) {
          await loadState();
          location.hash = "#/agenti";
        }
      } }),
      h("span", { class: "spacer" }),
      btn(isNew ? "Crea agente" : "Salva", { icon: "check", type: "submit", cls: "primary" })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const body = {
      name: data.get("name"),
      avatarUrl: data.get("avatarUrl"),
      model: pickedModel(data, "model"),
      color: data.get("color"),
      chattiness: Number(data.get("chattiness")) / 100,
      channelIds: [...hidden, ...[...form.querySelectorAll("[data-channels] .chip.on")].map((chip) => chip.dataset.id)],
      enabled: form.elements.enabled.checked,
      tools: form.elements.tools.checked,
      effort: data.get("effort"),
      think: false,
      personality: data.get("personality"),
    };
    const saved = await guard(isNew ? api("/api/agents", { method: "POST", body }) : api(`/api/agents/${agent.id}`, { method: "PUT", body }), isNew ? "Agente creato" : "Salvato");
    if (!saved) return;
    await loadState();
    if (isNew) location.hash = `#/agent/${saved.id}/profilo`;
    else renderAgent();
  });
  return form;
}

function tokenForm({ placeholder, path, ok }) {
  const input = h("input", { type: "password", placeholder, autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const button = btn("Collega", { icon: "link", cls: "primary" });
  const save = async () => {
    if (!input.value.trim()) return;
    button.disabled = true;
    const saved = await guard(api(path, { method: "PUT", body: { token: input.value } }), ok);
    input.value = "";
    button.disabled = false;
    if (saved) {
      await loadState();
      render();
    }
  };
  button.addEventListener("click", save);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
  });
  return h("div", { class: "input-row token" }, input, button);
}

function steps(...items) {
  return h("ol", { class: "steps" }, items.map((item) => h("li", {}, item)));
}

function discordAccount(agent) {
  const bot = agent.bot || { configured: false, env: "" };
  const actions = bot.user ? badge("Account suo", "on", "check") : badge("Via webhook", bot.configured ? "err" : "", "hash");
  let body;
  if (bot.user) {
    body = [
      h("p", { class: "lead" }, "Collegato come ", h("b", {}, raw(bot.user.username)), ". ", bot.inGuild ? "È nel server." : "Non è ancora nel server."),
      bot.inGuild ? null : h("div", { class: "row" }, btn("Invita nel server", { icon: "external", href: bot.inviteUrl, target: "_blank", cls: "primary" })),
    ];
  } else {
    body = [
      h("p", { class: "lead" }, bot.configured ? tr("Il token salvato non funziona ({error}): incollane uno nuovo.", { error: bot.error || bot.state }) : "Ora parla tramite il bot principale, con nome e avatar suoi. Con un bot tutto suo è online, menzionabile e «sta scrivendo…» a nome suo."),
      steps(
        h("span", {}, "apri ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "discord.com/developers"), " → New Application, chiamala ", h("b", {}, raw(agent.name)), ";"),
        "sezione Bot → Reset Token → copia;",
        h("span", {}, "incollalo qui: lo controllo con Discord e lo salvo in hush come ", h("code", {}, bot.env), ";"),
        "poi tocca «Invita nel server»."),
      tokenForm({ placeholder: "Token del bot Discord", path: `/api/agents/${agent.id}/bot`, ok: "Token salvato" }),
    ];
  }
  return panel({ icon: "hash", title: "Account Discord", hint: "Il suo utente su Discord.", actions }, body);
}

function telegramAccount(agent) {
  const bot = agent.telegramBot || { configured: false, env: "" };
  const actions = bot.user
    ? badge(bot.inChat ? "Nel gruppo" : "Fuori dal gruppo", bot.inChat ? "on" : "err", bot.inChat ? "check" : "alert")
    : badge("Bot principale", bot.state === "error" ? "err" : "", "send");
  let body;
  if (bot.user) {
    body = [
      h("p", { class: "lead" }, "Collegato come ", h("b", {}, raw(`@${bot.user.username}`)), ". ", bot.inChat ? "Scrive nel gruppo con il suo account." : "Non è ancora nel gruppo: finché non lo aggiungi scrive tramite il bot principale."),
      h("div", { class: "row" },
        bot.inChat ? null : btn("Aggiungi al gruppo", { icon: "plus", href: `https://t.me/${bot.user.username}?startgroup=cora`, target: "_blank", cls: "primary" }),
        btn("Apri su Telegram", { icon: "external", href: bot.link, target: "_blank" })),
      h("small", { class: "muted" }, "Il nome segue il pannello; la foto si cambia da BotFather con /setuserpic."),
    ];
  } else {
    body = [
      h("p", { class: "lead" }, bot.state === "error" ? tr("Il token salvato non funziona ({error}): incollane uno nuovo.", { error: bot.error }) : "Ora scrive tramite il bot principale, col suo nome in grassetto. Con un bot tutto suo scrive col suo account ed è menzionabile."),
      steps(
        h("span", {}, "apri ", h("a", { href: "https://t.me/BotFather", target: "_blank", rel: "noopener" }, "@BotFather"), ", scrivi /newbot e chiamalo ", h("b", {}, raw(agent.name)), ";"),
        "copia il token che ti dà;",
        h("span", {}, "incollalo qui: lo controllo con Telegram e lo salvo in hush come ", h("code", {}, bot.env), ";"),
        "poi tocca «Aggiungi al gruppo»."),
      tokenForm({ placeholder: "Token di BotFather (123456:ABC…)", path: `/api/agents/${agent.id}/telegram-bot`, ok: "Token salvato" }),
    ];
  }
  return panel({ icon: "send", title: "Account Telegram", hint: "Il suo bot su Telegram.", actions }, body);
}

function renderNew() {
  shell([pageHead("Nuovo agente", "Dagli un nome, un cervello e un carattere."), agentForm({ chattiness: 0.5, enabled: true, tools: true })], { title: "Nuovo agente", back: "#/agenti" });
}

async function renderAgent() {
  S.live = null;
  const [, id, tab = "profilo", sub] = route();
  const agent = S.data.agents.find((item) => item.id === id);
  if (!agent) {
    shell(panel({ icon: "alert", title: "Agente non trovato" }, btn("Torna agli agenti", { icon: "back", href: "#/agenti" })), { title: "Agente", back: "#/agenti" });
    return;
  }
  const routines = S.data.routines.filter((routine) => routine.agentId === agent.id);
  let body;
  if (tab === "memoria") body = await memoryTab(agent);
  else if (tab === "routine") body = routineTab(agent, routines);
  else if (tab === "desktop") body = await desktopTab(agent);
  else if (tab === "attivita") body = activityTab(agent);
  else if (tab === "chat") body = await chatPanel(`web-${agent.id}`, { placeholder: tr("Scrivi a {name}…", { name: agent.name }), hint: agent.enabled ? null : "È muto: accendilo per parlarci." });
  else if (tab === "ragionamento") body = sub ? await traceDetail(agent, sub) : await tracesTab(agent);
  else body = [S.data.transport === "telegram" ? telegramAccount(agent) : discordAccount(agent), agentForm(agent)];
  const now = route();
  if (now[0] !== "agent" || now[1] !== id || (now[2] || "profilo") !== tab) return;
  const toggle = btn(agent.enabled ? "In onda" : "Muto", { icon: "power", cls: `sm toggle${agent.enabled ? " on" : ""}`, title: agent.enabled ? "Spegni" : "Accendi", onclick: async () => {
    if (await guard(api(`/api/agents/${agent.id}`, { method: "PUT", body: { enabled: !agent.enabled } }), agent.enabled ? `${agent.name} è muto` : `${agent.name} è in onda`)) {
      await loadState();
      renderAgent();
    }
  } });
  const compact = tab === "chat";
  const [account, accountOn] = agentAccount(agent);
  shell([
    h("section", { class: `hero${compact ? " compact" : ""}`, vars: { "--ring": agent.color || "#f2a93b" } },
      avatar(agent, compact ? "" : "lg"),
      h("div", { class: "hero-text" },
        h("h1", {}, raw(agent.name)),
        h("div", { class: "badges" },
          badge(modelLabel(agent.model, { short: true }), "", "chip"),
          compact ? null : badge(agent.box?.running ? "Desktop acceso" : "Desktop spento", agent.box?.running ? "on" : "", "monitor"),
          compact || !agent.box?.outdated || !agent.box?.exists ? null : badge("Da aggiornare", "warn", "upgrade"),
          compact ? null : badge(account, accountOn, TRANSPORTS[S.data.transport].icon))),
      toggle),
    h("nav", { class: "tabs" }, TABS.map(([key, label, name]) => {
      const count = key === "memoria" ? agent.memoryCount : key === "routine" ? routines.length : null;
      return h("a", { href: `#/agent/${agent.id}/${key}`, class: key === tab ? "active" : "" }, icon(name), h("span", {}, label), count ? h("i", { class: "count" }, count) : null);
    })),
    body,
  ], { title: agent.name, back: sub ? `#/agent/${agent.id}/ragionamento` : "#/agenti", mode: compact ? "chat" : "" });
  document.querySelector(".tabs a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
}

async function memoryTab(agent) {
  const data = await guard(api(`/api/agents/${agent.id}/memories`));
  if (!data) return panel({ icon: "alert", title: "Memoria non disponibile" });
  const core = h("textarea", { class: "tall", placeholder: "Le note che ha sempre in testa: chi è, cosa gli importa, i rapporti con gli altri, cosa sta succedendo." }, data.core || "");
  const coreCount = h("span", { class: "label" }, `${(data.core || "").length}/4000`);
  core.addEventListener("input", () => { coreCount.textContent = `${core.value.length}/4000`; });
  const sleepButton = btn(data.sleeping ? "Dorme…" : "Consolida", { icon: "moon", cls: "sm", disabled: data.sleeping, onclick: async () => {
    sleepButton.disabled = true;
    sleepButton.lastChild.textContent = "Dorme…";
    await guard(api(`/api/agents/${agent.id}/sleep`, { method: "POST" }), "Consolidamento avviato");
  } });
  const corePanel = panel({ tag: "form", icon: "layers", title: "Scheda", hint: `${tr("Sempre a mente, in ogni messaggio.")} ${data.lastSleepAt ? tr("Ultimo sonno: {time}.", { time: fmtTime(data.lastSleepAt, true) }) : tr("Non ha ancora dormito.")}`, actions: sleepButton },
    core,
    h("div", { class: "row end" }, coreCount, h("span", { class: "spacer" }), btn("Salva scheda", { icon: "check", type: "submit", cls: "primary" })));
  corePanel.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await guard(api(`/api/agents/${agent.id}/core`, { method: "PUT", body: { text: core.value } }), "Scheda salvata")) renderAgent();
  });

  const input = h("textarea", { name: "text", placeholder: "Un fatto da ricordare. Es: «Sara odia le riunioni prima delle 10»." });
  const add = panel({ tag: "form", icon: "plus", title: "Nuovo ricordo", hint: "A ogni messaggio riaffiorano quelli pertinenti; quelli fissati ci sono sempre." },
    input,
    h("div", { class: "row" }, switchInput("shared", "Condiviso", false), switchInput("pinned", "Fissato", false), h("span", { class: "spacer" }), btn("Aggiungi", { icon: "plus", type: "submit", cls: "primary" })));
  add.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    const body = { text: input.value, shared: add.elements.shared.checked, pinned: add.elements.pinned.checked };
    if (await guard(api(`/api/agents/${agent.id}/memories`, { method: "POST", body }), "Ricordo aggiunto")) {
      await loadState();
      renderAgent();
    }
  });

  const all = [
    ...data.facts.map((memory) => ({ ...memory, scope: "private" })),
    ...data.shared.map((memory) => ({ ...memory, scope: "shared" })),
  ].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  const list = h("div", { class: "rows" });
  const search = h("input", { type: "search", placeholder: "Cerca nei ricordi…" });
  const draw = () => {
    const query = search.value.trim().toLowerCase();
    const shown = all.filter((memory) => !query || memory.text.toLowerCase().includes(query));
    list.replaceChildren(...(shown.length ? shown.map((memory) => memoryItem(agent, memory)) : [empty("book", query ? "Nessun ricordo trovato." : "Ancora nessun ricordo.")]));
  };
  search.addEventListener("input", draw);
  draw();
  const diary = data.diary.length
    ? h("div", { class: "rows" }, [...data.diary].reverse().map((entry) => h("div", { class: "row-item" },
      h("span", { class: "grow" }, h("span", { class: "row-meta" }, fmtTime(entry.createdAt, true)), h("span", { class: "row-text full" }, raw(entry.text))),
      h("span", { class: "row-actions" }, btn("", { icon: "trash", cls: "sm ghost danger", title: "Strappa la pagina", onclick: async () => {
        if (await guard(api(`/api/agents/${agent.id}/diary/${entry.id}`, { method: "DELETE" }), "Pagina strappata")) renderAgent();
      } })))))
    : empty("moon", "Il diario si scrive di notte, quando dorme.");
  return [
    corePanel,
    add,
    panel({ icon: "book", title: "Ricordi", hint: tr("{count} tra privati e condivisi.", { count: all.length }) }, h("label", { class: "search" }, icon("search"), search), list),
    panel({ icon: "moon", title: "Diario", hint: "Le ultime due pagine gli tornano in mente ogni giorno." }, diary),
  ];
}

function memoryItem(agent, memory) {
  const SOURCE = { agent: "scritto da lui", sleep: "dal sonno", manual: "manuale" };
  const text = h("span", { class: "row-text full" }, raw(memory.text));
  const update = async (body, ok) => {
    if (await guard(api(`/api/agents/${agent.id}/memories/${memory.id}`, { method: "PUT", body }), ok)) {
      await loadState();
      renderAgent();
    }
  };
  return h("div", { class: "row-item" },
    h("span", { class: "grow" },
      h("span", { class: "row-meta" },
        memory.pinned ? tag("fissato", "agent") : null,
        tag(memory.scope === "shared" ? "condiviso" : "privato", memory.scope === "shared" ? "ok" : ""),
        tag(SOURCE[memory.source] || memory.source),
        raw(`${memory.by && memory.scope === "shared" ? `${memory.by} · ` : ""}${fmtTime(memory.createdAt, true)}`)),
      text),
    h("span", { class: "row-actions" },
      btn("", { icon: "pin", cls: `sm ghost${memory.pinned ? " lit" : ""}`, title: memory.pinned ? "Sblocca" : "Fissa", onclick: () => update({ pinned: !memory.pinned }, memory.pinned ? "Sbloccato" : "Fissato") }),
      btn("", { icon: "share", cls: `sm ghost${memory.scope === "shared" ? " lit" : ""}`, title: memory.scope === "shared" ? "Rendi privato" : "Condividi con tutti", onclick: () => update({ shared: memory.scope !== "shared" }, memory.scope === "shared" ? "Ora è privato" : "Ora lo sanno tutti") }),
      btn("", { icon: "edit", cls: "sm ghost", title: "Modifica", onclick: () => {
        const area = h("textarea", {}, memory.text);
        text.replaceWith(h("span", { class: "edit-box" }, area, h("span", { class: "row end" }, btn("Salva", { icon: "check", cls: "sm primary", onclick: () => update({ text: area.value }, "Aggiornato") }))));
      } }),
      btn("", { icon: "trash", cls: "sm ghost danger", title: "Dimentica", onclick: async () => {
        if (await guard(api(`/api/agents/${agent.id}/memories/${memory.id}`, { method: "DELETE" }), "Dimenticato")) {
          await loadState();
          renderAgent();
        }
      } })));
}

function routineForm(agent, routine = {}) {
  const isNew = !routine.id;
  const schedule = h("input", { type: "text", name: "schedule", class: "mono", value: routine.schedule || "0 9 * * *", required: true, autocomplete: "off" });
  const preview = h("small", { class: "mono" });
  let timer;
  const updatePreview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const result = await api(`/api/cron/preview?expr=${encodeURIComponent(schedule.value)}`);
        preview.textContent = result.next.length ? tr("Prossime: {list}", { list: result.next.map((iso) => fmtTime(iso, true)).join(" · ") }) : tr("Mai nei prossimi 32 giorni");
      } catch (error) {
        preview.textContent = tr(error.message);
      }
    }, 250);
  };
  schedule.addEventListener("input", updatePreview);
  updatePreview();
  const channelSelect = h("select", { name: "channelId", required: true },
    h("option", { value: "" }, "Scegli dove pubblicare…"),
    S.data.channels.map((channel) => h("option", { value: channel.id, selected: channel.id === routine.channelId }, raw(channelChipLabel(channel)))));
  if (routine.channelId && !S.data.channels.some((channel) => channel.id === routine.channelId)) {
    channelSelect.append(h("option", { value: routine.channelId, selected: true }, tr("{channel} (non attivo)", { channel: channelName(routine.channelId) })));
  }
  const form = panel({ tag: "form", icon: isNew ? "plus" : "edit", title: isNew ? "Nuova routine" : tr("Modifica «{name}»", { name: routine.name }), hint: "Un compito che svolge da solo, col suo computer, e poi racconta." },
    h("div", { class: "grid2" },
      field("Nome", h("input", { type: "text", name: "name", value: routine.name || "", required: true, placeholder: "es. Rassegna stampa" })),
      field(S.data.transport === "telegram" ? "Chat" : "Canale", channelSelect),
      h("div", { class: "field full" }, h("span", { class: "label" }, "Quando"),
        h("div", { class: "chips" }, PRESETS.map(([label, expr]) => h("button", { type: "button", class: "chip", onclick: () => { schedule.value = expr; updatePreview(); } }, label))),
        schedule, preview,
        h("small", {}, "Formato cron: minuto ora giorno mese giorno-settimana (fuso Europe/Rome).")),
      field("Compito", h("textarea", { name: "prompt", class: "tall", required: true, placeholder: "Cosa deve fare, dove guardare, cosa riportare. Se non c'è niente da dire può restare in silenzio." }, routine.prompt || ""), null, "full"),
      h("div", { class: "field full" }, switchInput("enabled", "Attiva", routine.enabled ?? true))),
    h("div", { class: "row end" },
      isNew ? null : btn("Annulla", { icon: "close", href: `#/agent/${agent.id}/routine`, cls: "ghost" }),
      btn(isNew ? "Crea routine" : "Salva routine", { icon: "check", type: "submit", cls: "primary" })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const body = { name: data.get("name"), schedule: data.get("schedule"), channelId: data.get("channelId"), prompt: data.get("prompt"), enabled: form.elements.enabled.checked };
    const saved = await guard(isNew ? api(`/api/agents/${agent.id}/routines`, { method: "POST", body }) : api(`/api/routines/${routine.id}`, { method: "PUT", body }), isNew ? "Routine creata" : "Routine salvata");
    if (!saved) return;
    await loadState();
    location.hash = `#/agent/${agent.id}/routine`;
    renderAgent();
  });
  return form;
}

function routineTab(agent, routines) {
  const editing = new URLSearchParams(location.hash.split("?")[1] || "").get("edit");
  if (editing) {
    const routine = routines.find((item) => item.id === editing);
    if (routine) return routineForm(agent, routine);
  }
  const items = routines.map((routine) => {
    const status = routine.running ? tag("in corso", "agent")
      : routine.lastStatus === "error" ? tag("errore", "err")
      : routine.lastStatus ? tag(routine.lastStatus === "posted" ? "pubblicata" : "niente da dire", "ok") : null;
    return h("div", { class: `routine${routine.enabled ? "" : " paused"}` },
      h("div", { class: "routine-head" },
        h("span", { class: "panel-ico" }, icon("clock")),
        h("span", { class: "grow" },
          h("b", {}, raw(routine.name), routine.enabled ? "" : " · in pausa"),
          h("span", { class: "row-meta" }, h("code", {}, raw(routine.schedule)), "→", raw(channelName(routine.channelId)))),
        h("span", { class: "row-actions" },
          btn("", { icon: "play", cls: "sm primary", title: "Esegui ora", disabled: routine.running, onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}/run`, { method: "POST" }), "Routine avviata")) scheduleRefresh();
          } }),
          btn("", { icon: "edit", cls: "sm", title: "Modifica", href: `#/agent/${agent.id}/routine?edit=${routine.id}` }),
          btn("", { icon: routine.enabled ? "pause" : "play", cls: "sm ghost", title: routine.enabled ? "Metti in pausa" : "Riattiva", onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}`, { method: "PUT", body: { enabled: !routine.enabled } }))) { await loadState(); renderAgent(); }
          } }),
          btn("", { icon: "trash", cls: "sm ghost danger", title: "Elimina", onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}`, { method: "DELETE" }), "Routine eliminata")) { await loadState(); renderAgent(); }
          } }))),
      h("div", { class: "row-meta" }, status, routine.nextRunAt && routine.enabled ? tr("prossima {time}", { time: fmtTime(routine.nextRunAt, true) }) : "", routine.lastRunAt ? tr(" · ultima {time}", { time: fmtTime(routine.lastRunAt, true) }) : ""),
      h("details", {}, h("summary", {}, "Compito e ultimo risultato"), h("pre", {}, raw(routine.prompt)), routine.lastOutput ? h("pre", {}, raw(routine.lastOutput)) : null));
  });
  return [
    panel({ icon: "clock", title: "Routine", hint: "Compiti programmati che svolge da solo." }, items.length ? h("div", { class: "stack-sm" }, items) : empty("clock", "Nessuna routine. Creane una qui sotto.")),
    routineForm(agent),
  ];
}

async function desktopTab(agent) {
  const running = agent.box?.running;
  const outdated = agent.box?.outdated;
  const action = (name, label, iconName, cls = "sm") => btn(label, { icon: iconName, cls, title: label || ({ restart: "Riavvia", stop: "Spegni" })[name], onclick: async (event) => {
    event.currentTarget.disabled = true;
    const done = { start: "acceso", restart: "riavviato", stop: "spento", upgrade: "aggiornato" }[name];
    if (await guard(api(`/api/agents/${agent.id}/box/${name}`, { method: "POST" }), tr("Desktop {done}", { done: tr(done) }))) {
      await loadState();
      setTimeout(renderAgent, name === "stop" ? 0 : 2500);
    } else renderAgent();
  } });
  const viewer = `/box/${agent.id}/vnc.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=2000&path=box/${agent.id}/websockify`;
  const screen = h("div", { class: "screen" });
  if (running) screen.append(h("iframe", { src: viewer, title: tr("Desktop di {name}", { name: agent.name }), allow: "clipboard-read; clipboard-write" }));
  else screen.append(h("div", { class: "off" }, icon("monitor"), h("span", { class: "label" }, S.data.boxImage.ready ? "Desktop spento" : "Immagine del desktop non ancora pronta"), S.data.boxImage.ready ? action("start", "Accendi", "power", "primary") : null));
  const desktop = panel({ icon: "monitor", title: "Desktop", hint: "Lo stesso schermo che usa lui: puoi guardare e prendere il controllo.",
    actions: running ? [btn("", { icon: "maximize", href: viewer, target: "_blank", cls: "sm", title: "Schermo intero" }), action("restart", "", "refresh"), action("stop", "", "stop", "sm danger")] : null },
  outdated && agent.box?.exists ? h("div", { class: "banner" }, icon("upgrade"), h("span", { class: "grow" }, h("b", {}, "C'è una versione nuova del desktop. "), "Aggiornandolo si riavvia; la home, Tailscale e le chiavi restano."), action("upgrade", "Aggiorna", "upgrade", "sm primary")) : null,
  h("div", { class: "monitor-frame" }, screen));
  return [desktop, agent.box?.exists ? await accessPanel(agent) : null];
}

async function accessPanel(agent) {
  const data = await guard(api(`/api/agents/${agent.id}/box/access`));
  if (!data) return null;
  const tailscale = h("div", { class: "stack-sm" });
  const draw = (status) => {
    let body;
    if (status.state === "off") body = h("p", { class: "lead" }, "Accendi il desktop per collegarlo alla tailnet.");
    else if (status.state === "unavailable") body = h("p", { class: "lead" }, "Questo desktop non ha ancora Tailscale: aggiornalo.");
    else if (status.state === "Running") {
      body = [
        h("p", { class: "lead" }, "Sulla tailnet come ", h("b", {}, raw(status.host)), status.ips[0] ? raw(` (${status.ips[0]})`) : "", ". Entri con il tuo account Tailscale, senza chiavi:"),
        codeLine(`ssh agent@${status.host}`),
      ];
    } else if (status.authUrl) {
      body = [
        h("p", { class: "lead" }, "Autorizzalo con il tuo account Tailscale, poi torna qui."),
        h("div", { class: "row" },
          btn("Autorizza su Tailscale", { icon: "external", href: status.authUrl, target: "_blank", cls: "primary" }),
          btn("Fatto, controlla", { icon: "refresh", onclick: async () => draw((await guard(api(`/api/agents/${agent.id}/box/access`)))?.tailscale || status) })),
      ];
    } else {
      const connect = btn("Collega a Tailscale", { icon: "link", cls: "primary", onclick: async () => {
        connect.disabled = true;
        const next = await guard(api(`/api/agents/${agent.id}/box/tailscale`, { method: "POST" }));
        connect.disabled = false;
        if (next) draw(next);
      } });
      body = [h("p", { class: "lead" }, "Non è sulla tailnet. Collegalo: diventa un dispositivo suo, raggiungibile con SSH da ovunque tu abbia Tailscale."), h("div", { class: "row" }, connect)];
    }
    tailscale.replaceChildren(...[body].flat().filter(Boolean));
  };
  draw(data.tailscale);
  return panel({ icon: "terminal", title: "Accesso remoto", hint: "Entra nel suo computer con SSH, come utente agent." },
    h("h3", { class: "label" }, "Tailscale"),
    tailscale,
    h("h3", { class: "label" }, "Passando dalla macchina host"),
    data.ssh.ready
      ? [h("p", { class: "lead" }, "Da ogni computer che entra già nella macchina host (stesse chiavi, più quelle in Impostazioni):"), codeLine(data.ssh.command)]
      : h("p", { class: "lead" }, "Aggiorna il desktop per avere SSH."));
}

function activityTab(agent) {
  return panel({ icon: "pulse", title: "Attività", hint: "Tutto quello che ha fatto, in diretta.", cls: "teletype" }, feed(agent.id));
}

/* ---------- chat ---------- */
function stepLine(step) {
  if (step.type === "tool") return `⚙ ${step.name} ${argsSummary(step.args)}`;
  if (step.type === "thinking") return step.hidden ? tr("sta ragionando…") : step.text;
  return step.text || "";
}

function argsSummary(args) {
  const value = args && typeof args === "object" ? Object.values(args).find((item) => typeof item === "string") : "";
  return value ? value.replace(/\s+/g, " ").slice(0, 90) : "";
}

function chatFile(file) {
  const url = `/api/files/${file.id}`;
  if (/^image\//.test(file.type)) return h("a", { href: url, target: "_blank", rel: "noopener", class: "chat-file" }, h("img", { src: url, alt: file.name, loading: "lazy" }));
  return h("a", { href: url, class: "chat-file doc" }, icon("file"), raw(file.name));
}

/** Message text with its web links clickable; nothing else in it is interpreted. */
function linkedText(text) {
  const pattern = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"]+/g;
  const count = (value, char) => value.split(char).length - 1;
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    let url = match[2] || match[0];
    let end = match.index + match[0].length;
    if (!match[2]) {
      // Sentence punctuation after a bare link is not part of it; a closing bracket only when unbalanced.
      while (/[.,;:!?'»…]$/.test(url) || (url.endsWith(")") && count(url, ")") > count(url, "("))) {
        url = url.slice(0, -1);
        end -= 1;
      }
    }
    parts.push(raw(text.slice(last, match.index)), h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, raw(match[1] || url)));
    last = end;
  }
  parts.push(raw(text.slice(last)));
  return parts;
}

function chatMessage(item, answer) {
  const agent = item.agentId ? S.data.agents.find((entry) => entry.id === item.agentId) : null;
  const mine = item.kind === "owner";
  const text = item.file ? item.content.replace(/\s*\[file: [^\]]*\]$/, "") : item.content;
  const choices = item.request && answer
    ? h("div", { class: "choices-row" }, (item.request.choices.length ? item.request.choices : []).map((choice) => btn(raw(choice), { cls: "sm", onclick: () => answer(choice) })), h("span", { class: "label" }, item.request.choices.length ? "oppure scrivi" : "rispondi qui sotto"))
    : null;
  return h("div", { class: `msg ${mine ? "mine" : "agent"}${item.request ? " request" : ""}`, "data-id": item.id },
    agent ? avatar(agent, "sm") : null,
    h("div", { class: "bubble", vars: agent?.color ? { "--ring": agent.color } : null },
      h("div", { class: "meta" },
        h("b", {}, raw(item.authorName)),
        h("time", {}, fmtTime(item.at)),
        item.traceId && agent ? h("a", { class: "why", href: `#/agent/${agent.id}/ragionamento/${item.traceId}`, title: "Ragionamento" }, icon("bulb"), "perché") : null),
      item.request ? h("div", { class: "request-tag" }, icon("ask"), "Richiesta") : null,
      text ? h("div", { class: "text" }, linkedText(text)) : null,
      item.file ? chatFile(item.file) : null,
      choices));
}

async function chatPanel(room, { placeholder = "Scrivi…", hint = null } = {}) {
  const data = await guard(api(`/api/rooms/${room}/messages`));
  if (!data) return panel({ icon: "alert", title: "Chat non disponibile" });
  const seen = new Set();
  const log = h("div", { class: "chat-log", role: "log", "aria-live": "polite" });
  const working = h("div", { class: "chat-working" });
  const cards = new Map();
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const scroll = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  let answer = null;
  const add = (item, force = false) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    log.querySelector(".empty")?.remove();
    const stick = force || nearBottom();
    if (item.kind === "owner") log.querySelectorAll(".choices-row").forEach((row) => row.remove());
    log.append(chatMessage(item, (choice) => answer?.(choice)));
    if (stick) scroll();
  };
  const note = (trace) => {
    const agent = S.data.agents.find((entry) => entry.id === trace.agentId);
    const [label] = TRACE_STATUS[trace.status] || [trace.status];
    const stick = nearBottom();
    log.append(h("a", { class: `chat-note ${trace.status}`, href: `#/agent/${trace.agentId}/ragionamento/${trace.id}` },
      icon(trace.status === "pass" ? "next" : "alert"),
      h("span", {}, raw(`${agent?.name || "?"} ${trace.status === "pass" ? tr("passa") : `· ${tr(label)}${trace.error ? `: ${trace.error}` : ""}`}`)),
      h("b", {}, "perché ›")));
    if (stick) scroll();
  };
  const card = (trace) => {
    if (trace.kind !== "chat" || cards.has(trace.id)) return;
    const agent = S.data.agents.find((entry) => entry.id === trace.agentId);
    const line = h("span", { class: "line" }, "sta pensando…");
    const el = h("a", { class: "working", href: `#/agent/${trace.agentId}/ragionamento/${trace.id}` },
      agent ? avatar(agent, "sm") : null,
      h("span", { class: "grow" }, h("b", {}, raw(agent?.name || "?")), line),
      h("span", { class: "typing" }, h("i"), h("i"), h("i")));
    cards.set(trace.id, { el, line });
    working.append(el);
  };
  for (const item of data.messages) add(item);
  const lastOwner = data.messages.map((item) => item.kind).lastIndexOf("owner");
  data.messages.forEach((item, index) => {
    if (item.request && index < lastOwner) log.querySelector(`[data-id="${item.id}"] .choices-row`)?.remove();
  });
  if (!data.messages.length) log.append(empty("chat", "Ancora niente qui. Scrivi tu per primo."));
  for (const trace of data.running) card(trace);

  S.live = (entry) => {
    if (entry.type === "web-message" && entry.room === room) add(entry.item, entry.item.kind === "owner");
    if (entry.type !== "trace") return;
    if (entry.event === "start" && entry.trace.channelId === room) card(entry.trace);
    if (entry.event === "step" && cards.has(entry.traceId)) cards.get(entry.traceId).line.textContent = stepLine(entry.step).slice(0, 160);
    if (entry.event === "end" && cards.has(entry.trace.id)) {
      cards.get(entry.trace.id).el.remove();
      cards.delete(entry.trace.id);
      if (entry.trace.status !== "done" && entry.trace.kind === "chat") note(entry.trace);
    }
  };

  const input = h("textarea", { class: "chat-input", rows: 1, maxlength: 3000, placeholder, enterkeyhint: "send" });
  const send = btn("", { icon: "send", type: "submit", cls: "primary send", title: "Invia" });
  const form = h("form", { class: "chat-compose" }, input, send);
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  };
  const submit = async (preset) => {
    const text = (preset ?? input.value).trim();
    if (!text) return;
    send.disabled = true;
    const item = await guard(api(`/api/rooms/${room}/messages`, { method: "POST", body: { text } }));
    send.disabled = false;
    if (!item) return;
    if (preset === undefined) input.value = "";
    grow();
    add(item, true);
    if (preset === undefined) input.focus();
    if (S.data.requests?.some((request) => request.channelId === room)) guard(loadState()).then(drawRequests);
  };
  answer = (choice) => submit(choice);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !matchMedia("(pointer: coarse)").matches) {
      event.preventDefault();
      submit();
    }
  });
  scroll();
  return h("section", { class: "chat" },
    hint ? h("div", { class: "banner" }, icon("info"), h("span", {}, hint)) : null,
    log, working, form);
}

function renderSalotto() {
  S.live = null;
  const slot = h("div", { class: "chat-slot" }, h("section", { class: "chat" }, h("div", { class: "chat-log" }, empty("chat", "Apro il salotto…"))));
  shell([
    pageHead(h("span", {}, "Il ", h("em", {}, "salotto")), "Tutti gli agenti in onda: chi nomini risponde, gli altri intervengono secondo la loquacità."),
    requestsStrip(),
    slot,
  ], { title: "Salotto", mode: "chat" });
  chatPanel(SALOTTO, { placeholder: "Scrivi a tutti…" }).then((chat) => {
    if (route()[0] === "") slot.replaceChildren(chat);
  });
}

/* ---------- reasoning ---------- */
function traceWhere(trace) {
  if (trace.kind === "sleep") return "memoria";
  return trace.channelId ? channelName(trace.channelId) : "";
}

function duration(trace) {
  const end = trace.endedAt ? Date.parse(trace.endedAt) : Date.now();
  const seconds = Math.max(0, (end - Date.parse(trace.startedAt)) / 1000);
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

async function tracesTab(agent) {
  const list = (await guard(api(`/api/agents/${agent.id}/traces`))) || [];
  let pending = null;
  S.live = (entry) => {
    if (entry.type !== "trace" || entry.event === "step" || entry.trace.agentId !== agent.id) return;
    clearTimeout(pending);
    pending = setTimeout(() => { if (route()[2] === "ragionamento" && !route()[3]) renderAgent(); }, 1500);
  };
  const provider = (agent.model || S.data.settings.defaultModel).split("/")[0];
  return panel({ icon: "bulb", title: "Ragionamento", hint: provider === "claude" ? "Ogni turno, anche quando passa. Claude Code mostra i passi e gli strumenti, non il testo del ragionamento." : "Ogni turno, anche quando passa: cosa ha letto, cosa ha pensato, gli strumenti e la risposta." },
    list.length ? h("div", { class: "rows" }, list.map((trace) => traceRow(trace))) : empty("bulb", "Ancora nessun turno registrato."));
}

function stepEl(step, startedAt) {
  const at = h("span", { class: "at" }, `+${((step.at - startedAt) / 1000).toFixed(1)}s`);
  if (step.type === "tool") {
    return h("details", { class: `step tool${step.ok === false ? " failed" : ""}` },
      h("summary", {}, h("span", { class: "step-ico" }, icon("tool")), h("b", {}, raw(step.name)), h("span", { class: "args" }, raw(argsSummary(step.args))), h("span", { class: "ms" }, `${step.ms ?? "?"} ms${step.ok === false ? " ✗" : ""}`), at),
      h("div", { class: "label" }, "Argomenti"),
      h("pre", {}, raw(JSON.stringify(step.args, null, 2))),
      h("div", { class: "label" }, step.image ? "Risultato (più un'immagine)" : "Risultato"),
      h("pre", {}, raw(step.result || "")));
  }
  if (step.type === "thinking") {
    return h("div", { class: `step thinking${step.hidden ? " hidden" : ""}` },
      h("div", { class: "step-head" }, h("span", { class: "step-ico" }, icon("bulb")), h("b", {}, "Pensa"), at),
      h("div", { class: "body" }, step.hidden ? "Ha ragionato qui; Claude Code non ne mostra il testo." : raw(step.text)));
  }
  if (step.type === "text") return h("div", { class: "step text" }, h("div", { class: "step-head" }, h("span", { class: "step-ico" }, icon("edit")), h("b", {}, "Scrive"), at), h("div", { class: "body" }, raw(step.text)));
  return h("div", { class: "step note" }, h("div", { class: "step-head" }, h("span", { class: "step-ico" }, icon("info")), h("b", {}, "Nota"), at), h("div", { class: "body" }, raw(step.text || "")));
}

async function traceDetail(agent, traceId) {
  const trace = await guard(api(`/api/traces/${traceId}`));
  if (!trace) return panel({ icon: "alert", title: "Ragionamento non trovato" }, btn("Tutti i turni", { icon: "back", href: `#/agent/${agent.id}/ragionamento` }));
  const startedAt = Date.parse(trace.startedAt);
  const stepsLog = h("div", { class: "steps-log" });
  let lastHidden = false;
  const addStep = (step) => {
    if (step.type === "thinking" && step.hidden && lastHidden) return;
    lastHidden = step.type === "thinking" && Boolean(step.hidden);
    stepsLog.querySelector(".empty")?.remove();
    stepsLog.append(stepEl(step, startedAt));
  };
  trace.steps.forEach(addStep);
  if (!trace.steps.length) stepsLog.append(empty("info", trace.status === "running" ? "In attesa del primo passo…" : "Nessun passo intermedio: ha risposto direttamente."));
  if (trace.status === "running") {
    S.live = (entry) => {
      if (entry.type !== "trace") return;
      if (entry.event === "step" && entry.traceId === trace.id) addStep(entry.step);
      if (entry.event === "end" && entry.trace.id === trace.id) renderAgent();
    };
  }
  const [label, cls] = TRACE_STATUS[trace.status] || [trace.status, ""];
  const answer = trace.status === "error"
    ? h("p", { class: "err-text" }, raw(trace.error))
    : h("div", { class: "answer" }, trace.output ? raw(trace.output) : trace.status === "running" ? "…" : "(niente)");
  return [
    btn("Tutti i turni", { icon: "back", href: `#/agent/${agent.id}/ragionamento`, cls: "ghost sm back-link" }),
    panel({ icon: trace.kind === "sleep" ? "moon" : trace.kind === "routine" ? "clock" : "chat", title: `${tr(TRACE_KIND[trace.kind] || trace.kind)} · ${traceWhere(trace)}`, hint: tr("{time} · {duration} · {count} passi", { time: fmtTime(trace.startedAt, true), duration: duration(trace), count: trace.steps.length }),
      actions: h("span", { class: "badges" }, tag(label, cls), tag(modelLabel(trace.model, { short: true }))) },
      h("h3", { class: "label" }, "Passi"),
      stepsLog,
      h("h3", { class: "label" }, trace.status === "pass" ? "Risposta (ha deciso di passare)" : "Risposta"),
      answer),
    panel({ icon: "eye", title: "Cosa ha ricevuto", hint: "Il contesto del turno e le istruzioni di sistema." },
      h("details", { class: "raw" }, h("summary", {}, icon("chat"), h("span", {}, "Contesto del turno")), h("pre", {}, raw(trace.prompt))),
      h("details", { class: "raw" }, h("summary", {}, icon("shield"), h("span", {}, "Istruzioni di sistema")), h("pre", {}, raw(trace.system)))),
  ];
}

/* ---------- language ---------- */
function languagePanel() {
  return panel({ icon: "globe", title: "Lingua", hint: "Del pannello su questo dispositivo, e dei messaggi automatici degli agenti. Gli agenti rispondono nella lingua in cui scrivi." },
    h("div", { class: "choices" }, Object.entries(LANGS).map(([code, label]) => h("button", { type: "button", class: `choice${code === LANG ? " on" : ""}`, onclick: async () => {
      if (code === LANG) return;
      await guard(api("/api/settings", { method: "PUT", body: { language: code } }));
      setLanguage(code);
    } }, h("span", { class: "panel-ico" }, raw(code.toUpperCase())), h("span", { class: "grow" }, h("b", {}, raw(label))), icon(code === LANG ? "check" : "next", "chev")))));
}

/* ---------- notifications ---------- */
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlKey(base64) {
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker?.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

function notificationsPanel() {
  const body = h("div", { class: "stack-sm" }, h("p", { class: "lead" }, "Controllo…"));
  const draw = async () => {
    const push = S.data.push || {};
    let content;
    if (!push.enabled) content = h("p", { class: "lead" }, "Le notifiche non sono ancora configurate sul server.");
    else if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      content = h("p", { class: "lead" }, isIos() ? "Su iPhone: tocca Condividi → «Aggiungi alla schermata Home», poi apri Cora da lì e torna qui." : "Questo browser non supporta le notifiche push.");
    } else if (isIos() && !isInstalled()) {
      content = h("p", { class: "lead" }, "Su iPhone le notifiche funzionano solo dall'app: Condividi → «Aggiungi alla schermata Home», poi apri Cora da lì.");
    } else if (Notification.permission === "denied") {
      content = h("p", { class: "lead" }, "Le notifiche sono bloccate per Cora: riattivale dalle impostazioni del telefono o del browser.");
    } else {
      const subscription = await currentSubscription().catch(() => null);
      if (subscription) {
        content = [
          h("p", { class: "lead" }, "Attive su questo dispositivo", push.devices > 1 ? tr(" (e su altri {count})", { count: push.devices - 1 }) : "", "."),
          h("div", { class: "row" },
            btn("Prova", { icon: "bell", onclick: () => guard(api("/api/push/test", { method: "POST" }), "Notifica inviata") }),
            btn("Disattiva qui", { icon: "close", cls: "ghost", onclick: async () => {
              await guard(api("/api/push/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } }));
              await subscription.unsubscribe().catch(() => {});
              await loadState();
              draw();
            } })),
        ];
      } else {
        content = [
          h("p", { class: "lead" }, "Attivale su questo dispositivo: ti arrivano le richieste degli agenti, i loro avvisi e le risposte quando il pannello è chiuso."),
          h("div", { class: "row" }, btn("Attiva le notifiche", { icon: "bell", cls: "primary", onclick: () => enableNotifications().then(draw) })),
        ];
      }
    }
    body.replaceChildren(...[content].flat());
  };
  draw();
  return panel({ icon: "bell", title: "Notifiche", hint: "Gli agenti ti scrivono sul telefono quando serve te." }, body);
}

async function enableNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("permesso negato");
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(S.data.push.publicKey) });
    await api("/api/push/subscribe", { method: "POST", body: { subscription: subscription.toJSON(), device: navigator.userAgent } });
    await loadState();
    toast("Notifiche attive");
  } catch (error) {
    toast(tr("Notifiche: {error}", { error: tr(error.message) }), true);
  }
}

/* ---------- settings ---------- */
function transportChoice(kind) {
  const info = transportInfo(kind);
  const inUse = S.data.transport === kind;
  const ready = info.state === "missing-token" ? "senza token" : "pronto";
  const small = h("small", {}, inUse ? tr("in uso · {state}", { state: tr(STATE_LABEL[info.state] || info.state) }) : ready);
  const card = h("button", { type: "button", class: `choice${inUse ? " on" : ""}`, "aria-pressed": inUse ? "true" : "false" },
    h("span", { class: "panel-ico" }, icon(info.icon)),
    h("span", { class: "grow" }, h("b", {}, info.label), small),
    icon(inUse ? "check" : "next", "chev"));
  let armed = false;
  card.addEventListener("click", async () => {
    if (inUse) return;
    if (!armed) {
      armed = true;
      card.classList.add("armed");
      small.textContent = tr("tocca di nuovo: {transport} si spegne", { transport: TRANSPORTS[S.data.transport].label });
      setTimeout(() => {
        armed = false;
        card.classList.remove("armed");
        small.textContent = tr(ready);
      }, 4000);
      return;
    }
    if (await guard(api("/api/settings", { method: "PUT", body: { transport: kind } }), tr("Cora ora vive su {transport}", { transport: info.label }))) {
      await loadState();
      renderSettings();
    }
  });
  return card;
}

function renderSettings() {
  const settings = S.data.settings;
  const discord = S.data.discord;
  const telegram = S.data.telegram;
  const guilds = discord.guilds;
  const providers = h("div", { class: "badges" }, Object.entries(PROVIDERS).map(([key, label]) => {
    const on = S.data.providers?.[key];
    return h("span", { class: `badge${on ? " on" : ""}`, title: on ? "" : PROVIDER_HINTS[key] }, icon(on ? "check" : "close"), label);
  }));
  const listening = S.data.agents.find((agent) => agent.bot?.user && agent.bot.user.id === discord.user?.id);
  const discordPanel = panel({ icon: "hash", title: "Discord", hint: "Un bot ascolta i server accesi (gli altri vengono ignorati); ogni agente scrive col suo.", actions: S.data.transport === "discord" ? badge("In uso", "on", "radio") : null },
    discord.user
      ? h("p", { class: "lead" }, "Ascolta con ", h("b", {}, raw(discord.user.username)), listening ? " (il bot dell'agente)" : "", raw(` · ${tr(STATE_LABEL[discord.state] || discord.state)}`))
      : discord.state === "missing-token"
        ? [h("p", { class: "lead" }, "Nessun bot ascolta. Cora usa il bot di un agente che può leggere i messaggi:"),
          steps(h("span", {}, "apri ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "discord.com/developers"), " e scegli l'app di un agente (es. Primo);"), "sezione Bot → Privileged Gateway Intents → accendi «Message Content Intent» → Save;", "entro un minuto Cora lo usa per ascoltare.")]
        : h("p", { class: "lead" }, tr("Stato: {state}", { state: tr(STATE_LABEL[discord.state] || discord.state) }), discord.error ? raw(` (${discord.error})`) : ""),
    h("div", { class: "field" }, h("span", { class: "label" }, "Server"),
      guilds.length ? h("div", { class: "stack-sm" }, guilds.map((guild) => h("label", { class: "switch" },
        h("input", { type: "checkbox", name: "guild", value: guild.id, checked: settings.guildIds.includes(guild.id) }),
        h("span", { class: "rocker" }), h("span", { class: "switch-text" }, raw(guild.name), h("small", { class: "mono" }, raw(guild.id)))))) : h("small", {}, "Discord non è collegato adesso: i server compaiono quando lo è.")),
    field("Proprietari (ID utente Discord)", h("input", { type: "text", name: "ownerIds", class: "mono", value: settings.ownerIds.join(", "), autocomplete: "off" }), "Solo i proprietari possono far usare il computer agli agenti. Vuoto = tutti."));
  const chats = telegram.chats;
  const telegramPanel = panel({ icon: "send", title: "Telegram", hint: "Un bot principale ascolta le chat accese; ogni agente può avere anche un bot suo.", actions: S.data.transport === "telegram" ? badge("In uso", "on", "radio") : null },
    telegram.user
      ? h("p", { class: "lead" }, "Bot: ", h("b", {}, raw(`@${telegram.user.username}`)), raw(` · ${tr(STATE_LABEL[telegram.state] || telegram.state)}${telegram.error ? ` (${telegram.error})` : ""}`))
      : telegram.state === "idle" || telegram.state === "stopped"
        ? h("p", { class: "lead" }, "Il token c'è: il bot si collega quando Cora passa su Telegram.")
        : [
        h("p", { class: "lead" }, telegram.state === "error" ? tr("Il token non funziona: {error}.", { error: telegram.error }) : "Serve un bot che ascolti."),
        steps(
          h("span", {}, "apri ", h("a", { href: "https://t.me/BotFather", target: "_blank", rel: "noopener" }, "@BotFather"), " e scrivi /newbot (es. «Cora»);"),
          "sempre in BotFather: /setprivacy → il bot → Disable, così sente tutto il gruppo;",
          "incolla qui il token: lo controllo e lo salvo in hush;",
          "aggiungi il bot al gruppo e accendi la chat qui sotto."),
      ],
    tokenForm({ placeholder: telegram.user ? "Nuovo token (solo per cambiarlo)" : "Token di BotFather (123456:ABC…)", path: "/api/telegram/token", ok: "Bot Telegram collegato" }),
    h("div", { class: "field" }, h("span", { class: "label" }, "Chat"),
      chats.length ? h("div", { class: "stack-sm" }, chats.map((chat) => h("label", { class: "switch" },
        h("input", { type: "checkbox", name: "tgchat", value: chat.id, checked: settings.telegramChatIds.includes(chat.id) }),
        h("span", { class: "rocker" }),
        h("span", { class: "switch-text" }, raw(chat.title), h("small", {}, `${tr(chat.type === "private" ? "chat privata" : chat.type === "channel" ? "canale" : "gruppo")}${chat.member === false ? tr(" · il bot non c'è più") : ""}`))))) : h("small", {}, "Aggiungi il bot a un gruppo (o scrivigli in privato): la chat compare qui e la accendi.")),
    field("Proprietari (ID utente Telegram)", h("input", { type: "text", name: "telegramOwnerIds", class: "mono", value: settings.telegramOwnerIds.join(", "), autocomplete: "off" }), "Se è vuoto diventa proprietario chi ha creato il gruppo, o chi scrive al bot in privato."));

  const form = h("form", { class: "stack" },
    languagePanel(),
    notificationsPanel(),
    panel({ icon: "radio", title: "Dove vive Cora", hint: "Un canale alla volta: quando ne accendi uno, l'altro si spegne. Il salotto del pannello c'è sempre." },
      h("div", { class: "choices" }, transportChoice("discord"), transportChoice("telegram"))),
    h("div", { class: "split" }, discordPanel, telegramPanel),
    panel({ icon: "sliders", title: "Regia", hint: "Quanto possono parlarsi tra loro prima di fermarsi ad aspettare un umano." },
      h("div", { class: "grid3" },
        field("Messaggi tra agenti", h("input", { type: "number", name: "maxAgentTurns", min: 0, max: 40, value: settings.maxAgentTurns, inputmode: "numeric" }), "dopo ogni messaggio umano"),
        field("Risposte per giro", h("input", { type: "number", name: "maxRepliesPerRound", min: 1, max: 6, value: settings.maxRepliesPerRound, inputmode: "numeric" }), "agenti che parlano insieme"),
        field("Messaggi di contesto", h("input", { type: "number", name: "historySize", min: 5, max: 100, value: settings.historySize, inputmode: "numeric" }), "quanta chat rileggono"))),
    panel({ icon: "chip", title: "Cervelli e sonno", hint: "Il modello di chi non ne sceglie uno e l'ora in cui riordinano la memoria." },
      h("div", { class: "grid2" },
        field("Modello predefinito", modelPicker("defaultModel", settings.defaultModel, { allowDefault: false })),
        field("Ora del sonno", h("input", { type: "number", name: "sleepHour", min: 0, max: 23, value: settings.sleepHour, inputmode: "numeric" }), "consolidamento notturno della memoria"),
        h("div", { class: "field full" }, h("span", { class: "label" }, "Provider"), providers))),
    panel({ icon: "book", title: "Memoria condivisa", hint: "Cose che tutti gli agenti sanno: chi sei, i progetti, le regole della casa." },
      h("textarea", { name: "sharedMemory", class: "tall" }, settings.sharedMemory)),
    panel({ icon: "key", title: "Chiavi SSH", hint: "Chi entra nei desktop via SSH passando dalla macchina host. Valgono già le chiavi che entrano nella macchina host; qui aggiungi le altre, una per riga." },
      h("textarea", { name: "sshKeys", class: "mono", placeholder: "ssh-ed25519 AAAA… telefono" }, settings.sshKeys.join("\n"))),
    h("div", { class: "savebar" }, h("span", { class: "spacer" }), btn("Salva impostazioni", { icon: "check", type: "submit", cls: "primary" })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const ids = (name) => String(data.get(name) || "").split(/[\s,]+/).filter(Boolean);
    const body = {
      ownerIds: ids("ownerIds"),
      telegramChatIds: [...form.querySelectorAll("input[name=tgchat]:checked")].map((input) => input.value),
      telegramOwnerIds: ids("telegramOwnerIds"),
      maxAgentTurns: Number(data.get("maxAgentTurns")),
      maxRepliesPerRound: Number(data.get("maxRepliesPerRound")),
      historySize: Number(data.get("historySize")),
      defaultModel: pickedModel(data, "defaultModel"),
      sleepHour: Number(data.get("sleepHour")),
      sharedMemory: data.get("sharedMemory"),
      sshKeys: String(data.get("sshKeys") || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    };
    if (guilds.length) body.guildIds = [...form.querySelectorAll("input[name=guild]:checked")].map((input) => input.value);
    if (await guard(api("/api/settings", { method: "PUT", body }), "Impostazioni salvate")) {
      await loadState();
      renderSettings();
    }
  });
  shell([pageHead("Impostazioni", "Dove vive Cora e le regole del palco."), form], { title: "Impostazioni" });
}

/* ---------- login ---------- */
/** On usecora.space: sign in there and come back with a pass. Goes by itself, at most once every 30 seconds. */
function renderCloudLogin() {
  const refused = new URLSearchParams(location.search).get("signin") === "refused";
  const target = `${S.cloud.login}?next=${encodeURIComponent(`/${location.hash}`)}`;
  let last = 0;
  try { last = Number(sessionStorage.getItem("cora.cloudSignIn") || 0); } catch {}
  if (!refused && Date.now() - last > 30000) {
    try { sessionStorage.setItem("cora.cloudSignIn", String(Date.now())); } catch {}
    location.replace(target);
    return;
  }
  app.replaceChildren(h("div", { class: "login" },
    h("div", { class: "login-inner" },
      h("img", { class: "login-icon", src: "/assets/icon-192.png", alt: "" }),
      h("h1", {}, "Cora"),
      h("p", { class: "login-sub" }, "Computer-Operating Resident Agents"),
      h("div", { class: "login-card" },
        refused ? h("p", { class: "login-error", role: "alert" }, "L'accesso da usecora.space non è riuscito: riprova.") : null,
        btn("Entra con usecora.space", { icon: "next", cls: "primary", href: target })),
      h("p", { class: "login-foot" }, icon("shield"), "Accesso privato"))));
}

function renderLogin() {
  clearTimers();
  if (S.cloud) return renderCloudLogin();
  const password = h("input", { type: "password", id: "password", name: "password", autocomplete: "current-password", required: true, placeholder: "La password del pannello", enterkeyhint: "go" });
  const reveal = btn("", { icon: "eye", cls: "sm ghost", title: "Mostra la password", onclick: () => {
    password.type = password.type === "password" ? "text" : "password";
    reveal.classList.toggle("lit", password.type === "text");
  } });
  const error = h("p", { class: "login-error", role: "alert" });
  const enter = btn("Entra", { icon: "next", type: "submit", cls: "primary" });
  const form = h("form", { class: "login-card" },
    h("label", { class: "label", for: "password" }, "Password"),
    h("div", { class: "login-field" }, icon("key"), password, reveal),
    error,
    enter);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    enter.disabled = true;
    try {
      await api("/api/login", { method: "POST", body: { password: password.value } });
      boot();
    } catch (err) {
      error.textContent = err.message;
      enter.disabled = false;
      password.select();
    }
  });
  app.replaceChildren(h("div", { class: "login" },
    h("div", { class: "login-inner" },
      h("img", { class: "login-icon", src: "/assets/icon-192.png", alt: "" }),
      h("h1", {}, "Cora"),
      h("p", { class: "login-sub" }, "Computer-Operating Resident Agents"),
      form,
      h("p", { class: "login-foot" }, icon("shield"), "Accesso privato"),
      h("div", { class: "login-langs" }, Object.keys(LANGS).map((code) => h("button", { type: "button", class: code === LANG ? "on" : "", onclick: () => setLanguage(code) }, raw(code.toUpperCase())))))));
  if (!matchMedia("(pointer: coarse)").matches) password.focus();
}

/* ---------- boot ---------- */
async function render() {
  if (!S.data) return;
  const [page] = route();
  S.live = null;
  if (page === "agent") await renderAgent();
  else if (page === "banco") await renderDashboard();
  else if (page === "agenti") renderAgents();
  else if (page === "new") renderNew();
  else if (page === "settings") renderSettings();
  else renderSalotto();
}

document.documentElement.lang = LANG;
document.title = "Cora · Computer-Operating Resident Agents";

async function boot() {
  const me = await fetch("/api/me", { credentials: "same-origin" }).then((response) => response.json()).catch(() => ({}));
  S.cloud = me.cloud || null;
  if (!me.authed) return renderLogin();
  try {
    await loadState();
    S.activity = await api("/api/activity");
  } catch (error) {
    if (error.message === "login richiesto") return;
    app.replaceChildren(h("div", { class: "login" }, h("p", {}, `Errore: ${error.message}`)));
    return;
  }
  connectEvents();
  render();
  navigator.serviceWorker?.register("/sw.js").catch(() => {});
}

// A tapped notification opens the right chat in the running app.
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "open") location.hash = new URL(event.data.url).hash || "#/";
});

// Hidden pages drop their live stream: the server then knows nobody is watching and notifies the phone.
document.addEventListener("visibilitychange", async () => {
  if (!S.data) return;
  if (document.hidden) {
    S.events?.close();
    S.events = null;
    return;
  }
  connectEvents();
  await guard(loadState());
  if (!document.activeElement?.matches("input, textarea, select") && !document.querySelector(".chat-input")?.value) render();
});

// An app, not a page: no pinch or double-tap zoom.
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("touchmove", (event) => {
  if (event.scale !== undefined && event.scale !== 1) event.preventDefault();
}, { passive: false });
window.addEventListener("hashchange", () => render());
boot();
