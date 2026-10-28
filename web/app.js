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
// Who runs the loop is one choice; which model thinks is another. Cora's own harness
// drives Ollama and the routers; Claude Code, Codex and Hermes drive themselves.
const HARNESSES = {
  cora: { label: "Harness di Cora", hint: "Cora guida il modello e gli passa gli strumenti.", providers: ["ollama", "orcarouter"] },
  claude: { label: "Claude Code", hint: "Claude guida sé stesso con il tuo abbonamento.", providers: ["claude"] },
  codex: { label: "Codex", hint: "Codex guida sé stesso con il tuo abbonamento.", providers: ["codex"] },
  hermes: { label: "Hermes", hint: "Hermes guida sé stesso sui modelli del suo endpoint, di solito quelli di questa macchina.", providers: ["hermes"] },
};
const harnessOf = (model) => {
  const provider = String(model || "").split("/")[0];
  return Object.keys(HARNESSES).find((key) => HARNESSES[key].providers.includes(provider)) || "cora";
};

const PROVIDER_GROUPS = {
  "ollama-local": "Ollama su questa macchina",
  ollama: "Ollama Cloud",
};
/** What Settings → Collegamenti lists, one line per thing that can be connected. */
const CONNECTIONS = [
  ["ollamaLocal", "Ollama su questa macchina"],
  ["ollamaCloud", "Ollama Cloud"],
  ["orcarouter", "OrcaRouter"],
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["hermes", "Hermes Agent"],
];
const PROVIDER_HINTS = {
  claude: "Claude Code non trovato su questa macchina",
  codex: "Codex non trovato su questa macchina",
  ollama: "questa macchina non è collegata a Ollama Cloud, e manca CORA_OLLAMA_API_KEY in hush",
  ollamaLocal: "nessun Ollama in ascolto su questa macchina",
  ollamaCloud: "questa macchina non è collegata a Ollama Cloud, e manca CORA_OLLAMA_API_KEY in hush",
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
  ["cervello", "Cervello", "chip"],
  ["chat", "Chat", "chat"],
  ["memoria", "Memoria", "book"],
  ["routine", "Routine e reminder", "clock"],
  ["desktop", "Desktop", "monitor"],
  ["ragionamento", "Ragionamento", "bulb"],
  ["attivita", "Attività", "pulse"],
];
const SALOTTO = "web";
const TRACE_KIND = { chat: "conversazione", routine: "routine", reminder: "reminder", verification: "verifica", sleep: "sonno" };
const TRACE_STATUS = { running: ["in corso", "agent"], done: ["ha risposto", "ok"], pass: ["passa", ""], error: ["errore", "err"], interrupted: ["interrotto", "err"], stopped: ["fermato", ""] };
const TRANSPORTS = {
  discord: { label: "Discord", icon: "hash" },
  telegram: { label: "Telegram", icon: "send" },
  slack: { label: "Slack", icon: "slack" },
};
const STATE_LABEL = {
  ready: "in onda", connecting: "si collega…", reconnecting: "si ricollega…", idle: "pronto", stopped: "spento",
  "missing-token": "senza token", error: "errore",
};

const ICONS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3.5" height="6" rx="1"/><rect x="10.2" y="7.5" width="3.5" height="10.5" rx="1"/><rect x="15.4" y="4" width="3.5" height="14" rx="1"/>',
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
  slack: '<path d="M3.5 9.8h6.3"/><path d="M14.2 3.5v6.3"/><path d="M20.5 14.2h-6.3"/><path d="M9.8 20.5v-6.3"/>',
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

function skeletonLine(cls = "") {
  return h("span", { class: `skeleton ${cls}`, "aria-hidden": "true" });
}

function skeleton(kind = "rows", count = 3) {
  const content = kind === "heat"
    ? [h("div", { class: "heat-head" }, skeletonLine("sk-label"), skeletonLine("sk-total")),
      skeletonLine("sk-heat"), skeletonLine("sk-caption")]
    : Array.from({ length: count }, (_, index) => kind === "chat"
      ? h("div", { class: `sk-message${index % 2 ? " owner" : ""}` }, skeletonLine("sk-label"), skeletonLine("sk-bubble"))
      : h("div", { class: "sk-row" }, skeletonLine("sk-avatar"), h("div", { class: "grow stack-sm" }, skeletonLine("sk-label"), skeletonLine("sk-caption"))));
  const loading = h("div", { class: `loading-skeleton sk-${kind}`, role: "status", "aria-label": "Caricamento…", "aria-busy": "true" }, content);
  if (kind !== "chat") return loading;
  return h("section", { class: "chat" }, h("div", { class: "chat-log" }, loading), skeletonLine("sk-compose"));
}

/* ---------- api ---------- */
async function api(path, { method = "GET", body } = {}) {
  const headers = { "X-Cora": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  if (response.status === 401 && path !== "/api/login") {
    if (!S.revoked) renderLogin();
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
  S.heatObserver?.disconnect();
  S.heatObserver = null;
  S.settingsObserver?.disconnect();
  S.settingsObserver = null;
}

function revealSelection(container) {
  if (!container.isConnected || container.scrollWidth <= container.clientWidth) return;
  const selected = container.querySelector(".active");
  if (!selected) return;
  const item = selected.getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right + 8;
  else if (item.left < bounds.left) container.scrollLeft += item.left - bounds.left - 8;
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
  if (id === SALOTTO) return tr("salotto");
  if (/^web-/.test(id)) return tr("chat con {name}", { name: S.data?.agents.find((agent) => agent.id === id.slice(4))?.name || "?" });
  if (/^tg:/.test(id)) return S.data?.telegram.chats.find((chat) => chat.id === id.slice(3))?.title || "chat Telegram";
  if (/^sl:/.test(id)) {
    const [channelId, threadTs] = id.slice(3).split(":");
    const name = S.data?.slack?.channels.find((channel) => channel.id === channelId)?.name || channelId;
    return threadTs ? tr("thread in #{name}", { name }) : `#${name}`;
  }
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
  const where = provider === "ollama" && known ? tr(known.local ? "Ollama locale" : "Ollama Cloud") : names[provider] || provider;
  return `${where} · ${known?.label || model.split("/").slice(1).join("/")}`;
}

function transportInfo(kind = S.data.transport) {
  const status = (kind === "telegram" ? S.data.telegram : kind === "slack" ? S.data.slack : S.data.discord) || { state: "missing-token", error: "", user: null };
  let where;
  if (kind === "slack") {
    const names = S.data.settings.slackChannelIds.map((id) => S.data.slack?.channels.find((channel) => channel.id === id)?.name || id);
    where = names.length ? names.map((name) => `#${name}`).join(", ") : "nessun canale acceso";
  } else if (kind === "telegram") {
    const chats = S.data.settings.telegramChatIds.map((id) => S.data.telegram.chats.find((chat) => chat.id === id)?.title || id);
    where = chats.length ? chats.join(", ") : "nessuna chat accesa";
  } else {
    const guilds = S.data.discord.guilds.filter((guild) => S.data.settings.guildIds.includes(guild.id)).map((guild) => guild.name);
    where = guilds.length ? guilds.join(", ") : "nessun server acceso";
  }
  return { kind, ...TRANSPORTS[kind], state: status.state, error: status.error, user: status.user, team: status.team, where };
}

function shade(hex) {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((value >> 16) & 255) * 0.55)}, ${Math.round(((value >> 8) & 255) * 0.55)}, ${Math.round((value & 255) * 0.55)})`;
}

/* ---------- data and live events ---------- */
async function loadState() {
  const data = await api("/api/state");
  if (S.revoked) return null;
  S.data = data;
  updateLamp();
  return S.data;
}

function scheduleRefresh() {
  clearTimeout(S.refreshTimer);
  S.refreshTimer = setTimeout(async () => {
    await guard(loadState());
    S.taskRefresh?.();
    if (route()[0] === "banco" && document.querySelector(".agent-grid")) renderDashboard();
  }, 900);
}

function connectEvents() {
  if (S.events) return;
  S.events = new EventSource("/api/events");
  S.events.onmessage = (event) => {
    let entry;
    try { entry = JSON.parse(event.data); } catch { return; }
    if (entry.type === "access-revoked") {
      S.revoked = true;
      clearTimeout(S.refreshTimer);
      clearTimers();
      S.live = null;
      S.events?.close();
      S.events = null;
      S.data = null;
      app.replaceChildren(h("div", { class: "login" }, h("div", { class: "login-inner" },
        h("span", { class: "panel-ico" }, icon("shield")), h("h1", {}, "Accesso revocato"),
        h("p", { class: "login-sub" }, "L'owner ha modificato i tuoi permessi. Contattalo per accedere di nuovo."),
        btn("Usa un altro account", { icon: "logout", cls: "primary", href: S.cloud?.logout || "/" }))));
      return;
    }
    if (entry.type === "ollama-pull") {
      S.onPull?.(entry);
      return;
    }
    if (entry.type === "subscriptions") return;
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
  const parts = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  if (!parts[0]) parts[0] = "agenti";
  return parts;
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
    el.lastChild.textContent = info.state === "ready" ? tr("In onda") : tr(STATE_LABEL[info.state] || info.state);
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
    ["salotto", "Salotto", "chat", section === "salotto"],
    ["banco", "Banco", "grid", section === "banco"],
    ["contesto", "Contesto", "book", section === "contesto"],
    ["settings", "Impostazioni", "sliders", section === "settings"],
  ];
  const info = S.data ? transportInfo() : { icon: "radio", label: "Cora", where: tr("Caricamento…") };
  app.replaceChildren(h("div", { class: `app${mode ? ` mode-${mode}` : ""}` },
    h("aside", { class: "sidebar" },
      h("a", { class: "brand", href: "#/" }, h("img", { src: "/assets/icon-192.png", alt: "" }), h("span", {}, h("b", {}, "Cora"), h("small", {}, "agenti residenti"))),
      h("a", { class: "onair-card", href: "#/settings" },
        h("span", { class: "panel-ico" }, icon(info.icon)),
        h("span", { class: "grow" }, h("b", {}, info.label), h("small", {}, info.where)),
        lamp()),
      h("nav", { class: "side-nav" }, nav.map(([key, label, name, active]) => h("a", { href: `#/${key}`, class: active ? "active" : "" }, icon(name), h("span", {}, label)))),
      h("div", { class: "side-agents" },
        h("span", { class: "label" }, "Agenti"),
        S.data ? S.data.agents.map((agent) => h("a", { href: `#/agent/${agent.id}/chat`, class: section === "agent" && current === agent.id ? "active" : "" }, avatar(agent, "xs"), h("span", { class: "grow" }, raw(agent.name)), agentDot(agent))) : skeleton("rows"),
        h("a", { href: "#/new", class: section === "new" ? "active" : "" }, h("span", { class: "avatar xs add" }, icon("plus")), h("span", { class: "grow" }, "Nuovo agente"))),
      S.data?.currentUser ? h("a", { class: "side-identity", href: "#/settings/accesso" }, icon("user"),
        h("span", { class: "grow" }, h("b", {}, raw(S.data.currentUser.name || S.data.currentUser.email || "Owner")),
          h("small", {}, raw(S.data.currentUser.email || tr("Owner"))))) : null,
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
      return h("a", { class: "request-card", href: request.channelId === "web" ? "#/salotto" : `#/agent/${request.agentId}/chat` },
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
  if (info.kind === "slack" && info.state !== "missing-token" && !S.data.settings.slackChannelIds.length) {
    out.push(h("a", { class: "banner", href: "#/settings" }, icon("info"), h("span", {}, h("b", {}, "Nessun canale Slack acceso. "), "Invita le app nei canali e accendili nelle impostazioni.")));
  }
  if (info.kind === "telegram" && info.state !== "missing-token" && !S.data.settings.telegramChatIds.length) {
    out.push(h("a", { class: "banner", href: "#/settings" }, icon("info"), h("span", {}, h("b", {}, "Nessuna chat Telegram accesa. "), "Aggiungi il bot a un gruppo e accendi la chat nelle impostazioni.")));
  }
  if (!S.data.boxImage.ready) out.push(h("div", { class: "banner" }, icon("monitor"), h("span", {}, h("b", {}, "Immagine desktop mancante. "), tr("Va costruita {image} su questa macchina.", { image: S.data.boxImage.name }))));
  const missing = CONNECTIONS.filter(([key]) => !S.data.providers?.[key]).map(([, label]) => tr(label));
  if (missing.length) out.push(h("div", { class: "banner" }, icon("chip"), h("span", {}, h("b", {}, "Provider non disponibili: "), `${missing.join(", ")}.`)));
  return out.length ? h("div", { class: "banners" }, out) : null;
}

function statCard({ icon: name, value, label, sub, href }) {
  return h(href ? "a" : "div", { class: "stat", href },
    h("span", { class: "panel-ico" }, icon(name)),
    h("span", { class: "stat-text" }, h("b", {}, value), h("span", { class: "label" }, label), sub ? h("small", {}, sub) : null));
}

function agentAccount(agent) {
  if (S.data.transport === "slack") return agent.slackBot?.user ? ["App sua", "on"] : ["App principale", ""];
  if (S.data.transport === "telegram") return agent.telegramBot?.user ? ["Bot suo", "on"] : ["Bot principale", ""];
  return agent.bot?.user ? ["Bot suo", "on"] : ["Webhook", ""];
}

function agentCard(agent, index) {
  const running = agent.box?.running;
  const monitor = h("a", { class: "monitor", href: `#/agent/${agent.id}/desktop`, "aria-label": tr("Desktop di {name}", { name: agent.name }) });
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
    h("div", { class: "meter", title: tr("Loquacità {value}", { value: pct }) }, h("span", { class: "label" }, "Loquacità"), h("span", { class: "track" }, h("span", { class: "fill", vars: { width: `${pct}%` } })), h("span", { class: "label" }, pct)),
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
  const recentSlot = h("div", {}, skeleton());
  const who = info.user ? (info.kind === "telegram" ? `@${info.user.username}` : info.user.username) : "";
  shell([
    pageHead(h("span", {}, "Co", h("em", {}, "ra")), tr("Vive su {transport}: {where}.", { transport: info.label, where: tr(info.where) }), [btn("Archivio", { icon: "book", href: "#/archivio" }), btn("Salotto", { icon: "chat", href: "#/salotto" }), btn("Nuovo agente", { icon: "plus", href: "#/new", cls: "primary" })]),
    banners(),
    requestsStrip(),
    h("div", { class: "stats" },
      statCard({ icon: info.icon, value: info.label, label: STATE_LABEL[info.state] || info.state, sub: who ? tr("come {who}", { who }) : "", href: "#/settings" }),
      statCard({ icon: "radio", value: `${agents.filter((agent) => agent.enabled).length}/${agents.length}`, label: "agenti in onda", href: "#/agenti" }),
      statCard({ icon: "monitor", value: desktops, label: "desktop accesi" }),
      statCard({ icon: "clock", value: active.length, label: "attività programmate", sub: next ? tr("prossima {time} · {name}", { time: fmtTime(next.nextRunAt), name: agents.find((agent) => agent.id === next.agentId)?.name || "" }) : "" })),
    panel({ icon: "users", title: "Agenti", hint: "Ognuno con il suo cervello, la sua memoria e il suo computer.", actions: btn("", { icon: "plus", href: "#/new", title: "Nuovo agente", cls: "sm" }) },
      agents.length ? h("div", { class: "agent-grid" }, agents.map(agentCard)) : empty("users", "Ancora nessun agente.", btn("Crea il primo", { icon: "plus", href: "#/new", cls: "primary" }))),
    h("div", { class: "split" },
      panel({ icon: "pulse", title: "Telescrivente", hint: "Tutto quello che succede, in diretta.", cls: "teletype" }, feed()),
      panel({ icon: "bulb", title: "Ultimi ragionamenti", hint: "Cosa hanno pensato e fatto, turno per turno." },
        recentSlot)),
  ], { title: "Banco" });
  S.timers.push(setInterval(() => {
    for (const img of document.querySelectorAll(".agent-card .monitor img")) img.src = img.src.replace(/t=\d+/, `t=${Date.now()}`);
  }, 20000));
  S.timers.push(setInterval(() => scheduleRefresh(), 30000));
  const recent = (await guard(api("/api/traces?limit=8"))) || [];
  if (recentSlot.isConnected) recentSlot.replaceChildren(recent.length ? h("div", { class: "rows" }, recent.map((trace) => traceRow(trace, { withAgent: true }))) : empty("bulb", "Nessun turno ancora."));
}

/* ---------- token heatmap ---------- */
const MONTH_FORMAT = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" });
const MONTHS = Array.from({ length: 12 }, (_, month) => MONTH_FORMAT.format(new Date(Date.UTC(2020, month, 1))).replace(/\.$/, ""));
const TOKEN_FORMAT = [0, 1].map((digits) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));

function shortTokens(n) {
  if (n >= 1e9) return `${TOKEN_FORMAT[1].format(n / 1e9)}B`;
  if (n >= 1e6) return `${TOKEN_FORMAT[1].format(n / 1e6)}M`;
  if (n >= 1e3) return `${TOKEN_FORMAT[n >= 1e4 ? 0 : 1].format(n / 1e3)}k`;
  return String(n);
}

function tokenTotal(count) {
  return count === 1 ? "1 token" : tr("{count} token", { count: shortTokens(count) });
}

/** Only recorded history: no empty year before the first use. */
function heatDays(today, firstDay) {
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(`${firstDay}T12:00:00Z`);
  const days = [];
  for (let at = new Date(start); at <= end; at.setUTCDate(at.getUTCDate() + 1)) {
    days.push({ key: at.toISOString().slice(0, 10), date: new Date(at) });
  }
  return days;
}

/**
 * Recorded days, a square each, darker to brighter with what was spent. The
 * scale is relative to the busiest day: providers count tokens so differently
 * that an absolute scale would say nothing.
 */
function heatmap(byDay, { today, label = "" } = {}) {
  const firstDay = [...byDay.keys()].filter((day) => day <= today && byDay.get(day)?.tokens > 0).sort()[0];
  if (!firstDay) return empty("chart", "Ancora nessun consumo.");
  const days = heatDays(today, firstDay);
  const peak = Math.max(1, ...days.map((day) => byDay.get(day.key)?.tokens || 0));
  const readout = h("p", { class: "heat-readout" }, label || "\u00a0");
  const tell = (text) => { readout.textContent = text || label || "\u00a0"; };
  const offset = (days[0].date.getUTCDay() + 6) % 7;
  const columns = Math.ceil((days.length + offset) / 7);
  const months = h("div", { class: "heat-months", vars: { "--weeks": String(columns) } });
  const grid = h("div", { class: "heat-grid", vars: { "--weeks": String(columns), "--rows": String(Math.min(7, days.length + offset)) } });
  for (let index = 0; index < offset; index += 1) grid.append(h("i", { class: "heat-cell blank", "aria-hidden": "true" }));
  let lastMonth = -1;
  let labelled = -9;
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    if (index === 0 || (index + offset) % 7 === 0) {
      const column = Math.floor((index + offset) / 7);
      const month = day.date.getUTCMonth();
      // A label needs room: two months whose columns are close would print over each other.
      const show = month !== lastMonth && column - labelled >= 3;
      if (show) labelled = column;
      months.append(h("span", { class: "heat-month" }, show ? MONTHS[month] : ""));
      lastMonth = month;
    }
    const spent = byDay.get(day.key);
    const tokens = spent?.tokens || 0;
    // Five steps, so a quiet day still shows against an empty one.
    const level = !tokens ? 0 : Math.min(4, 1 + Math.floor((tokens / peak) * 3.999));
    const when = `${day.date.getUTCDate()} ${MONTHS[day.date.getUTCMonth()]}`;
    const text = tokens
      ? `${when} · ${tokenTotal(tokens)} · ${spent.turns} ${tr(spent.turns === 1 ? "turno" : "turni")}`
      : `${when} · ${tr("niente")}`;
    grid.append(h("i", {
      class: `heat-cell l${level}`, title: text, "data-day": day.key,
      onpointerenter: () => tell(text),
      onclick: () => tell(text),
    }));
  }
  const scroll = h("div", { class: "heat-scroll" }, h("div", { class: "heat-plot" }, months, grid));
  const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const range = firstDay === today ? dateFormat.format(days[0].date) : `${dateFormat.format(days[0].date)} – ${dateFormat.format(days.at(-1).date)}`;
  return h("div", { class: "heat" }, h("p", { class: "heat-range" }, range), scroll, readout);
}

/** The scale, said once for the whole panel instead of under every agent. */
function heatLegend() {
  return h("span", { class: "heat-legend" }, h("small", {}, tr("meno")),
    ...[0, 1, 2, 3, 4].map((level) => h("i", { class: `heat-cell l${level}` })), h("small", {}, tr("pi\u00f9")));
}

/** Daily totals: one map for everyone, one per agent. */
function foldUsage(rows) {
  const all = new Map();
  const byAgent = new Map();
  for (const row of rows || []) {
    const tokens = (row.tokensIn || 0) + (row.tokensOut || 0);
    const total = all.get(row.day) || { tokens: 0, turns: 0 };
    total.tokens += tokens;
    total.turns += row.turns || 0;
    all.set(row.day, total);
    const mine = byAgent.get(row.agentId) || new Map();
    mine.set(row.day, { tokens, turns: row.turns || 0 });
    byAgent.set(row.agentId, mine);
  }
  return { all, byAgent };
}

function usagePanels(agents) {
  const global = h("div", { class: "heat-wrap" }, skeleton("heat"));
  const individual = h("div", { class: "heat-wrap" }, agents.map(() => skeleton("heat")));
  if (!agents.length) individual.append(empty("users", "Ancora nessun agente."));
  api("/api/usage").then((data) => {
    if (!global.isConnected) return;
    const { all, byAgent } = foldUsage(data.usage);
    const spent = [...all.values()].reduce((sum, day) => sum + day.tokens, 0);
    global.replaceChildren(
      h("div", { class: "heat-block" },
        h("div", { class: "heat-head" }, h("b", {}, tr("Tutti insieme")), h("span", { class: "heat-total" }, tokenTotal(spent))),
        heatmap(all, { today: data.today, label: tr("Un quadrato per giorno: tocca per vedere quanto.") })));
    if (agents.length) individual.replaceChildren(...agents.map((agent) => {
      const mine = byAgent.get(agent.id) || new Map();
      const total = [...mine.values()].reduce((sum, day) => sum + day.tokens, 0);
      return h("div", { class: "heat-block" },
        h("div", { class: "heat-head" }, avatar(agent), h("b", {}, raw(agent.name)), h("span", { class: "heat-total" }, tokenTotal(total))),
        heatmap(mine, { today: data.today, label: modelLabel(agent.model, { short: true }) }));
    }));
    const align = (chart) => { if (chart.isConnected) chart.scrollLeft = chart.scrollWidth; };
    if (typeof ResizeObserver !== "undefined") S.heatObserver = new ResizeObserver((entries) => entries.forEach(({ target }) => align(target)));
    for (const body of [global, individual]) for (const chart of body.querySelectorAll(".heat-scroll")) {
      align(chart);
      S.heatObserver?.observe(chart);
    }
  }).catch(() => {
    for (const body of [global, individual]) body.replaceChildren(h("p", { class: "muted" }, "Consumi non disponibili."));
  });
  return { global, individual };
}

function renderAgents() {
  const agents = S.data.agents;
  const usage = usagePanels(agents);
  shell([
    pageHead("Agenti", tr("{on} in onda su {total}.", { on: agents.filter((agent) => agent.enabled).length, total: agents.length }), [btn("Nuovo agente", { icon: "plus", href: "#/new", cls: "primary" })]),
    requestsStrip(),
    panel({ icon: "chart", title: "Consumi globali", hint: "Tutti gli agenti, giorno per giorno.", actions: heatLegend() }, usage.global),
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
    panel({ icon: "chart", title: "Consumi per agente", hint: "Quanti token spende ognuno, giorno per giorno.", actions: heatLegend() }, usage.individual),
  ], { title: "Agenti" });
}

/* ---------- agent ---------- */
const gbFromBytes = (value) => Math.round((Number(value) || 0) / 1e8) / 10;
const gbFromMib = (value) => Math.round((Number(value) || 0) / 102.4) / 10;

/** How much of a card a model needs: its weights plus room for the conversation. */
const VRAM_NEEDED = (size) => Number(size || 0) * 1.2;

// Under this a model has no weights here: an older Ollama lists the cloud ones it
// proxies without saying so, and promising they fit would be a lie.
const WEIGHTS_AT_LEAST = 100_000_000;

function fitOf(model, card, reclaimable = 0) {
  if (!card || !card.memoryTotal || !model.size || model.size < WEIGHTS_AT_LEAST) return null;
  const freeMib = card.memoryTotal - card.memoryUsed + reclaimable / 1_048_576;
  const neededMib = VRAM_NEEDED(model.size) / 1_048_576;
  if (neededMib <= freeMib) return { kind: "on", text: "entra" };
  if (neededMib <= card.memoryTotal) return { kind: "warn", text: "stretta: libera la scheda" };
  return { kind: "err", text: "non entra: girerebbe sul processore" };
}

/**
 * What the card really took of a model that is loaded now: Ollama leaves on the
 * processor whatever did not fit, and even a tenth left behind costs most of the
 * speed, so anything short of all of it is a warning.
 */
function residencyOf(loaded) {
  if (!loaded.size) return null;
  const share = Math.round((loaded.vram / loaded.size) * 100);
  if (share >= 99) return { kind: "on", text: tr("acceso, tutto sulla scheda") };
  return { kind: "warn", text: tr("acceso, {share}% sulla scheda: il resto gira sul processore", { share }) };
}

/** Where a model runs. The two places are a real difference, not a label. */
const PLACES = {
  local: ["Su questa macchina", "I pesi stanno qui: niente esce, e la scheda decide la velocità."],
  cloud: ["Nel cloud", "Il modello gira altrove, con l'account o la chiave che hai collegato."],
};

/** The providers a harness can drive, reduced to the ones this instance actually has. */
const harnessProviders = (harness) => (HARNESSES[harness]?.providers || []).filter((provider) => S.data.providers?.[provider]);

/** A harness can think here when at least one of the things it drives is here. */
const harnessReady = (harness) => harnessProviders(harness).length > 0;

/** In one line, what to do so a harness can run here. */
const HARNESS_NEEDS = {
  claude: "Claude Code non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  codex: "Codex non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  hermes: "Hermes non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  ollama: "Nessun Ollama su questa macchina e nessuna chiave Ollama Cloud.",
  orcarouter: "Nessuna chiave OrcaRouter.",
};

/**
 * What a harness that cannot think here is missing. Only asked when nothing it drives
 * is available: a missing router is not a reason to call Cora's harness broken.
 */
const harnessMissing = (harness) => (harnessReady(harness) ? [] : (HARNESSES[harness]?.providers || [])
  .map((provider) => tr(HARNESS_NEEDS[provider] || PROVIDER_HINTS[provider] || provider)));

/** Why a model id that nothing on this machine lists cannot be used. */
const MISSING_MODEL = "non è tra i modelli di questa macchina";

/** The harnesses that run on someone's subscription: the account is part of the choice. */
const SUBSCRIPTION_HARNESSES = ["claude", "codex"];

const modelsOf = (harness, place) => {
  const providers = harnessProviders(harness);
  return S.data.models.filter((model) => providers.includes(model.provider) && Boolean(model.local) === (place === "local"));
};

const placesOf = (harness) => ["local", "cloud"].filter((place) => modelsOf(harness, place).length);

/** Where a model id lives, for reopening the panel on the side the agent is already on. */
function placeOfModel(id) {
  const known = S.data.models.find((item) => item.id === id);
  return known?.local ? "local" : "cloud";
}

/** A model this agent may actually be put on: it exists here, has tools, and can be reached. */
const usableModel = (id) => {
  const known = S.data.models.find((item) => item.id === id);
  return Boolean(known && known.tools !== false && known.usable !== false);
};

/**
 * The agent's brain, as two questions instead of one list: on the left who drives
 * the loop, on the right where that harness's model runs and which one it is.
 * A harness this machine cannot run says what it needs; it never falls back to a
 * default that belongs to a different one, and it cannot be saved half-chosen.
 */
function brainPanel(agent) {
  const fallback = S.data.settings.defaultModel || "";
  let harness = harnessOf(agent.model || fallback);
  let place = "";
  let chosen = agent.model || "";
  let hardware = null;
  let problem = "";
  const modelInput = h("input", { type: "hidden", name: "model", value: chosen });
  const hostInput = h("input", { type: "hidden", name: "ollamaHost", value: agent.ollamaHost || "" });
  const custom = h("input", {
    type: "text", name: "modelCustom", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    placeholder: "provider/modello, es. orcarouter/deepseek/deepseek-v4.1-flash",
  });
  const subscription = subscriptionPicker(agent.subscriptionId);
  const left = h("div", { class: "harness-list", role: "radiogroup", "aria-label": "Harness" });
  const right = h("div", { class: "stack-sm brain-side" });

  custom.addEventListener("input", () => {
    modelInput.disabled = Boolean(custom.value.trim());
    right.classList.toggle("dim", modelInput.disabled);
  });

  const pick = (id) => {
    chosen = id;
    modelInput.value = id;
    modelInput.disabled = false;
    custom.value = "";
    problem = "";
    right.classList.remove("dim");
    drawRight();
  };

  /** The model a harness opens on: the agent's own if it belongs here, else the first that works. */
  const opening = (key) => {
    if (agent.model && harnessOf(agent.model) === key && usableModel(agent.model)) return agent.model;
    if (fallback && harnessOf(fallback) === key && usableModel(fallback)) return "";
    for (const where of ["local", "cloud"]) {
      const first = modelsOf(key, where).find((model) => model.tools !== false && model.usable !== false);
      if (first) return first.id;
    }
    return null;
  };

  const chooseHarness = (key) => {
    if (key === harness) return;
    harness = key;
    const next = opening(key);
    chosen = next ?? "";
    modelInput.value = chosen;
    place = next ? placeOfModel(next) : next === "" ? placeOfModel(fallback) : "";
    problem = "";
    subscription.setProvider(SUBSCRIPTION_HARNESSES.includes(key) && harnessReady(key) ? key : "");
    drawLeft();
    drawRight();
  };

  function drawLeft() {
    left.replaceChildren(...Object.entries(HARNESSES).map(([key, item]) => {
      const ready = harnessReady(key);
      const on = key === harness;
      return h("button", {
        type: "button", class: `harness-row${on ? " on" : ""}${ready ? "" : " off"}`, role: "radio",
        "aria-checked": String(on), onclick: () => chooseHarness(key),
      },
        h("span", { class: "harness-led", "aria-hidden": "true" }),
        h("span", { class: "harness-text" },
          h("span", { class: "harness-name" }, tr(item.label), ready ? null : h("span", { class: "harness-flag" }, tr("non installato"))),
          h("span", { class: "harness-hint" }, tr(item.hint))));
    }));
  }

  function modelRow(model, { subtitle = "", fit = null, selected = false, quiet = false, sees = true }) {
    // Two ways a model cannot be used: no tools, or this machine cannot reach it. Both
    // disable the row; the reason is in words, and once only when a notice above says it.
    const blocked = model.tools === false ? tr("Senza strumenti un agente non può fare nulla")
      : model.usable === false ? tr(model.reason || "non disponibile su questa macchina") : "";
    return h("button", {
      type: "button", class: `row-link model-row${selected ? " on" : ""}`, role: "radio", "aria-checked": String(selected),
      disabled: Boolean(blocked), title: blocked,
      onclick: blocked ? undefined : () => pick(model.id),
    },
      h("div", { class: "row-text full" },
        h("span", { class: "row-title" }, raw(model.label || model.id), selected ? badge("scelto", "on", "check") : null),
        h("span", { class: "row-meta" },
          subtitle ? h("span", {}, raw(subtitle)) : null,
          fit ? badge(fit.text, fit.kind, fit.kind === "on" ? "check" : "alert") : null,
          model.vision && sees ? tag("vede") : null,
          model.tools === false ? tag("senza strumenti") : null,
          model.usable === false ? tag(quiet ? "da collegare" : model.reason || "non disponibile") : null)));
  }

  function defaultRow({ quiet = false } = {}) {
    // The default belongs to one harness and to one side: offering it anywhere else
    // is how "Predefinito (Ollama Cloud)" ended up under Claude Code.
    if (!fallback || harnessOf(fallback) !== harness || placeOfModel(fallback) !== place) return null;
    const known = S.data.models.find((item) => item.id === fallback) || { id: fallback, usable: false, reason: MISSING_MODEL };
    return modelRow({ ...known, id: "", label: tr("Predefinito dell'istanza") }, {
      subtitle: modelLabel(fallback), selected: !chosen, quiet,
    });
  }

  function cloudSide() {
    const out = [];
    const models = modelsOf(harness, "cloud");
    // An Ollama on this machine lists the cloud models whether or not it may run them.
    const cloud = S.data.ollamaCloud || {};
    const unpaired = !cloud.signedIn && models.some((model) => model.usable === false);
    if (unpaired) {
      out.push(h("div", { class: "notice warn" }, icon("alert"), h("div", { class: "stack-sm" },
        h("span", {}, h("b", {}, tr("Ollama Cloud non è collegato a questa macchina.")), " ",
          tr("I suoi modelli compaiono perché l'Ollama locale li elenca, ma rispondono solo dopo il collegamento.")),
        cloud.signinUrl ? h("span", {}, btn("Collega Ollama Cloud", { icon: "external", cls: "sm", href: cloud.signinUrl, target: "_blank" })) : null)));
    }
    // Under a subscription the provider is the harness itself: saying it on every row is noise.
    const subtitleOf = (model) => (SUBSCRIPTION_HARNESSES.includes(harness) ? "" : tr(model.via || PROVIDERS[model.provider] || model.provider));
    const sees = !models.every((model) => model.vision);
    const rows = models.map((model) => modelRow(model, { subtitle: subtitleOf(model), selected: model.id === chosen, quiet: unpaired, sees }));
    const first = defaultRow({ quiet: unpaired });
    if (!rows.length && !first) out.push(h("small", { class: "muted" }, tr("Nessun modello nel cloud per questo harness.")));
    else out.push(h("div", { class: "rows", role: "radiogroup", "aria-label": "Modello" }, first, ...rows));
    return out;
  }

  function localSide() {
    if (!hardware) return [h("small", { class: "muted" }, tr("Guardo la macchina…"))];
    const out = [];
    const hosts = hardware.hosts || [];
    const cards = hardware.gpus || [];
    const host = hosts.find((item) => item.url === hostInput.value) || hosts[0] || null;
    const card = host?.gpu ? cards.find((item) => item.uuid === host.gpu) : cards.length === 1 ? cards[0] : null;
    // What Ollama holds for the model loaded now is not lost to the next one: it unloads.
    const held = (host?.loaded || []).reduce((sum, item) => sum + (item.vram || 0), 0);

    if (cards.length) {
      out.push(h("div", { class: "card-strip" }, cards.map((item) => h("div", { class: "card-line" },
        icon("chip"),
        h("b", {}, raw(item.name)),
        card && item.uuid === card.uuid && cards.length > 1 ? badge("in uso da lui", "on", "check") : null,
        h("span", { class: "card-meta" },
          raw(tr("{free} GB liberi di {total}", { free: gbFromMib(item.memoryTotal - item.memoryUsed), total: gbFromMib(item.memoryTotal) })),
          // Without this the verdicts below look wrong: a 9 GB model "fits" in 4.5 GB free
          // because the model loaded now is let go when the agent changes model.
          held && card && item.uuid === card.uuid ? [" · ", raw(tr("{held} GB al modello acceso, che si libera cambiando", { held: gbFromBytes(held) }))] : null,
          " · ", raw(tr("carico {load}%", { load: item.load })))))));
    } else if (hosts.length) {
      out.push(h("small", { class: "muted" }, "Nessuna scheda dedicata: i modelli locali girano sul processore."));
    }

    if (hosts.length > 1) {
      const picker = h("select", {}, hosts.map((item) => h("option", { value: item.url, selected: item.url === (hostInput.value || hosts[0].url) },
        `${item.label || item.url}${item.version ? ` · Ollama ${item.version}` : ""}`)));
      picker.addEventListener("change", () => { hostInput.value = picker.value; drawRight(); });
      out.push(field("Scheda", picker, "Ogni scheda ha il suo Ollama: scegliere il server è come scegliere la scheda."));
    }

    const prefix = harness === "hermes" ? "hermes" : "ollama";
    const installed = (host?.models || []).filter((model) => model.local && model.completion);
    const rows = [...installed.filter((model) => model.tools), ...installed.filter((model) => !model.tools)].map((model) => {
      const id = `${prefix}/${model.name}`;
      const loaded = (host?.loaded || []).find((item) => item.name === model.name);
      return modelRow({ id, label: model.name, tools: model.tools, vision: model.vision }, {
        subtitle: model.size >= WEIGHTS_AT_LEAST ? tr("{size} GB", { size: gbFromBytes(model.size) }) : tr("non è su questa macchina"),
        fit: loaded ? residencyOf(loaded) : fitOf(model, card, held),
        selected: id === chosen,
      });
    });
    out.push(h("div", { class: "field full" }, h("span", { class: "label" }, "Modelli su questa macchina"),
      rows.length ? h("div", { class: "rows", role: "radiogroup", "aria-label": "Modello" }, defaultRow(), ...rows)
        : h("small", { class: "muted" }, "Nessun modello installato qui.")));

    const name = h("input", { type: "text", placeholder: tr("nome del modello, es. qwen3:14b"), autocomplete: "off", spellcheck: "false" });
    const status = h("small", { class: "muted" });
    const install = btn("Scarica", { icon: "upgrade", onclick: async () => {
      const wanted = name.value.trim();
      if (!wanted || !host) return;
      if (!confirm(tr("Scarico {model} su {card}? Ollama lo installa e lo configura da sé; l'avanzamento lo vedi qui.", { model: wanted, card: card?.name || host.label || tr("questa macchina") }))) return;
      status.textContent = tr("comincio…");
      await guard(api("/api/ollama/pull", { method: "POST", body: { model: wanted, host: host.url } }), tr("Scarico {model}", { model: wanted }));
    } });
    S.onPull = (event) => {
      if (!host || event.host !== host.url) return;
      if (event.done) {
        status.textContent = event.ok ? tr("{model} è pronto.", { model: event.model }) : tr("{model}: {error}", { model: event.model, error: event.error });
        if (event.ok) loadHardware();
        return;
      }
      const percent = event.total ? Math.round((event.completed / event.total) * 100) : 0;
      status.textContent = `${event.model}: ${event.status}${event.total ? ` ${percent}%` : ""}`;
    };
    out.push(h("details", { class: "brain-custom" }, h("summary", {}, tr("Installa un altro modello")),
      h("div", { class: "stack-sm" }, h("div", { class: "input-row" }, name, install), status)));
    return out;
  }

  function drawRight() {
    const out = [];
    if (!harnessReady(harness)) {
      // Nothing to choose until the harness exists: no list, no default, no free-text id.
      out.push(h("div", { class: "notice warn" }, icon("alert"), h("div", { class: "stack-sm" },
        ...harnessMissing(harness).map((line) => h("span", {}, raw(line))),
        SUBSCRIPTION_HARNESSES.includes(harness)
          ? h("span", { class: "muted" }, tr("Dopo l'installazione l'account si collega qui, o in Impostazioni → Collegamenti."))
          : null)));
      right.replaceChildren(...out);
      return;
    }
    const places = placesOf(harness);
    if (!place || !places.includes(place)) place = places.includes(placeOfModel(chosen || fallback)) ? placeOfModel(chosen || fallback) : places[0] || "cloud";

    if (SUBSCRIPTION_HARNESSES.includes(harness)) out.push(subscription.node);
    if (places.length > 1) {
      const switcher = h("div", { class: "segmented", role: "tablist", "aria-label": "Dove gira il modello" });
      for (const key of places) {
        switcher.append(h("button", {
          type: "button", role: "tab", class: place === key ? "on" : "", "aria-selected": String(place === key),
          onclick: () => { place = key; drawRight(); },
        }, tr(PLACES[key][0])));
      }
      out.push(h("div", { class: "field" }, h("span", { class: "label" }, "Dove gira"), switcher, h("small", {}, tr(PLACES[place][1]))));
    } else if (places.length === 1 && !SUBSCRIPTION_HARNESSES.includes(harness)) {
      out.push(h("small", { class: "muted" }, tr(PLACES[places[0]][1])));
    }

    if (problem) out.push(h("p", { class: "notice warn", role: "alert" }, icon("alert"), h("span", {}, problem)));
    out.push(...(place === "local" ? localSide() : cloudSide()));
    out.push(h("details", { class: "brain-custom" }, h("summary", {}, tr("Scrivi tu l'id del modello")),
      h("div", { class: "stack-sm" }, custom, h("small", { class: "muted" }, "Se lo scrivi, vince su quello scelto qui sopra."))));
    right.replaceChildren(...out.filter(Boolean));
  }

  const loadHardware = () => api("/api/hardware").then((data) => { hardware = data; if (place === "local") drawRight(); }).catch(() => {});

  /** The save is refused here, in words, rather than storing a brain that cannot think. */
  const validate = () => {
    const typed = custom.value.trim();
    if (!harnessReady(harness)) problem = tr("{harness} non è installato su questa macchina: scegli un altro harness.", { harness: tr(HARNESSES[harness].label) });
    else if (typed) problem = harnessOf(typed) === harness ? "" : tr("L'id scritto appartiene a un altro harness.");
    else if (!chosen && !(fallback && harnessOf(fallback) === harness && usableModel(fallback))) problem = tr("Scegli un modello: quello predefinito dell'istanza non gira con questo harness.");
    else if (chosen && !usableModel(chosen) && !chosen.startsWith("ollama/") && !chosen.startsWith("hermes/")) problem = tr("Questo modello non è disponibile su questa macchina.");
    else problem = "";
    if (problem) { drawRight(); toast(problem, true); right.scrollIntoView({ block: "center", behavior: "smooth" }); return false; }
    return subscription.validate();
  };

  subscription.setProvider(SUBSCRIPTION_HARNESSES.includes(harness) && harnessReady(harness) ? harness : "");
  drawLeft();
  drawRight();
  loadHardware();

  return {
    node: h("div", { class: "brain" },
      h("div", { class: "brain-main" },
        h("div", { class: "stack-sm" }, h("span", { class: "label" }, "Harness"), left),
        h("div", { class: "stack-sm" }, h("span", { class: "label" }, "Modello"), right)),
      modelInput, hostInput),
    validate,
    subscriptionId: () => subscription.value(),
  };
}

/** The Cervello tab: the two columns, plus what the brain does once it has a model. */
function brainTab(agent) {
  const brain = brainPanel(agent);
  const form = h("form", { class: "stack" },
    panel({ icon: "chip", title: "Cervello", hint: "Chi guida il ciclo, dove gira il modello e quale." }, brain.node),
    panel({ icon: "spark", title: "Come pensa", hint: "Quanto si ferma a ragionare e cosa ha per le mani." },
      h("div", { class: "stack-sm" },
        field("Ragionamento: livello", h("select", { name: "effort" },
          [["", "Automatico"], ["low", "Basso"], ["medium", "Medio"], ["high", "Alto"]].map(([value, label]) =>
            h("option", { value, selected: (agent.effort || (agent.think ? "high" : "")) === value }, label))),
          "Quanto pensa prima di rispondere: più alto è più accurato ma più lento."),
        switchInput("tools", "Usa il suo computer", agent.tools ?? true, "Un desktop Linux tutto suo, che vedi anche tu."))),
    h("div", { class: "savebar" }, h("span", { class: "spacer" }), btn("Salva", { icon: "check", type: "submit", cls: "primary" })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!brain.validate()) return;
    const data = new FormData(form);
    const body = {
      model: pickedModel(data, "model"),
      ollamaHost: data.get("ollamaHost") || "",
      subscriptionId: brain.subscriptionId(),
      tools: form.elements.tools.checked,
      effort: data.get("effort"),
      think: false,
    };
    if (!await guard(api(`/api/agents/${agent.id}`, { method: "PUT", body }), "Salvato")) return;
    await loadState();
    renderAgent();
  });
  return form;
}

function modelSelect(name, current, { allowDefault = true, harness = "" } = {}) {
  const select = h("select", { name });
  if (allowDefault) select.append(h("option", { value: "" }, tr("Predefinito ({model})", { model: modelLabel(S.data.settings.defaultModel) })));
  const groups = {};
  const wanted = harness ? HARNESSES[harness]?.providers || [] : null;
  // An Ollama on this machine also proxies the cloud models: they are not the same thing.
  for (const model of S.data.models) {
    if (wanted && !wanted.includes(model.provider)) continue;
    (groups[model.provider === "ollama" && model.local ? "ollama-local" : model.provider] ||= []).push(model);
  }
  for (const provider of ["ollama-local", ...Object.keys(PROVIDERS)]) {
    const list = groups[provider];
    if (!list?.length) continue;
    select.append(h("optgroup", { label: tr(PROVIDER_GROUPS[provider] || PROVIDERS[provider] || provider) },
      list.map((model) => h("option", { value: model.id, selected: model.id === current, disabled: model.usable === false && model.id !== current },
        `${model.label}${model.size ? ` · ${gbFromBytes(model.size)} GB` : ""}${model.vision ? tr(" · vede") : ""}${model.tools ? "" : tr(" · senza strumenti")}${model.usable === false ? ` · ${tr(model.reason || "non disponibile")}` : ""}`))));
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

/** The program each subscription runs through, which is what has to be installed. */
const CLI_NAMES = { claude: "Claude Code", codex: "Codex" };
const SUBSCRIPTION_STATES = { disconnected: "Da collegare", connecting: "Accesso in corso", ready: "Collegata", error: "Accesso non riuscito" };

function subscriptionPicker(currentId, { manage = false } = {}) {
  let provider = "";
  let selectedId = currentId || "";
  let choosing = !selectedId;
  let requestBusy = false;
  let actionError = "";
  let snapshot = "";
  const selections = new Map();
  const input = h("input", { type: "hidden", name: "subscriptionId" });
  const content = h("div", { class: "subscription-content" });
  const root = h("section", { class: "subscription-picker", "aria-label": "Account del modello" }, input, content);
  const authCode = h("input", { type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Codice di autorizzazione", placeholder: "Incolla il codice di Claude" });
  authCode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      content.querySelector(".subscription-complete")?.click();
    }
  });

  async function action(fn) {
    if (requestBusy) return;
    requestBusy = true;
    actionError = "";
    draw();
    try { await fn(); }
    catch (error) { actionError = error.message; }
    try { await refresh(); }
    catch { actionError ||= "Impossibile aggiornare il collegamento. Riprova."; }
    requestBusy = false;
    draw();
  }

  async function refresh() {
    S.data.subscriptions = await api("/api/subscriptions");
    draw();
  }

  function connectNew() {
    const nextProvider = provider;
    return action(async () => {
      const record = await api("/api/subscriptions", { method: "POST", body: { provider: nextProvider, label: PROVIDER_SHORT[nextProvider] } });
      selections.set(nextProvider, record.id);
      if (provider === nextProvider) { selectedId = record.id; choosing = false; }
      await api(`/api/subscriptions/${record.id}/login`, { method: "POST" });
    });
  }

  function changeAccount() {
    choosing = !choosing;
    actionError = "";
    draw();
  }

  function deviceHelp() {
    return h("details", { class: "subscription-help" },
      h("summary", {}, icon("info"), "Problemi con il codice dispositivo?"),
      h("p", {}, "Abilita l'accesso con codice dispositivo nelle impostazioni Sicurezza di ChatGPT. Per un account aziendale deve abilitarlo un amministratore nei permessi del workspace."),
      h("a", { href: "https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta", target: "_blank", rel: "noopener" }, "Guida ufficiale OpenAI", icon("external")));
  }

  function draw(force = false) {
    const all = (S.data.subscriptions || []).filter((record) => record.provider === provider);
    const records = all.filter((record) => !record.resident);
    const resident = !manage && S.data.settings.useResidentSubscriptions && all.find((record) => record.resident);
    const record = all.find((item) => item.id === selectedId) || (!selectedId && !choosing ? resident : null);
    const next = JSON.stringify({ provider, selectedId, choosing, records, requestBusy, actionError });
    if (!force && next === snapshot) return;
    snapshot = next;
    input.value = record?.resident ? "" : record?.id || "";
    root.setAttribute("aria-busy", String(requestBusy));
    root.setAttribute("data-state", record?.status || "empty");
    content.replaceChildren();
    if (root.hidden) return;
    const name = PROVIDER_SHORT[provider];
    const state = record?.status || "disconnected";
    const status = h("span", { class: `subscription-status ${state}`, role: "status" }, h("i", { "aria-hidden": "true" }), SUBSCRIPTION_STATES[state]);
    content.append(h("header", { class: "subscription-head" },
      h("span", { class: "subscription-mark", "aria-hidden": "true" }, icon(provider === "claude" ? "spark" : "chip")),
      h("div", { class: "grow" }, h("span", { class: "label" }, "Abbonamento"), h("h3", {}, raw(name))),
      record && !choosing ? status : null));
    if (actionError) content.append(h("p", { class: "subscription-error", role: "alert" }, icon("alert"), tr(actionError)));

    // Without the CLI on the server there is nothing to log in to: offering the
    // device code anyway only ever ends in "Accesso non riuscito".
    if (!S.data.providers?.[provider]) {
      // The account is ChatGPT's or Claude's; what is missing is the program that uses it.
      content.append(h("p", { class: "subscription-description" },
        tr("{cli} non è installato su questa macchina, quindi non c'è ancora niente da collegare. Installalo sul server con l'utente di Cora e questa scheda si accende da sola.", { cli: CLI_NAMES[provider] || name })));
      if (!manage) content.append(h("div", { class: "subscription-footer" }, btn("Impostazioni", { cls: "ghost", href: "#/settings/collegamenti" })));
      for (const button of content.querySelectorAll("button")) button.disabled = requestBusy;
      return;
    }

    if (choosing && (records.length || resident)) {
      content.append(h("p", { class: "subscription-description" }, "Scegli l'account da usare per questo agente."));
      const list = h("div", { class: "subscription-accounts", "aria-label": "Account disponibili" });
      for (const item of [...(resident ? [resident] : []), ...records]) {
        const count = (S.data.agents || []).filter((agent) => agent.subscriptionId === item.id).length;
        const option = h("button", { type: "button", class: "subscription-option", "aria-pressed": String(item.resident ? !selectedId : item.id === selectedId), onclick: () => {
          selectedId = item.resident ? "" : item.id;
          selections.set(provider, selectedId);
          choosing = false;
          actionError = "";
          authCode.value = "";
          draw();
        } },
        h("span", { class: `subscription-option-dot ${item.status}`, "aria-hidden": "true" }),
        h("span", { class: "grow" }, h("b", {}, item.resident ? "Subscription residente" : raw(item.email || item.label)), h("small", {}, item.resident && item.email ? raw(`${item.email} · `) : null, SUBSCRIPTION_STATES[item.status], count ? raw(` · ${count === 1 ? tr("Usato da un agente") : tr("Usato da {count} agenti", { count })}`) : null)),
        icon(item.id === selectedId ? "check" : "next"));
        list.append(option);
      }
      content.append(list, h("div", { class: "subscription-footer" },
        btn("Collega un altro account", { icon: "plus", onclick: connectNew }),
        record ? btn("Indietro", { cls: "ghost", onclick: changeAccount }) : null));
    } else if (record?.status === "ready") {
      authCode.value = "";
      if (record.resident) content.append(h("span", { class: "subscription-source" }, "Subscription residente · predefinita"));
      content.append(h("div", { class: "subscription-identity" },
        h("span", { class: "subscription-connected", "aria-hidden": "true" }, icon("check")),
        h("div", { class: "grow" }, h("b", {}, raw(record.email || record.label)),
          h("p", {}, manage ? "Disponibile per gli agenti di questa istanza." : "Questo agente userà il tuo abbonamento."))));
      content.append(h("div", { class: "subscription-footer" },
        btn("Cambia account", { cls: "ghost", onclick: changeAccount }),
        btn("", { icon: "refresh", cls: "ghost", title: "Verifica collegamento", onclick: () => action(() => api(`/api/subscriptions/${record.id}/check`, { method: "POST" })) })));
    } else if (record?.status === "connecting") {
      const step = (number, title, ...children) => h("li", {}, h("span", { class: "subscription-step", "aria-hidden": "true" }, number), h("div", { class: "subscription-step-body" }, h("b", {}, title), ...children));
      if (record.login?.url) {
        const open = btn(tr("Apri {provider}", { provider: name }), { icon: "external", cls: "primary", href: record.login.url, target: "_blank" });
        const steps = h("ol", { class: "subscription-steps" });
        if (record.login.userCode) {
          steps.append(step("1", "Copia il codice", h("div", { class: "subscription-code" },
            h("strong", { tabindex: "0", "aria-label": "Codice dispositivo" }, raw(record.login.userCode)),
            btn("", { icon: "copy", cls: "ghost", title: "Copia codice", onclick: async () => {
              try { await navigator.clipboard.writeText(record.login.userCode); toast("Copiato"); }
              catch { toast("Non riesco a copiare: selezionalo a mano", true); }
            } }))),
          step("2", tr("Accedi a {provider}", { provider: name }), h("p", {}, "Incolla il codice nella pagina ufficiale e autorizza il collegamento."), open));
        } else {
          steps.append(step("1", tr("Accedi a {provider}", { provider: name }), h("p", {}, "Apri la pagina ufficiale e autorizza il collegamento."), open));
          if (record.login.manualCode) steps.append(step("2", "Torna qui con il codice", field("Codice di autorizzazione", authCode),
            btn("Completa collegamento", { icon: "check", cls: "subscription-complete", onclick: () => {
              if (!authCode.value.trim()) { authCode.focus(); return; }
              const code = authCode.value;
              authCode.value = "";
              action(() => api(`/api/subscriptions/${record.id}/code`, { method: "POST", body: { code } }));
            } })));
        }
        content.append(steps);
      } else content.append(h("p", { class: "subscription-description" }, "Preparazione dell'accesso…"));
      content.append(h("div", { class: "subscription-footer" },
        h("span", { class: "subscription-wait" }, icon("clock"), "In attesa di autorizzazione"),
        btn("Annulla", { cls: "ghost", onclick: () => action(() => api(`/api/subscriptions/${record.id}/cancel`, { method: "POST" })) })));
      if (provider === "codex") content.append(deviceHelp());
    } else {
      authCode.value = "";
      content.append(h("div", { class: "subscription-intro" }, h("h4", {}, tr("Collega il tuo account {provider}", { provider: name })),
        h("p", {}, manage ? "Accedi dal browser per aggiungere un account alla tua Cora." : "Accedi dal browser per usare il tuo abbonamento con questo agente.")));
      if (record?.status === "error") content.append(h("p", { class: "subscription-error", role: "alert" }, icon("alert"), record.issue === "isolation"
        ? "Questa istanza non supporta ancora il collegamento. Aggiorna Claude Code sul server e riprova."
        : "L'accesso non è stato completato. Riprova quando vuoi."));
      if (record?.resident) {
        content.append(h("p", { class: "subscription-description" }, "Nessun account residente disponibile. Collega un altro account oppure controlla i collegamenti nelle impostazioni."),
          h("div", { class: "subscription-footer" }, btn(tr("Collega {provider}", { provider: name }), { icon: "external", cls: "primary", onclick: connectNew }),
            btn("Impostazioni", { cls: "ghost", href: "#/settings/collegamenti" })));
      } else content.append(h("div", { class: "subscription-footer" },
        btn(requestBusy ? "Preparazione dell'accesso…" : tr("Collega {provider}", { provider: name }), { icon: requestBusy ? "refresh" : "external", cls: "primary", onclick: record
          ? () => action(() => api(`/api/subscriptions/${record.id}/login`, { method: "POST" })) : connectNew }),
        records.length ? btn("Cambia account", { cls: "ghost", onclick: changeAccount }) : null));
      if (provider === "codex") content.append(deviceHelp());
    }
    if (choosing && record && !record.resident && !(S.data.agents || []).some((agent) => agent.subscriptionId === record.id)) {
      content.append(btn("Rimuovi account", { icon: "trash", cls: "ghost danger subscription-remove", onclick: () => action(async () => {
        await api(`/api/subscriptions/${record.id}`, { method: "DELETE" });
        selectedId = "";
        selections.delete(provider);
        choosing = true;
      }) }));
    }
    for (const button of content.querySelectorAll("button")) button.disabled = requestBusy;
  }

  const poll = async () => {
    if (!root.isConnected) return;
    if (!root.hidden && !requestBusy) {
      if (S.data.subscriptions?.some((item) => item.provider === provider && item.status === "connecting")) {
        try { await refresh(); } catch {}
      }
    }
    setTimeout(poll, 1500);
  };
  setTimeout(poll, 1500);
  return {
    node: root,
    setProvider(value) {
      if (provider) selections.set(provider, selectedId);
      const previous = provider;
      provider = value;
      const needs = provider === "claude" || provider === "codex";
      root.hidden = !needs;
      input.disabled = !needs;
      if (previous !== provider) {
        selectedId = selections.has(provider) ? selections.get(provider) : ((S.data.subscriptions || []).find((item) => item.id === currentId && item.provider === provider)?.id) || "";
        choosing = !selectedId && (manage || !S.data.settings.useResidentSubscriptions);
        actionError = "";
        authCode.value = "";
      }
      draw();
    },
    validate() {
      if (root.hidden) return true;
      const record = (S.data.subscriptions || []).find((item) => item.provider === provider && (input.value ? item.id === input.value : item.resident && S.data.settings.useResidentSubscriptions));
      if (record && (record.status === "ready" || record.id === currentId)) return true;
      choosing = !record;
      actionError = "Collega un account per continuare.";
      draw();
      root.scrollIntoView({ block: "center", behavior: "smooth" });
      content.querySelector("button")?.focus({ preventScroll: true });
      return false;
    },
    value() { return root.hidden ? "" : input.value; },
  };
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
      button.lastChild.textContent = tr(armedLabel);
      setTimeout(() => { armed = false; button.classList.remove("armed"); button.lastChild.textContent = tr(label); }, 4000);
      return;
    }
    await onconfirm();
  });
  return button;
}

/**
 * Who the agent is. The brain lives in its own tab once the agent exists; while it
 * is being created there is no tab yet, so the simple pair harness + model rides here.
 */
function agentForm(agent, { only = "" } = {}) {
  const isNew = !agent.id;
  const wantsBrain = only !== "profile";
  const nameInput = h("input", { type: "text", name: "name", value: agent.name || "", required: true, maxlength: 32, placeholder: "es. Marta", autocomplete: "off" });
  const avatarInput = h("input", { type: "url", name: "avatarUrl", value: agent.avatarUrl || "", placeholder: "https://… (png o jpg)" });
  const fader = h("input", { type: "range", class: "fader", name: "chattiness", min: 0, max: 100, value: Math.round((agent.chattiness ?? 0.5) * 100) });
  const faderValue = h("b", { class: "fader-value" }, fader.value);
  fader.addEventListener("input", () => { faderValue.textContent = fader.value; });
  const hidden = (agent.channelIds || []).filter((id) => !S.data.channels.some((channel) => channel.id === id));
  // Two choices, not one: who runs the loop, and which model thinks.
  let harness = harnessOf(agent.model || S.data.settings.defaultModel || "");
  const model = wantsBrain ? modelPicker("model", agent.model || "", { harness }) : null;
  const harnessPick = wantsBrain ? h("select", {}, Object.entries(HARNESSES).map(([key, item]) =>
    h("option", { value: key, selected: key === harness }, tr(item.label)))) : null;
  const harnessHint = wantsBrain ? h("small", { class: "muted" }, tr(HARNESSES[harness].hint)) : null;
  const subscription = wantsBrain ? subscriptionPicker(agent.subscriptionId) : null;
  if (wantsBrain) {
    const syncSubscription = () => {
      const select = model.querySelector("select");
      const typed = model.querySelector("input");
      subscription.setProvider((typed.value.trim() || select.value || S.data.settings.defaultModel).split("/")[0]);
    };
    model.addEventListener("change", syncSubscription);
    model.addEventListener("input", syncSubscription);
    harnessPick.addEventListener("change", () => {
      harness = harnessPick.value;
      harnessHint.textContent = tr(HARNESSES[harness].hint);
      model.querySelector("select").replaceWith(modelSelect("model", "", { allowDefault: true, harness }));
      syncSubscription();
    });
    subscription.setProvider((agent.model || S.data.settings.defaultModel).split("/")[0]);
  }
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
    wantsBrain ? panel({ icon: "chip", title: "Cervello", hint: "Con che modello pensa e cosa può usare." },
      h("div", { class: "stack-sm" },
        field("Harness", harnessPick, "Chi guida il ciclo: Cora, oppure il modello stesso."),
        harnessHint,
        field("Modello", model),
        subscription.node,
        field("Ragionamento: livello", h("select", { name: "effort" },
          [["", "Automatico"], ["low", "Basso"], ["medium", "Medio"], ["high", "Alto"]].map(([value, label]) => h("option", { value, selected: (agent.effort || (agent.think ? "high" : "")) === value }, label))),
        "Quanto pensa prima di rispondere: più alto è più accurato ma più lento."),
        switchInput("tools", "Usa il suo computer", agent.tools ?? true, "Un desktop Linux tutto suo, che vedi anche tu."))) : null,
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
    if (wantsBrain && !subscription.validate()) return;
    const data = new FormData(form);
    const body = {
      name: data.get("name"),
      avatarUrl: data.get("avatarUrl"),
      color: data.get("color"),
      chattiness: Number(data.get("chattiness")) / 100,
      channelIds: [...hidden, ...[...form.querySelectorAll("[data-channels] .chip.on")].map((chip) => chip.dataset.id)],
      enabled: form.elements.enabled.checked,
      personality: data.get("personality"),
      ...(wantsBrain ? {
        model: pickedModel(data, "model"),
        subscriptionId: subscription.value(),
        tools: form.elements.tools.checked,
        effort: data.get("effort"),
        think: false,
      } : {}),
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

function slackTokenForm({ path, ok }) {
  const bot = h("input", { type: "password", placeholder: tr("Token del bot (xoxb-…)"), autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const level = h("input", { type: "password", placeholder: tr("Token a livello app (xapp-…)"), autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const button = btn("Collega", { icon: "link", cls: "primary" });
  const save = async () => {
    if (!bot.value.trim() || !level.value.trim()) {
      toast("Servono tutti e due i token", true);
      return;
    }
    button.disabled = true;
    const saved = await guard(api(path, { method: "PUT", body: { botToken: bot.value, appToken: level.value } }), ok);
    bot.value = "";
    level.value = "";
    button.disabled = false;
    if (saved) {
      await loadState();
      render();
    }
  };
  button.addEventListener("click", save);
  for (const input of [bot, level]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
    });
  }
  return h("div", { class: "stack-sm" }, bot, level, h("div", { class: "row end" }, button));
}

/** Slack takes a bot's name from its app, so the app is created from a manifest already filled in. */
function slackManifest(manifest) {
  const text = JSON.stringify(manifest, null, 2);
  return h("div", { class: "stack-sm" },
    h("div", { class: "row" },
      btn("Copia il manifest", { icon: "copy", onclick: () => {
        navigator.clipboard?.writeText(text).then(() => toast("Copiato"), () => toast("Non riesco a copiare: selezionalo a mano", true));
      } }),
      btn("Crea l'app su Slack", { icon: "external", href: "https://api.slack.com/apps?new_app=1", target: "_blank" })),
    h("details", { class: "manifest" }, h("summary", {}, tr("Vedi il manifest")), h("pre", { class: "mono" }, text)));
}

function slackAccount(agent) {
  const bot = agent.slackBot || { configured: false, env: "", appEnv: "" };
  const actions = bot.user
    ? badge(bot.inChannel ? "Nel canale" : "Fuori dal canale", bot.inChannel ? "on" : "err", bot.inChannel ? "check" : "alert")
    : badge("App principale", bot.state === "error" ? "err" : "", "slack");
  let body;
  if (bot.user) {
    body = [
      h("p", { class: "lead" }, "Collegata come ", h("b", {}, raw(`@${bot.user.username}`)), ". ", bot.inChannel ? "Scrive nel canale col suo account." : "Non è ancora nei canali accesi: invitala con /invite e scriverà da sola."),
      h("small", { class: "muted" }, "Nome e immagine stanno nell'app Slack: se rinomini l'agente, rinomina anche l'app."),
    ];
  } else {
    body = [
      h("p", { class: "lead" }, bot.state === "error" ? tr("I token salvati non funzionano ({error}): incollane di nuovi.", { error: bot.error }) : "Ora scrive tramite l'app principale, col suo nome sul messaggio. Con un'app sua è un utente Slack vero: la menzioni e le scrivi in privato."),
      steps(
        h("span", {}, "tocca «Crea l'app su Slack», scegli ", h("b", {}, "From a manifest"), " e incolla il manifest qui sotto;"),
        h("span", {}, "Install to Workspace, poi copia il ", h("b", {}, "Bot User OAuth Token"), " (xoxb-) da OAuth & Permissions;"),
        h("span", {}, "in Basic Information → App-Level Tokens crea un token con ", h("code", {}, "connections:write"), " e copia l'xapp-;"),
        h("span", {}, "incolla i due token qui: li controllo e li salvo in hush come ", h("code", {}, bot.env), " e ", h("code", {}, bot.appEnv), ";"),
        h("span", {}, "nel canale scrivi ", h("code", {}, `/invite @${agent.name}`), ".")),
      bot.manifest ? slackManifest(bot.manifest) : null,
      slackTokenForm({ path: `/api/agents/${agent.id}/slack-bot`, ok: "Token salvati" }),
    ];
  }
  return panel({ icon: "slack", title: "Account Slack", hint: "La sua app su Slack.", actions }, body);
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
  const view = location.hash;
  S.live = null;
  const [, id, tab = "profilo", sub] = route();
  const agent = S.data.agents.find((item) => item.id === id);
  if (!agent) {
    shell(panel({ icon: "alert", title: "Agente non trovato" }, btn("Torna agli agenti", { icon: "back", href: "#/agenti" })), { title: "Agente", back: "#/agenti" });
    return;
  }
  const routines = S.data.routines.filter((routine) => routine.agentId === agent.id);
  const slot = h("div", { class: tab === "chat" ? "chat-slot" : "stack" }, tab === "chat" ? skeleton("chat") : panel({}, skeleton()));
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
    slot,
  ], { title: agent.name, back: sub ? `#/agent/${agent.id}/ragionamento` : "#/agenti", mode: compact ? "chat" : "" });
  document.querySelector(".tabs a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  const isCurrent = () => slot.isConnected && location.hash === view;
  let body;
  if (tab === "memoria") body = await memoryTab(agent);
  else if (tab === "routine") body = await routineTab(agent, routines);
  else if (tab === "desktop") body = await desktopTab(agent);
  else if (tab === "attivita") body = activityTab(agent);
  else if (tab === "chat") body = await chatPanel(`web-${agent.id}`, { placeholder: tr("Scrivi a {name}…", { name: agent.name }), hint: agent.enabled ? null : "È muto: accendilo per parlarci.", isCurrent });
  else if (tab === "ragionamento") body = sub ? await traceDetail(agent, sub, isCurrent) : await tracesTab(agent, isCurrent);
  else if (tab === "cervello") body = brainTab(agent);
  else body = [S.data.transport === "slack" ? slackAccount(agent) : S.data.transport === "telegram" ? telegramAccount(agent) : discordAccount(agent), agentForm(agent, { only: "profile" })];
  if (isCurrent()) slot.replaceChildren(...[body].flat().filter(Boolean));
}

async function memoryTab(agent) {
  const data = await guard(api(`/api/agents/${agent.id}/memories`));
  if (!data) return panel({ icon: "alert", title: "Memoria non disponibile" });
  const core = h("textarea", { class: "tall", placeholder: "Le note che ha sempre in testa: chi è, cosa gli importa, i rapporti con gli altri, cosa sta succedendo." }, data.core || "");
  const coreCount = h("span", { class: "label" }, `${(data.core || "").length}/4000`);
  core.addEventListener("input", () => { coreCount.textContent = `${core.value.length}/4000`; });
  const sleepButton = btn(data.sleeping ? "Dorme…" : "Consolida", { icon: "moon", cls: "sm", disabled: data.sleeping, onclick: async () => {
    sleepButton.disabled = true;
    sleepButton.lastChild.textContent = tr("Dorme…");
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
  let kind = routine.kind || "routine";
  const localDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const runAt = h("input", { type: "datetime-local", name: "runAt", value: localDate(routine.runAt ? new Date(routine.runAt) : new Date(Date.now() + 3600000)) });
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
  const timing = h("div", { class: "field full task-timing" });
  const submit = btn("Crea routine", { icon: "check", type: "submit", cls: "primary" });
  const drawTiming = () => {
    schedule.required = kind === "routine";
    runAt.required = kind === "reminder";
    submit.replaceChildren(icon("check"), h("span", {}, kind === "reminder" ? isNew ? "Crea reminder" : "Salva reminder" : isNew ? "Crea routine" : "Salva routine"));
    timing.replaceChildren(h("span", { class: "label" }, kind === "reminder" ? "Una sola volta" : "Quando"), ...(kind === "reminder"
      ? [runAt, h("small", {}, "Data e ora nel fuso del tuo dispositivo. Il reminder viene archiviato solo dopo un successo verificato.")]
      : [h("div", { class: "chips" }, PRESETS.map(([label, expr]) => h("button", { type: "button", class: "chip", onclick: () => { schedule.value = expr; updatePreview(); } }, label))), schedule, preview,
        h("small", {}, tr("Formato cron: minuto ora giorno mese giorno-settimana (fuso {zone}).", { zone: S.data.timezone }))]));
    if (kind === "routine") updatePreview();
  };
  const kindPicker = h("div", { class: "task-kind-picker", role: "group", "aria-label": "Tipo di attività" });
  for (const [value, title, hint] of [["routine", "Routine", "Si ripete a orari fissi"], ["reminder", "Reminder", "Una volta, poi in archivio"]]) {
    kindPicker.append(h("button", { type: "button", class: `task-kind${kind === value ? " active" : ""}`, "aria-pressed": String(kind === value), onclick: (event) => {
      kind = value;
      for (const button of kindPicker.children) { const active = button === event.currentTarget; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); }
      drawTiming();
    } }, icon("clock"), h("span", {}, h("b", {}, title), h("small", {}, hint))));
  }
  const channelSelect = h("select", { name: "channelId", required: true },
    h("option", { value: "" }, "Scegli dove pubblicare…"),
    h("option", { value: "web", selected: routine.channelId === "web" }, "Salotto dell'app"),
    h("option", { value: `web-${agent.id}`, selected: routine.channelId === `web-${agent.id}` }, "Chat privata nell'app"),
    S.data.channels.map((channel) => h("option", { value: channel.id, selected: channel.id === routine.channelId }, raw(channelChipLabel(channel)))));
  if (routine.channelId && !routine.channelId.startsWith("web") && !S.data.channels.some((channel) => channel.id === routine.channelId)) {
    channelSelect.append(h("option", { value: routine.channelId, selected: true }, tr("{channel} (non attivo)", { channel: channelName(routine.channelId) })));
  }
  const form = panel({ tag: "form", icon: isNew ? "plus" : "edit", title: isNew ? "Nuova attività" : tr("Modifica «{name}»", { name: routine.name }), hint: "Un compito, quando serve, con un risultato da ritrovare." },
    isNew ? kindPicker : badge(kind === "reminder" ? "Reminder" : "Routine", "", "clock"),
    h("div", { class: "grid2" },
      field("Nome", h("input", { type: "text", name: "name", value: routine.name || "", required: true, placeholder: "es. Rassegna stampa" })),
      field(S.data.transport === "telegram" ? "Chat" : "Canale", channelSelect),
      timing,
      field("Compito", h("textarea", { name: "prompt", class: "tall", required: true, placeholder: "Cosa deve fare, dove guardare, cosa riportare. Se non c'è niente da dire può restare in silenzio." }, routine.prompt || ""), null, "full"),
      h("div", { class: "field full" }, switchInput("enabled", "Attiva", routine.enabled ?? true))),
    h("div", { class: "row end" },
      isNew ? null : btn("Annulla", { icon: "close", href: `#/agent/${agent.id}/routine`, cls: "ghost" }),
      submit));
  drawTiming();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = new FormData(form);
    const body = { kind, name: data.get("name"), ...(kind === "reminder" ? { runAt: new Date(runAt.value).toISOString() } : { schedule: schedule.value }), channelId: data.get("channelId"), prompt: data.get("prompt"), enabled: form.elements.enabled.checked };
    submit.disabled = true;
    const saved = await guard(isNew ? api(`/api/agents/${agent.id}/routines`, { method: "POST", body }) : api(`/api/routines/${routine.id}`, { method: "PUT", body }), kind === "reminder" ? "Reminder salvato" : isNew ? "Routine creata" : "Routine salvata");
    submit.disabled = false;
    if (!saved) return;
    await loadState();
    location.hash = `#/agent/${agent.id}/routine`;
    renderAgent();
  });
  return form;
}

const RUN_STATUS = { running: ["in corso", "agent"], completed: ["successo verificato", "ok"], posted: ["pubblicata", "ok"], nothing: ["niente da dire", ""], error: ["errore", "err"], blocked: ["bloccato", "err"], unverified: ["da verificare", "err"], interrupted: ["interrotto", "err"], stopped: ["fermato", ""], skipped: ["in attesa", ""], unknown: ["esito non disponibile", ""] };
function runStatus(status) { return tag(...(RUN_STATUS[status] || [status, ""])); }
function taskTime(iso) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: S.data.timezone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

async function routineTab(agent, routines) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const editing = params.get("edit");
  if (editing) {
    const routine = routines.find((item) => item.id === editing);
    if (routine) return routineForm(agent, routine);
  }
  const archived = params.get("view") === "archive";
  const navigation = h("nav", { class: "tabs task-tabs", "aria-label": "Attività programmate" },
    h("a", { href: `#/agent/${agent.id}/routine`, class: archived ? "" : "active" }, icon("clock"), "In programma"),
    h("a", { href: `#/agent/${agent.id}/routine?view=archive`, class: archived ? "active" : "" }, icon("book"), "Archivio"));
  if (archived) return [navigation, routineArchive(agent)];
  const items = () => S.data.routines.filter((routine) => routine.agentId === agent.id).sort((a, b) => Date.parse(a.nextRunAt || "9999-01-01") - Date.parse(b.nextRunAt || "9999-01-01")).map((routine) => {
    const reminder = routine.kind === "reminder";
    const status = routine.running ? tag("in corso", "agent")
      : routine.lastStatus ? runStatus(routine.lastStatus) : null;
    return h("div", { class: `routine${routine.enabled ? "" : " paused"}` },
      h("div", { class: "routine-head" },
        h("span", { class: "panel-ico" }, icon("clock")),
        h("span", { class: "grow" },
          h("b", {}, raw(routine.name), routine.enabled ? "" : " · in pausa"),
          h("span", { class: "row-meta" }, reminder ? "Reminder" : "Routine", h("code", {}, reminder ? taskTime(routine.runAt) : raw(routine.schedule)), "→", raw(channelName(routine.channelId)))),
        h("span", { class: "row-actions" },
          btn("", { icon: "play", cls: "sm primary", title: reminder && ["blocked", "unverified", "error", "interrupted", "stopped"].includes(routine.lastStatus) ? "Riprova" : "Esegui ora", disabled: routine.running, onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}/run`, { method: "POST" }), "Attività avviata")) scheduleRefresh();
          } }),
          btn("", { icon: "edit", cls: "sm", title: "Modifica", href: `#/agent/${agent.id}/routine?edit=${routine.id}` }),
          btn("", { icon: routine.enabled ? "pause" : "play", cls: "sm ghost", title: routine.enabled ? "Metti in pausa" : "Riattiva", onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}`, { method: "PUT", body: { enabled: !routine.enabled } }))) { await loadState(); drawTasks(); }
          } }),
          armedButton("Archivia", "Conferma archiviazione", { onconfirm: async () => {
            if (await guard(api(`/api/routines/${routine.id}`, { method: "DELETE" }), "Attività archiviata")) { await loadState(); drawTasks(); }
          } }))),
      h("div", { class: "row-meta" }, status, routine.nextRunAt && routine.enabled ? tr("prossima {time}", { time: fmtTime(routine.nextRunAt, true) }) : "", routine.lastRunAt ? tr(" · ultima {time}", { time: fmtTime(routine.lastRunAt, true) }) : ""),
      routine.lastVerification?.reason ? h("p", { class: "task-verification" }, raw(routine.lastVerification.reason)) : null,
      h("details", {}, h("summary", {}, "Compito e ultimo risultato"), h("pre", {}, raw(routine.prompt)), routine.lastOutput ? h("pre", {}, raw(routine.lastOutput)) : null));
  });
  const taskList = h("div", { class: "stack-sm" });
  function drawTasks() {
    const rows = items();
    taskList.replaceChildren(...(rows.length ? rows : [empty("clock", "Nessuna attività in programma. Creane una qui sotto.")]));
  }
  drawTasks();
  S.taskRefresh = () => { if (taskList.isConnected) drawTasks(); };
  return [
    navigation,
    panel({ icon: "clock", title: "Routine e reminder", hint: "Le routine si ripetono. I reminder si archiviano dopo un successo verificato." }, taskList),
    routineForm(agent),
  ];
}

function routineArchive(agent = null) {
  const results = h("div", { class: "task-history-results", role: "status" }, h("p", { class: "muted" }, "Caricamento…"));
  const mode = h("select", { "aria-label": "Mostra" }, h("option", { value: "history" }, "Storico esecuzioni"), h("option", { value: "archive" }, "Attività archiviate"));
  const kind = h("select", { "aria-label": "Tipo di attività" }, h("option", { value: "" }, "Routine e reminder"), h("option", { value: "routine" }, "Routine"), h("option", { value: "reminder" }, "Reminder"));
  const search = h("input", { type: "search", "aria-label": "Cerca nell'archivio", placeholder: "Nome, compito o risultato", maxlength: 200 });
  const agents = h("select", { "aria-label": "Agente" }, h("option", { value: "" }, "Tutti gli agenti"), S.data.agents.map((item) => h("option", { value: item.id }, raw(item.name))));
  let offset = 0;
  let generation = 0;
  const root = panel({ icon: "book", title: "Archivio", hint: "Compiti, risultati e verifiche. Una storia che resta anche dopo l'archiviazione." },
    h("form", { class: "task-history-filters", onsubmit: (event) => { event.preventDefault(); offset = 0; load(); } },
      mode, kind, agent ? null : agents, h("div", { class: "task-history-search" }, search, btn("Cerca", { icon: "search", type: "submit" }))), results);
  for (const select of [mode, kind, agents]) select.addEventListener("change", () => { offset = 0; load(); });
  async function load() {
    const current = ++generation;
    const params = new URLSearchParams({ agentId: agent?.id || agents.value, kind: kind.value, query: search.value, limit: "20", offset: String(offset) });
    results.setAttribute("aria-busy", "true");
    try {
      const data = await api(`/api/routines/${mode.value}?${params}`);
      if (!root.isConnected || current !== generation) return;
      const definitions = mode.value === "archive";
      const items = data.items.map((item) => {
        const owner = S.data.agents.find((entry) => entry.id === item.agentId);
        const status = definitions ? item.archiveReason === "completed" ? runStatus("completed") : tag("archiviata", "") : runStatus(item.status);
        return h("article", { class: "task-history-item" },
          h("header", {}, h("span", { class: "panel-ico" }, icon(item.kind === "reminder" ? "check" : "clock")),
            h("div", { class: "grow" }, h("h3", {}, raw(item.name)), h("div", { class: "row-meta" }, item.kind === "reminder" ? "Reminder" : "Routine", raw(" · "), raw(owner?.name || item.agentName || item.agentId), raw(" · "),
              h("time", {}, taskTime(item.archivedAt || item.startedAt)))), status),
          item.verification?.reason ? h("p", { class: "task-verification" }, icon(item.verification.met ? "check" : "alert"), raw(item.verification.reason)) : null,
          item.historical ? h("small", { class: "muted" }, "Esito storico: verifica del successo non disponibile.") : null,
          h("details", {}, h("summary", {}, "Compito e risultato"),
            h("p", { class: "row-meta" }, raw(channelName(item.channelId)), raw(" · "), item.runAt ? taskTime(item.runAt) : raw(item.schedule || "")),
            h("pre", {}, raw(item.prompt)), h("pre", {}, raw(item.output || item.lastOutput || tr("Nessun risultato registrato."))),
            definitions ? h("p", { class: "muted" }, item.archiveReason === "completed" ? "Archiviato automaticamente dopo la verifica." : "Archiviato senza ulteriori esecuzioni.") : null),
          !definitions && owner && (item.traceAvailable || item.verificationAvailable) ? h("div", { class: "row task-history-links" },
            item.traceAvailable ? btn("Ragionamento", { icon: "bulb", cls: "sm ghost", href: `#/agent/${item.agentId}/ragionamento/${item.traceId}` }) : null,
            item.verificationAvailable ? btn("Verifica", { icon: "check", cls: "sm ghost", href: `#/agent/${item.agentId}/ragionamento/${item.verification.traceId}` }) : null) : null);
      });
      results.replaceChildren(h("p", { class: "task-history-count" }, tr("{count} risultati", { count: data.total.toLocaleString(LOCALE) })),
        items.length ? h("div", { class: "task-history-list" }, items) : empty("book", "Nessuna attività trovata."),
        h("div", { class: "task-history-pagination" }, btn("Precedenti", { icon: "back", cls: "ghost", disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - 20); load(); } }),
          h("span", { class: "muted" }, tr("Pagina {page}", { page: Math.floor(offset / 20) + 1 })), btn("Successivi", { icon: "next", cls: "ghost", disabled: offset + data.items.length >= data.total, onclick: () => { offset += 20; load(); } })));
    } catch (error) {
      if (root.isConnected && current === generation) results.replaceChildren(h("p", { class: "err-text", role: "alert" }, tr(error.message)), btn("Riprova", { icon: "refresh", onclick: load }));
    } finally { if (current === generation) results.setAttribute("aria-busy", "false"); }
  }
  load();
  return root;
}

function renderRoutineArchive() {
  shell([pageHead("Archivio", "La storia delle routine e dei reminder di tutti gli agenti."), routineArchive()], { title: "Archivio", back: "#/banco" });
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
  const mine = item.kind === "owner" && (!S.data.currentUser || item.authorId === S.data.currentUser.id || item.authorId === "panel");
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

async function chatPanel(room, { placeholder = "Scrivi…", hint = null, isCurrent = () => true } = {}) {
  const data = await guard(api(`/api/rooms/${room}/messages`));
  if (!isCurrent()) return null;
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
  const slot = h("div", { class: "chat-slot" }, skeleton("chat"));
  shell([
    pageHead(h("span", {}, "Il ", h("em", {}, "salotto")), "Tutti gli agenti in onda: chi nomini risponde, gli altri intervengono secondo la loquacità."),
    requestsStrip(),
    slot,
  ], { title: "Salotto", mode: "chat" });
  chatPanel(SALOTTO, { placeholder: "Scrivi a tutti…", isCurrent: () => slot.isConnected && route()[0] === "salotto" }).then((chat) => {
    if (slot.isConnected && chat) slot.replaceChildren(chat);
  });
}

/* ---------- reasoning ---------- */
function traceWhere(trace) {
  if (trace.kind === "sleep") return tr("memoria");
  return trace.channelId ? channelName(trace.channelId) : "";
}

function duration(trace) {
  const end = trace.endedAt ? Date.parse(trace.endedAt) : Date.now();
  const seconds = Math.max(0, (end - Date.parse(trace.startedAt)) / 1000);
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

async function tracesTab(agent, isCurrent = () => true) {
  const list = (await guard(api(`/api/agents/${agent.id}/traces`))) || [];
  if (!isCurrent()) return null;
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

async function traceDetail(agent, traceId, isCurrent = () => true) {
  const trace = await guard(api(`/api/traces/${traceId}`));
  if (!isCurrent()) return null;
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

/* ---------- shared instruction context ---------- */
function renderContext() {
  const body = h("div", { class: "context-browser" }, h("p", { class: "muted", role: "status" }, "Caricamento…"));
  let selectedId = route()[1] || "owner";
  let data;
  let editor = null;
  let errorText = "";
  let busy = false;
  const labels = { applied: "Applicato da Cora", detected: "Disponibile al CLI", excluded: "Escluso dal runtime", missing: "Non presente", unavailable: "Non leggibile", disabled: "Disattivato" };
  const scopes = { shared: "Comune a tutti gli agenti", resident: "Subscription residente", instance: "Cartella dell'istanza", account: "Account collegato", database: "Salvato nello spazio" };
  const choose = (id) => {
    if (editor) { toast("Salva o annulla le modifiche prima di cambiare file.", true); return; }
    selectedId = id;
    errorText = "";
    history.replaceState(null, "", `#/contesto/${id}`);
    draw();
  };
  const begin = (document = null) => {
    if (editor || busy) return;
    editor = document ? { id: document.id, name: document.name, content: document.content, enabled: document.enabled, expectedRevision: document.revision }
      : { name: "", content: "", enabled: true };
    errorText = "";
    draw();
    body.querySelector("input[type=text]")?.focus();
  };
  async function load() {
    refresh.disabled = true;
    try { data = await api("/api/context"); if (body.isConnected) draw(); }
    catch (error) {
      errorText = error.message;
      if (body.isConnected) {
        if (data) draw();
        else body.replaceChildren(h("p", { class: "err-text", role: "alert" }, tr(error.message)), btn("Riprova", { icon: "refresh", onclick: load }));
      }
    }
    finally { refresh.disabled = false; }
  }
  async function mutate(operation, message) {
    if (busy) return;
    busy = true;
    errorText = "";
    draw();
    try {
      const result = await operation();
      editor = null;
      selectedId = result?.id || "owner";
      history.replaceState(null, "", `#/contesto/${selectedId}`);
      await load();
      toast(message);
    } catch (error) {
      errorText = error.message;
      try { data = await api("/api/context"); } catch {}
    }
    finally { busy = false; if (body.isConnected) draw(); }
  }
  function draw() {
    if (!data) return;
    const previousScroll = body.querySelector(".context-files")?.scrollLeft || 0;
    const selected = data.sources.find((source) => source.id === selectedId) || data.sources[0];
    selectedId = selected.id;
    const stored = data.sources.filter((source) => source.storage === "database");
    const list = h("nav", { class: "context-files", "aria-label": "File di contesto" });
    if (editor && !editor.id) list.append(h("span", { class: "context-draft" }, icon("edit"), "Nuovo file"));
    if (stored.length) list.append(h("span", { class: "context-group label" }, "File dello spazio"));
    for (const [index, source] of [...stored, ...data.sources.filter((source) => source.storage !== "database")].entries()) {
      if (stored.length && index === stored.length) list.append(h("span", { class: "context-group label" }, "Istruzioni e memoria"));
      list.append(h("button", { type: "button", class: `context-file${source.id === selectedId && (!editor || editor.id) ? " active" : ""}`, "aria-pressed": String(source.id === selectedId && (!editor || editor.id)), disabled: busy, onclick: () => choose(source.id) },
        icon(source.storage === "database" ? "file" : source.provider === "cora" ? "book" : "file"),
        h("span", { class: "grow" }, h("b", {}, source.id === "shared-memory" ? "Memoria condivisa" : raw(source.title)),
          h("small", {}, source.storage === "database" ? labels[source.status] : raw(source.provider === "codex" ? "ChatGPT / Codex" : source.provider === "claude" ? "Claude" : "Cora"), raw(" · "), scopes[source.scope])),
        h("i", { class: `context-file-dot ${source.status}`, "aria-label": labels[source.status] })));
    }
    const error = errorText ? h("p", { class: "context-error", role: "alert" }, icon("alert"), tr(errorText)) : null;
    let document;
    if (editor) {
      const name = h("input", { type: "text", name: "contextName", value: editor.name, maxlength: 120, autocomplete: "off", placeholder: "es. istruzioni-team.md", oninput: (event) => { editor.name = event.target.value; } });
      const text = h("textarea", { name: "contextContent", class: "context-editor-text", spellcheck: "false", placeholder: "Scrivi le istruzioni o incolla il testo di riferimento…", oninput: (event) => { editor.content = event.target.value; count.textContent = tr("{count} / {limit} caratteri", { count: editor.content.length.toLocaleString(LOCALE), limit: data.limits.fileChars.toLocaleString(LOCALE) }); } }, raw(editor.content));
      const count = h("small", { class: "context-count" }, tr("{count} / {limit} caratteri", { count: editor.content.length.toLocaleString(LOCALE), limit: data.limits.fileChars.toLocaleString(LOCALE) }));
      const enabled = switchInput("contextEnabled", "Usa negli agenti", editor.enabled, "Disponibile a tutti gli agenti dal prossimo turno.");
      enabled.querySelector("input").addEventListener("change", (event) => { editor.enabled = event.target.checked; });
      const form = h("form", { class: "context-editor" }, error, field("Nome del file", name), field("Contenuto", text), count, enabled,
        h("div", { class: "context-editor-actions" }, btn("Annulla", { cls: "ghost", onclick: () => { editor = null; errorText = ""; draw(); } }), btn(busy ? "Salvataggio…" : "Salva file", { icon: "check", type: "submit", cls: "primary" })));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const others = stored.filter((source) => source.enabled && source.id !== editor.id).reduce((total, source) => total + source.content.length, 0);
        errorText = !/^[^\/\\\x00-\x1f]+\.(md|txt|markdown)$/i.test(editor.name.trim()) ? "usa un nome file .md o .txt senza percorsi"
          : !editor.content.trim() ? "inserisci un file di testo non vuoto"
          : editor.content.length > data.limits.fileChars ? "il file supera il limite di 30.000 caratteri"
          : editor.enabled && others + editor.content.length > data.limits.totalChars ? "il contesto attivo supera il limite di 60.000 caratteri" : "";
        if (errorText) { draw(); return; }
        const draft = { ...editor };
        mutate(() => api(draft.id ? `/api/context/documents/${draft.id}` : "/api/context/documents", { method: draft.id ? "PUT" : "POST", body: draft }), "File salvato");
      });
      document = h("section", { class: "context-document" }, h("header", {}, h("div", {}, h("h2", {}, editor.id ? "Modifica file" : "Nuovo file"), h("p", { class: "context-path" }, "Salvato nel database di questa istanza"))), form);
      for (const control of form.querySelectorAll("input, textarea, button")) control.disabled = busy;
    } else {
      const custom = selected.storage === "database";
      const explanation = custom ? selected.enabled ? "Questo file è incluso nel contesto di tutti gli agenti dal prossimo turno." : "Il file è conservato nello spazio e non viene inviato agli agenti."
        : selected.id === "owner" ? "Queste istruzioni vengono incluse da Cora nel contesto di tutti gli agenti."
        : selected.provider === "codex" ? "Codex viene avviato con le istruzioni locali disabilitate. Riceve le istruzioni comuni già incluse da Cora."
        : selected.provider === "claude" ? "File disponibile a Claude. Il caricamento dipende dal profilo e dal runtime del turno." : "Questa memoria viene condivisa con tutti gli agenti dell'istanza.";
      const copy = selected.content ? btn("Copia testo", { icon: "copy", cls: "ghost", onclick: async () => {
        try { await navigator.clipboard.writeText(selected.content); toast("Copiato"); } catch { toast("Non riesco a copiare: selezionalo a mano", true); }
      } }) : null;
      document = h("section", { class: "context-document" },
        h("header", {}, h("div", { class: "grow" }, h("h2", {}, selected.id === "shared-memory" ? "Memoria condivisa" : raw(selected.title)),
          selected.path || custom ? h("p", { class: "context-path" }, custom ? "Salvato nel database di questa istanza" : raw(selected.path)) : null), copy), error,
        h("div", { class: "context-provenance" }, badge(labels[selected.status], selected.status === "applied" ? "on" : ""), selected.updatedAt ? h("time", { datetime: selected.updatedAt }, raw(new Date(selected.updatedAt).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" }))) : null),
        h("p", { class: "context-explanation" }, explanation), selected.accountLabel ? h("p", { class: "context-explanation" }, raw(selected.accountLabel)) : null,
        custom ? h("div", { class: "context-tools" }, btn("Modifica", { icon: "edit", onclick: () => begin(selected) }),
          btn(selected.enabled ? "Disattiva" : "Attiva", { icon: "power", onclick: () => mutate(() => api(`/api/context/documents/${selected.id}`, { method: "PUT", body: { enabled: !selected.enabled, expectedRevision: selected.revision } }), "Contesto aggiornato") }),
          armedButton("Elimina file", "Conferma eliminazione", { onconfirm: () => mutate(() => api(`/api/context/documents/${selected.id}`, { method: "DELETE" }), "File eliminato") })) : null,
        selected.available && selected.content ? h("pre", { class: "context-text", tabindex: "0", "aria-label": "Testo delle istruzioni" }, raw(selected.content)) : h("div", { class: "context-empty" }, icon("file"), h("p", {}, selected.available ? "Questo contesto è vuoto." : selected.status === "missing" ? "Questo file non è presente sul server." : "Questo file non può essere mostrato.")),
        selected.truncated ? h("small", { class: "context-limit" }, "Sono mostrati i primi 60.000 caratteri.") : null);
    }
    body.replaceChildren(list, document);
    list.scrollLeft = previousScroll;
    revealSelection(list);
    for (const button of document.querySelectorAll("button")) button.disabled = busy;
    newButton.disabled = upload.disabled = busy || Boolean(editor);
  }
  const fileInput = h("input", { type: "file", accept: ".md,.txt,.markdown,text/plain,text/markdown", hidden: true, "aria-label": "Carica file di contesto", onchange: async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      if (!/\.(md|txt|markdown)$/i.test(file.name)) throw new Error("carica un file Markdown o di testo (.md, .txt)");
      if (file.size > data.limits.fileChars * 4) throw new Error("il file supera il limite di 30.000 caratteri");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (content.length > data.limits.fileChars) throw new Error("il file supera il limite di 30.000 caratteri");
      begin();
      editor.name = file.name;
      editor.content = content;
      draw();
    } catch (error) { toast(error instanceof TypeError ? "il file deve contenere testo UTF-8" : error.message, true); }
  } });
  const newButton = btn("Nuovo file", { icon: "plus", cls: "primary", onclick: () => begin() });
  const upload = btn("Carica file", { icon: "upgrade", onclick: () => fileInput.click() });
  const refresh = btn("Aggiorna", { icon: "refresh", cls: "ghost", onclick: load });
  shell([pageHead("Contesto", "Le istruzioni del server e la memoria comune agli agenti.", [upload, newButton, refresh]),
    h("p", { class: "context-intro" }, "Aggiungi istruzioni e file di riferimento per tutti gli agenti. Puoi anche ispezionare le sorgenti del server e la memoria condivisa."),
    h("small", { class: "context-upload-hint" }, "File .md e .txt · 30.000 caratteri per file · 60.000 caratteri attivi in totale"), fileInput, body], { title: "Contesto" });
  newButton.disabled = upload.disabled = true;
  load();
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

function subscriptionPlanLabel(plan) {
  return ({ free: "Free", pro: "Pro", plus: "Plus", max: "Max", team: "Team", enterprise: "Enterprise", business: "Business", self_serve_business_prolite: "Business" })[plan] || tr("Abbonamento attivo");
}

function instanceAccessPanel() {
  const current = S.data.currentUser;
  const identity = h("div", { class: "access-identity" }, icon("user"),
    h("div", { class: "grow" }, h("b", {}, raw(current?.name || current?.email || "Owner")), current?.email ? h("small", {}, raw(current.email)) : null),
    badge(current?.role === "member" ? "Utente" : "Owner", "on"));
  if (!S.data.access?.canManage) return panel({ icon: "shield", title: "Accesso all'istanza", hint: "Il tuo account e i permessi di questa Cora." }, identity,
    h("p", { class: "lead" }, "Puoi lavorare con gli agenti e usare tutte le funzioni operative. L'owner gestisce chi può entrare."));
  const body = h("div", { class: "stack" }, identity, h("p", { class: "muted", role: "status" }, "Caricamento…"));
  let data;
  let busy = false;
  const update = async (fn) => {
    if (busy) return;
    busy = true;
    for (const button of body.querySelectorAll("button")) button.disabled = true;
    try { await fn(); data = await api("/api/access"); draw(); toast("Accessi aggiornati"); }
    catch (error) { toast(error.message, true); }
    finally { busy = false; for (const button of body.querySelectorAll("button")) button.disabled = false; }
  };
  const rules = (kind, title, hint, placeholder) => {
    const input = h("input", { type: kind === "emails" ? "email" : "text", "aria-label": kind === "emails" ? "Email da autorizzare" : "Dominio da autorizzare", placeholder, autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
    const add = btn(kind === "emails" ? "Autorizza" : "Aggiungi", { icon: "plus", onclick: () => {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      update(() => api("/api/access", { method: "PUT", body: { [kind]: [...data[kind], value] } }));
    } });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add.click(); } });
    return h("section", { class: "access-rules" }, h("h3", {}, title), h("p", {}, hint),
      h("div", { class: "access-add" }, input, add),
      h("ul", {}, data[kind].length ? data[kind].map((value) => h("li", { class: "access-rule" }, icon(kind === "domains" ? "globe" : "user"), h("span", { class: "grow" }, raw((kind === "domains" ? "@" : "") + value)),
        btn("", { icon: "close", cls: "ghost", title: tr("Rimuovi {value}", { value }), onclick: () => update(() => api("/api/access", { method: "PUT", body: { [kind]: data[kind].filter((entry) => entry !== value) } })) })))
        : h("li", { class: "access-no-rules" }, kind === "domains" ? "Nessun dominio autorizzato." : "Nessun indirizzo aggiunto.")));
  };
  const actions = { "sign-in": "Accesso effettuato", settings: "Impostazioni aggiornate", agent: "Agente modificato", message: "Messaggio inviato", connections: "Collegamenti aggiornati", "access-policy": "Accessi aggiornati", context: "Contesto aggiornato" };
  function draw() {
    const users = h("div", { class: "access-users" }, data.users.map((user) => h("div", { class: "access-user" },
      h("span", { class: "access-user-mark", "aria-hidden": "true" }, icon(user.role === "owner" ? "shield" : "user")),
      h("div", { class: "grow" }, h("b", {}, raw(user.name || user.email || "Owner")), user.email ? h("span", { class: "access-user-email" }, raw(user.email)) : null,
        h("small", {}, tr("Prima visita: {date}", { date: new Date(user.createdAt).toLocaleDateString(LOCALE) }), raw(" · "),
          tr("Ultima attività: {date}", { date: new Date(user.lastSeenAt).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }) }))),
      badge(user.role === "owner" ? "Owner" : user.blocked ? "Revocato" : user.allowed ? "Utente" : "Non autorizzato", user.allowed ? "on" : ""),
      user.role === "owner" ? null : btn(user.blocked ? "Riabilita" : "Revoca accesso", { cls: user.blocked ? "ghost" : "ghost danger", onclick: () => update(() => api(`/api/access/users/${user.id}`, { method: "PUT", body: { blocked: !user.blocked } })) }))));
    body.replaceChildren(identity,
      h("p", { class: "lead" }, "Gli utenti ammessi hanno gli stessi permessi operativi. Solo l'owner può autorizzare o revocare gli accessi."),
      h("div", { class: "connection-grid" },
        rules("domains", "Domini autorizzati", "Ammetti tutti gli account con un indirizzo verificato di questi domini.", "es. azienda.it"),
        rules("emails", "Singole persone", "Autorizza una persona senza aprire l'accesso a tutto il suo dominio.", "nome@azienda.it")),
      h("p", { class: "access-note" }, icon("info"), "Quando un utente perde l'autorizzazione, si chiudono anche le sue sessioni aperte. L'owner conserva sempre l'accesso."),
      h("section", { class: "access-people" }, h("h3", {}, "Utenti di questa istanza"),
        h("p", {}, "Ogni persona mantiene la propria identità, anche nei messaggi agli agenti."), users),
      h("details", { class: "access-history" }, h("summary", {}, icon("clock"), "Attività degli utenti"),
        h("div", { class: "access-audit" }, data.audit.map((entry) => h("div", {}, h("span", { class: "grow" }, h("b", {}, raw(entry.name || entry.email || "Owner")), h("span", {}, actions[entry.action] || "Attività")),
          h("time", { datetime: new Date(entry.at).toISOString() }, raw(new Date(entry.at).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }))))))));
  }
  api("/api/access").then((value) => { data = value; if (body.isConnected) draw(); }).catch(() => {
    body.replaceChildren(h("p", { class: "err-text" }, "Impossibile caricare gli accessi."), btn("Riprova", { icon: "refresh", onclick: () => { body.replaceChildren(h("p", { class: "muted", role: "status" }, "Caricamento…")); api("/api/access").then((value) => { data = value; draw(); }).catch(() => body.replaceChildren(h("p", { class: "err-text" }, "Impossibile caricare gli accessi."))); } }));
  });
  const refresh = btn("Aggiorna utenti", { icon: "refresh", cls: "ghost", onclick: async () => {
    refresh.disabled = true;
    try { data = await api("/api/access"); draw(); }
    catch (error) { toast(error.message, true); }
    finally { refresh.disabled = false; }
  } });
  return panel({ icon: "shield", title: "Accesso all'istanza", hint: "Scegli chi può entrare nella tua Cora.", actions: refresh }, body);
}

function connectionsPanel() {
  const residentToggle = switchInput("useResidentSubscriptions", "Usa subscription residenti", S.data.settings.useResidentSubscriptions,
    "Come impostazione predefinita, usa gli account già presenti sul dispositivo che ospita Cora.");
  const toggle = residentToggle.querySelector("input");
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    const enabled = toggle.checked;
    const saved = await guard(api("/api/settings", { method: "PUT", body: { useResidentSubscriptions: enabled } }), "Impostazioni salvate");
    if (saved) {
      await loadState();
      renderSettings();
    } else { toggle.checked = !enabled; toggle.disabled = false; }
  });
  const residentList = h("div", { class: "resident-accounts" });
  const drawResidents = () => {
    residentList.replaceChildren(...["claude", "codex"].map((provider) => {
      const record = S.data.subscriptions?.find((item) => item.resident && item.provider === provider);
      const connected = record?.status === "ready";
      return h("div", { class: "resident-account" },
        h("span", { class: "subscription-mark", "aria-hidden": "true" }, icon(provider === "claude" ? "spark" : "chip")),
        h("div", { class: "grow" }, h("b", {}, provider === "codex" ? "ChatGPT / Codex" : "Claude"),
          h("span", { class: "resident-email" }, connected ? raw(record.email || tr("Account rilevato"))
            : !S.data.providers?.[provider] ? tr("{cli} non installato su questa macchina", { cli: CLI_NAMES[provider] })
              : record?.status === "error" ? "Verifica non riuscita" : "Nessun account rilevato"),
          connected && record.plan ? h("small", {}, raw(subscriptionPlanLabel(record.plan))) : null),
        h("span", { class: `subscription-status ${connected ? "ready" : "disconnected"}` }, h("i", { "aria-hidden": "true" }), connected ? "Disponibile" : "Da collegare"));
    }));
  };
  drawResidents();
  const scan = btn("Rileva account", { icon: "refresh", cls: "ghost", onclick: async () => {
    scan.disabled = true;
    const result = await guard(api("/api/subscriptions/resident/check", { method: "POST" }));
    if (result) {
      S.data.subscriptions = await api("/api/subscriptions");
      drawResidents();
    }
    scan.disabled = false;
  } });
  const managed = ["claude", "codex"].map((provider) => {
    const existing = S.data.subscriptions?.find((item) => !item.resident && item.provider === provider);
    const picker = subscriptionPicker(existing?.id, { manage: true });
    picker.setProvider(provider);
    return picker.node;
  });
  const keyPanel = (provider, name) => {
    // A local Ollama is not a key: the card is about the key, and says what else counts.
    const configured = Boolean(S.data.keys?.[provider]);
    const key = h("input", { type: "password", autocomplete: "new-password", autocapitalize: "off", spellcheck: "false", "aria-label": tr("Chiave API {provider}", { provider: name }), placeholder: configured ? "Incolla una nuova chiave per sostituirla" : "Incolla la chiave API" });
    const save = btn(configured ? "Aggiorna chiave" : "Salva chiave", { icon: "check", cls: "primary", onclick: async () => {
      if (!key.value.trim()) { key.focus(); return; }
      save.disabled = true;
      const value = key.value;
      key.value = "";
      const result = await guard(api(`/api/providers/${provider}/key`, { method: "PUT", body: { key: value } }), "Chiave salvata");
      if (result) {
        S.data.providers[provider] = true;
        S.data.keys = { ...S.data.keys, [provider]: true };
        status.replaceChildren(icon("check"), tr("Configurata"));
        status.className = "badge on";
        key.placeholder = tr("Incolla una nuova chiave per sostituirla");
        save.lastChild.textContent = tr("Aggiorna chiave");
      }
      save.disabled = false;
    } });
    const status = badge(configured ? "Configurata" : "Da configurare", configured ? "on" : "", configured ? "check" : "key");
    key.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); save.click(); } });
    const cloud = S.data.ollamaCloud || {};
    const about = provider !== "ollama" ? h("p", {}, "La chiave vale per tutti gli agenti di questa istanza.")
      : h("div", { class: "stack-sm" },
        h("p", {}, "Serve solo per i modelli di Ollama Cloud. L'Ollama di questa macchina non ne ha bisogno."),
        configured ? null
          : cloud.signedIn ? h("p", { class: "muted" }, "Non serve: questa macchina è già collegata a Ollama Cloud.")
            : h("p", { class: "muted" }, "In alternativa alla chiave, collega questa macchina al tuo account Ollama.",
              cloud.signinUrl ? [" ", h("a", { href: cloud.signinUrl, target: "_blank", rel: "noopener" }, tr("Collega questa macchina"))] : null));
    return h("div", { class: "provider-key" }, h("div", { class: "provider-key-head" }, h("h3", {}, raw(name)), status),
      about, field("Chiave API", key), save);
  };
  return h("div", { class: "stack" },
    panel({ icon: "monitor", title: "Subscription del dispositivo", hint: "Gli account trovati sul server Cora.", actions: scan }, residentToggle, residentList),
    panel({ icon: "link", title: "Altri account", hint: "Collegali dal browser e scegli quale usare nel profilo di ogni agente." }, h("div", { class: "connection-grid" }, managed)),
    panel({ icon: "key", title: "Chiavi API", hint: "Ollama e OrcaRouter. Le chiavi vengono salvate in modo sicuro e non sono mostrate dopo il salvataggio." }, h("div", { class: "connection-grid" }, keyPanel("ollama", "Ollama"), keyPanel("orcarouter", "OrcaRouter"))));
}

function renderSettings() {
  const settings = S.data.settings;
  const discord = S.data.discord;
  const telegram = S.data.telegram;
  const guilds = discord.guilds;
  const providers = h("div", { class: "badges" }, CONNECTIONS.map(([key, label]) => {
    const on = S.data.providers?.[key];
    return h("span", { class: `badge${on ? " on" : ""}`, title: on ? "" : PROVIDER_HINTS[key] }, icon(on ? "check" : "close"), tr(label));
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

  const slack = S.data.slack || { state: "missing-token", channels: [], error: "" };
  const slackChannels = slack.channels || [];
  const refreshChannels = btn("Aggiorna canali", { icon: "refresh", cls: "sm ghost", onclick: async () => {
    if (await guard(api("/api/slack/channels"), "Canali aggiornati")) {
      await loadState();
      renderSettings();
    }
  } });
  const slackPanel = panel({ icon: "slack", title: "Slack", hint: "Un'app per ogni agente, così è un utente vero: la menzioni e le scrivi in privato.", actions: S.data.transport === "slack" ? badge("In uso", "on", "radio") : null },
    slack.user
      ? h("p", { class: "lead" }, "App principale: ", h("b", {}, raw(`@${slack.user.username}`)), raw(`${slack.team ? ` · ${slack.team.name}` : ""} · ${tr(STATE_LABEL[slack.state] || slack.state)}${slack.error ? ` (${slack.error})` : ""}`))
      : slack.state === "idle" || slack.state === "stopped"
        ? h("p", { class: "lead" }, "I token ci sono: l'app si collega quando Cora passa su Slack.")
        : [
          h("p", { class: "lead" }, slack.state === "error" ? tr("I token non funzionano: {error}.", { error: slack.error }) : "Serve l'app principale: tiene l'elenco dei canali e scrive gli avvisi."),
          steps(
            h("span", {}, "apri ", h("a", { href: "https://api.slack.com/apps?new_app=1", target: "_blank", rel: "noopener" }, "api.slack.com/apps"), " → From a manifest, e scegli il workspace;"),
            h("span", {}, "Install to Workspace, poi copia il ", h("b", {}, "Bot User OAuth Token"), " (xoxb-);"),
            h("span", {}, "in Basic Information → App-Level Tokens crea un token con ", h("code", {}, "connections:write"), " e copia l'xapp-;"),
            "incolla qui i due token: li controllo e li salvo in hush."),
        ],
    slackTokenForm({ path: "/api/slack/token", ok: "App Slack collegata" }),
    h("div", { class: "field" }, h("span", { class: "label" }, "Canali", slackChannels.length ? refreshChannels : null),
      slackChannels.length ? h("div", { class: "stack-sm" }, slackChannels.map((channel) => h("label", { class: "switch" },
        h("input", { type: "checkbox", name: "slchannel", value: channel.id, checked: settings.slackChannelIds.includes(channel.id) }),
        h("span", { class: "rocker" }),
        h("span", { class: "switch-text" }, raw(`#${channel.name}`), h("small", {}, tr(channel.private ? "canale privato" : "canale pubblico")))))) : h("div", { class: "row" }, h("small", {}, "Invita un'app in un canale (/invite): il canale compare qui e lo accendi."), refreshChannels)),
    field("Proprietari (ID utente Slack)", h("input", { type: "text", name: "slackOwnerIds", class: "mono", value: settings.slackOwnerIds.join(", "), autocomplete: "off" }), "Se è vuoto diventa proprietario chi possiede il workspace, appena scrive."));

  const form = h("form", { class: "stack" },
    h("div", { class: "settings-pane stack", "data-settings-tab": "preferenze", role: "tabpanel" }, languagePanel(), notificationsPanel()),
    h("div", { class: "settings-pane stack", "data-settings-tab": "collegamenti", role: "tabpanel" }, connectionsPanel()),
    h("div", { class: "settings-pane stack", "data-settings-tab": "canali", role: "tabpanel" },
    panel({ icon: "radio", title: "Dove vive Cora", hint: "Un canale alla volta: quando ne accendi uno, l'altro si spegne. Il salotto del pannello c'è sempre." },
      h("div", { class: "choices" }, transportChoice("discord"), transportChoice("telegram"), transportChoice("slack"))),
    h("div", { class: "split" }, discordPanel, telegramPanel), slackPanel),
    h("div", { class: "settings-pane stack", "data-settings-tab": "agenti", role: "tabpanel" },
    panel({ icon: "sliders", title: "Regia", hint: "Quanto possono parlarsi tra loro prima di fermarsi ad aspettare un umano." },
      h("div", { class: "grid3" },
        field("Messaggi tra agenti", h("input", { type: "number", name: "maxAgentTurns", min: 0, max: 40, value: settings.maxAgentTurns, inputmode: "numeric" }), "dopo ogni messaggio umano"),
        field("Risposte per giro", h("input", { type: "number", name: "maxRepliesPerRound", min: 1, max: 6, value: settings.maxRepliesPerRound, inputmode: "numeric" }), "agenti che parlano insieme"),
        field("Messaggi di contesto", h("input", { type: "number", name: "historySize", min: 5, max: 100, value: settings.historySize, inputmode: "numeric" }), "quanta chat rileggono"))),
    panel({ icon: "chip", title: "Cervelli e sonno", hint: "Il modello di chi non ne sceglie uno e l'ora in cui riordinano la memoria." },
      h("div", { class: "grid2" },
        h("div", { class: "field" }, h("span", { class: "label" }, "Modello predefinito"), modelPicker("defaultModel", settings.defaultModel, { allowDefault: false }),
          (() => {
            const known = S.data.models.find((model) => model.id === settings.defaultModel);
            const reason = !settings.defaultModel ? "" : !known ? tr(MISSING_MODEL) : known.usable === false ? tr(known.reason || "non disponibile") : "";
            return reason
              ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr("{model} non risponde su questa macchina ({reason}). Gli agenti senza un modello loro, gli obiettivi e le verifiche lo usano: scegline uno che gira qui.", { model: known?.label || settings.defaultModel, reason }))))
              : h("small", {}, "Lo usano gli agenti senza un modello loro, e il lavoro di fondo: obiettivi, verifiche, sonno.");
          })()),
        field("Ora del sonno", h("input", { type: "number", name: "sleepHour", min: 0, max: 23, value: settings.sleepHour, inputmode: "numeric" }), "consolidamento notturno della memoria"),
        h("div", { class: "field full" }, h("span", { class: "label" }, "Provider"), providers))),
    panel({ icon: "book", title: "Memoria condivisa", hint: "Cose che tutti gli agenti sanno: chi sei, i progetti, le regole della casa." },
      h("textarea", { name: "sharedMemory", class: "tall" }, settings.sharedMemory))),
    h("div", { class: "settings-pane stack", "data-settings-tab": "accesso", role: "tabpanel" },
    instanceAccessPanel(),
    panel({ icon: "key", title: "Chiavi SSH", hint: "Chi entra nei desktop via SSH passando dalla macchina host. Valgono già le chiavi che entrano nella macchina host; qui aggiungi le altre, una per riga." },
      h("textarea", { name: "sshKeys", class: "mono", placeholder: "ssh-ed25519 AAAA… telefono" }, settings.sshKeys.join("\n")))),
    h("div", { class: "savebar" }, h("span", { class: "spacer" }), btn("Salva impostazioni", { icon: "check", type: "submit", cls: "primary" })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const ids = (name) => String(data.get(name) || "").split(/[\s,]+/).filter(Boolean);
    const body = {
      ownerIds: ids("ownerIds"),
      telegramChatIds: [...form.querySelectorAll("input[name=tgchat]:checked")].map((input) => input.value),
      telegramOwnerIds: ids("telegramOwnerIds"),
      slackChannelIds: [...form.querySelectorAll("input[name=slchannel]:checked")].map((input) => input.value),
      slackOwnerIds: ids("slackOwnerIds"),
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
  const tabs = [["collegamenti", "Collegamenti", "link"], ["canali", "Canali", "radio"], ["agenti", "Agenti", "users"], ["preferenze", "Preferenze", "sliders"], ["accesso", "Accesso", "key"]];
  const nav = h("div", { class: "tabs settings-tabs", role: "tablist", "aria-label": "Sezioni impostazioni" });
  const showTab = (id, updateRoute = false) => {
    for (const pane of form.querySelectorAll(".settings-pane")) pane.hidden = pane.dataset.settingsTab !== id;
    for (const button of nav.querySelectorAll("button")) {
      const active = button.dataset.tab === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    form.querySelector(".savebar").hidden = ["collegamenti", "preferenze"].includes(id);
    if (updateRoute) history.replaceState(null, "", `#/settings/${id}`);
    revealSelection(nav);
  };
  for (const [id, label, name] of tabs) nav.append(h("button", { type: "button", role: "tab", id: `settings-tab-${id}`, "aria-controls": `settings-pane-${id}`, "data-tab": id, onclick: () => showTab(id, true) }, icon(name), label));
  for (const pane of form.querySelectorAll(".settings-pane")) {
    pane.id = `settings-pane-${pane.dataset.settingsTab}`;
    pane.setAttribute("aria-labelledby", `settings-tab-${pane.dataset.settingsTab}`);
  }
  nav.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...nav.querySelectorAll("button")];
    let index = buttons.indexOf(document.activeElement);
    index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].click();
    buttons[index].focus();
  });
  const initialTab = tabs.some(([id]) => id === route()[1]) ? route()[1] : "collegamenti";
  showTab(initialTab);
  shell([pageHead("Impostazioni", "Account, canali e preferenze della tua Cora."), nav, form], { title: "Impostazioni" });
  requestAnimationFrame(() => revealSelection(nav));
  if (typeof ResizeObserver !== "undefined") {
    S.settingsObserver = new ResizeObserver(() => revealSelection(nav));
    S.settingsObserver.observe(nav);
  }
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
  S.data = null;
  S.live = null;
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
      error.textContent = tr(err.message);
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
  else if (page === "archivio") renderRoutineArchive();
  else if (page === "contesto") renderContext();
  else if (page === "settings") renderSettings();
  else if (page === "salotto") renderSalotto();
  else renderAgents();
}

document.documentElement.lang = LANG;
document.title = "Cora · Computer-Operating Resident Agents";

async function boot() {
  shell([
    pageHead("Agenti", skeletonLine("sk-caption")),
    panel({ icon: "chart", title: "Consumi globali" }, skeleton("heat")),
    panel({ icon: "users", title: "Gli agenti" }, skeleton()),
    panel({ icon: "chart", title: "Consumi per agente" }, skeleton("heat")),
  ], { title: "Agenti" });
  const me = await fetch("/api/me", { credentials: "same-origin" }).then((response) => response.json()).catch(() => ({}));
  S.cloud = me.cloud || null;
  if (!me.authed) return renderLogin();
  try {
    await loadState();
    S.activity = await api("/api/activity");
  } catch (error) {
    if (error.message === "login richiesto") return;
    app.replaceChildren(h("div", { class: "login" }, h("p", {}, tr("Errore: {error}", { error: tr(error.message) }))));
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
