import { EN } from "./i18n.js";
import { CHARACTER_DEFAULT, CHARACTER_TRAITS, characterSheet, characterStyle, characterType, shouldWriteCharacter } from "./character.js";

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
  grok: "Grok (abbonamento)",
  muse: "Meta Muse (abbonamento)",
  gemini: "Gemini (abbonamento)",
  ollama: "Ollama Cloud",
  orcarouter: "OrcaRouter",
  hermes: "Hermes Agent",
  deepseek: "DeepSeek Harness",
};
// Who runs the loop is one choice; which model thinks is another. Cora's own harness
// drives Ollama and the routers; Claude Code, Codex, Grok Build, Muse Code, Hermes and DeepSeek Harness drive themselves.
const HARNESSES = {
  cora: { label: "Harness di Cora", hint: "Cora guida il modello e gli passa gli strumenti.", providers: ["ollama", "orcarouter"] },
  claude: { label: "Claude Code", hint: "Claude guida sé stesso con l'account scelto qui sotto.", providers: ["claude"] },
  codex: { label: "Codex", hint: "Codex guida sé stesso con l'account scelto qui sotto.", providers: ["codex"] },
  grok: { label: "Grok Build", hint: "Grok guida sé stesso con l'account scelto qui sotto.", providers: ["grok"] },
  muse: { label: "Muse Code", hint: "Muse guida sé stesso con l'account Meta scelto qui sotto.", providers: ["muse"] },
  gemini: { label: "Antigravity CLI", hint: "Gemini usa l'abbonamento Google AI dell'account scelto qui sotto.", providers: ["gemini"] },
  hermes: { label: "Hermes", hint: "Hermes guida sé stesso: su questa macchina, su Ollama Cloud o su DeepSeek.", providers: ["hermes"] },
  deepseek: { label: "DeepSeek Harness", hint: "dsh, l'harness di DeepSeek, guida sé stesso con la tua chiave DeepSeek o quella dello space.", providers: ["deepseek"] },
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
  ["grok", "Grok Build"],
  ["muse", "Muse Code"],
  ["gemini", "Antigravity CLI"],
  ["hermes", "Hermes Agent"],
  ["deepseek", "DeepSeek Harness"],
];
const PROVIDER_HINTS = {
  claude: "Claude Code non trovato su questa macchina",
  codex: "Codex non trovato su questa macchina",
  grok: "Grok Build non trovato su questa macchina",
  muse: "Muse Code non trovato su questa macchina",
  gemini: "Antigravity CLI non trovato su questa macchina",
  ollama: "questa macchina non è collegata a Ollama Cloud, e manca CORA_OLLAMA_API_KEY in hush",
  ollamaLocal: "nessun Ollama in ascolto su questa macchina",
  ollamaCloud: "questa macchina non è collegata a Ollama Cloud, e manca CORA_OLLAMA_API_KEY in hush",
  orcarouter: "manca CORA_ORCAROUTER_API_KEY in hush",
  hermes: "Hermes non trovato su questa macchina",
  deepseek: "serve dsh su questa macchina e una chiave DeepSeek, tua o dello space",
};
const PROVIDER_SHORT = { claude: "Claude", codex: "ChatGPT", grok: "Grok", muse: "Meta", gemini: "Gemini", ollama: "Ollama", orcarouter: "OrcaRouter", hermes: "Hermes", deepseek: "DeepSeek" };
/** Each subscription's mark, so two accounts are told apart at a glance. */
const SUBSCRIPTION_ICONS = { claude: "spark", codex: "chip", grok: "terminal", muse: "layers", gemini: "spark" };
/** The account's name and the program that uses it, as Settings lists them. */
const SUBSCRIPTION_NAMES = { claude: "Claude", codex: "ChatGPT / Codex", grok: "Grok / Grok Build", muse: "Meta / Muse Code", gemini: "Gemini / Antigravity" };
const PRESETS = [
  ["Ogni mattina 9:00", "0 9 * * *"],
  ["Ogni sera 21:00", "0 21 * * *"],
  ["Lun-ven 8:30", "30 8 * * 1-5"],
  ["Lunedì 10:00", "0 10 * * 1"],
  ["Ogni ora", "0 * * * *"],
  ["Ogni 15 minuti", "*/15 * * * *"],
];
const TABS = [
  ["impostazioni", "Impostazioni", "sliders"],
  ["cervello", "Cervello", "chip"],
  ["chat", "Chat", "chat"],
  ["email", "Email", "mail"],
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
  swap: '<path d="M4 7h16l-4-4M20 17H4l4 4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M4.5 9v9.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.5h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 16V5"/><path d="M7.5 9.5 12 5l4.5 4.5"/><path d="M4.5 19.5h15"/>',
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
  minus: '<path d="M5 12h14"/>',
  list: '<path d="M9 6h11.5M9 12h11.5M9 18h11.5"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  graph: '<circle cx="6" cy="7" r="2.5"/><circle cx="17.5" cy="5.5" r="2"/><circle cx="16" cy="17" r="3"/><circle cx="5.5" cy="18" r="1.8"/><path d="M8.3 7.9 13.4 15M8.4 6.6l7.2-.9M17.2 7.5l-.8 6.5M7.3 17.6l5.7-.4"/>',
  trash: '<path d="M3.5 6h17M9 6V4h6v2M18.5 6l-.9 13.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/>',
  pin: '<path d="M12 16.5V22M8 3.5h8l-1 6 3.5 4.5v2h-13v-2L9 9.5z"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 17.7 17M20 4.5v7h-7"/>',
  moon: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
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
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
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
    else if (key === "href" && String(value).startsWith("#/brain")) el.setAttribute(key, brainHref(value));
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

/** An agent's picture, as Cora serves it: drawn for the agent, or the one uploaded. */
const avatarSrc = (agent) => `/avatars/${encodeURIComponent(agent.id)}.png?v=${encodeURIComponent(agent.avatarVersion || "")}`;

function avatar(agent, size = "") {
  // A picture Cora drew has its own circle in the agent's colour: the ring is for an uploaded one.
  const drawn = agent.id && !agent.avatarUpload ? " drawn" : "";
  const el = h("span", { class: `avatar${size ? ` ${size}` : ""}${drawn}`, vars: { "--ring": agent.color || "#f2a93b" } });
  if (agent.id) el.append(h("img", { src: avatarSrc(agent), alt: "", loading: "lazy" }));
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
  const content = kind === "quotas"
    ? [h("div", { class: "quota-tabs", "aria-hidden": "true" }, Array.from({ length: 5 }, () => skeletonLine("sk-quota-tab"))),
      h("div", { class: "quota-account-head" }, h("div", { class: "grow stack-sm" }, skeletonLine("sk-label"), skeletonLine("sk-caption"))),
      h("div", { class: "quota-windows" }, Array.from({ length: 2 }, () => h("div", { class: "quota-window" },
        h("div", { class: "quota-window-label" }, skeletonLine("sk-label"), skeletonLine("sk-total")), skeletonLine("sk-quota-meter"), skeletonLine("sk-caption"))))]
    : kind === "heat"
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
function selectedBrainOwner() { return new URLSearchParams(location.hash.split("?")[1] || "").get("ownerId") || ""; }
function brainHref(href) {
  const ownerId = route()[0] === "brain" ? selectedBrainOwner() : "";
  return ownerId && !href.includes("ownerId=") ? href + (href.includes("?") ? "&" : "?") + new URLSearchParams({ ownerId }) : href;
}
async function api(path, { method = "GET", body } = {}) {
  if (path.startsWith("/api/brain") && route()[0] === "brain" && selectedBrainOwner()) path += (path.includes("?") ? "&" : "?") + new URLSearchParams({ ownerId: selectedBrainOwner() });
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

/** The platforms switched on, the primary one (where Cora writes privately to the owner) first. */
function platformsOn() {
  const list = S.data?.transports?.length ? S.data.transports : [S.data?.transport || "discord"];
  return [S.data?.transport, ...list].filter((kind, index, all) => kind && list.includes(kind) && all.indexOf(kind) === index);
}

/** The platforms an agent is on: switched on, and not switched off for it. */
function agentPlatforms(agent) {
  return platformsOn().filter((kind) => !(agent.platformsOff || []).includes(kind));
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
  if (S.quotaPanel?.node.isConnected) S.quotaPanel.apply([...(data.quotaAccounts || data.subscriptions || []), ...(data.providerUsage || [])]);
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

function subscriptionLoginActive() {
  return [...document.querySelectorAll(".accounts"), ...document.querySelectorAll(".account"), ...document.querySelectorAll(".subscription-picker")].some((node) => node.getAttribute("aria-busy") === "true" || node.classList.contains("connecting") || node.getAttribute("data-state") === "connecting" || (node.classList.contains("subscription-picker") && !node.hidden));
}

function refreshSubscriptionViews() {
  for (const node of [...document.querySelectorAll(".accounts"), ...document.querySelectorAll(".subscription-picker")]) node.refreshSubscription?.();
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
    if (entry.type === "agent-owners") {
      const view = location.hash;
      guard(loadState()).then(() => {
        if (location.hash !== view || !S.data) return;
        const [page, id] = route();
        if (page === "agent" && !S.data.agents.some(agent => agent.id === id)) { location.hash = "#/agenti"; renderAgents(); }
        else if (page === "brain") renderBrain();
        else if (page === "thread") renderThreads();
        else if (page === "agenti") renderAgents();
        else document.querySelector(".agent-owner-panel")?.refreshOwners();
      });
      return;
    }
    if (entry.type === "subscriptions") return;
    if (entry.type === "subscription-usage") {
      if (S.quotaPanel?.node.isConnected) void S.quotaPanel.refresh();
      return;
    }
    if (["web-message", "web-typing", "trace"].includes(entry.type)) {
      S.live?.(entry);
      return;
    }
    if (entry.type === "request") {
      guard(loadState()).then(drawRequests);
      return;
    }
    if (entry.type === "mailbox") {
      const agent = S.data?.agents.find((item) => item.id === entry.agentId);
      if (agent) agent.mailbox = entry.mailbox;
      const [page, id, tab] = route();
      if (agent && page === "agent" && id === agent.id) {
        const hero = document.querySelector(".hero:not(.compact) .hero-text");
        if (hero && entry.mailbox?.status === "ready") {
          const link = h("a", { class: "agent-email", href: `#/agent/${agent.id}/email` }, icon("mail"), raw(entry.mailbox.email));
          const previous = hero.querySelector(".agent-email");
          if (previous) previous.replaceWith(link); else hero.append(link);
        }
        if (tab === "email" && !document.activeElement?.matches("input, textarea, select") && !document.querySelector('form[aria-busy="true"]')) renderAgent();
      }
      return;
    }
    if (entry.type === "slack-channels" || entry.type === "telegram-chats") {
      const here = entry.type === "slack-channels" ? route()[1] === "slack" : true;
      if (route()[0] === "settings" && here && !document.activeElement?.matches("input, textarea, select")) {
        const view = location.hash, keepLogin = subscriptionLoginActive();
        guard(loadState()).then(() => {
          if (location.hash !== view) return;
          if (keepLogin) refreshSubscriptionViews(); else renderSettings();
        });
      }
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
  const viewKey = route().join("/");
  const previous = app.querySelector(".content");
  const scroll = S.viewKey === viewKey && previous ? S.scrollTarget || { top: previous.scrollTop, left: previous.scrollLeft } : null;
  S.restoreScroll?.();
  S.viewKey = viewKey;
  clearTimers();
  const [section, current] = route();
  const nav = [
    ["agenti", "Agenti", "users", ["agenti", "agent", "new"].includes(section)],
    // The salotto opens from the Banco: it is one of the desk's rooms, not a section of its own.
    ["banco", "Banco", "grid", section === "banco" || section === "salotto"],
    ["brain", "Brain", "bulb", section === "brain"],
    ["thread", "Thread", "hash", section === "thread"],
    ["artefatti", "Artefatti", "archive", section === "artefatti", S.data?.artifacts?.reviews || 0],
    // Contesto opens from Impostazioni: what the agents read is a setting of the space, not a place of its own.
    ["settings", "Impostazioni", "sliders", section === "settings" || section === "contesto" || section === "domini"],
  ];
  const info = S.data ? transportInfo() : { icon: "radio", label: "Cora", where: tr("Caricamento…") };
  app.replaceChildren(h("div", { class: `app${mode ? ` mode-${mode}` : ""}` },
    h("aside", { class: "sidebar" },
      h("a", { class: "brand", href: "#/" }, h("img", { src: "/assets/icon-192.png", alt: "" }), h("span", {}, h("b", {}, "Cora"), h("small", {}, "agenti residenti"))),
      h("a", { class: "onair-card", href: "#/settings" },
        h("span", { class: "panel-ico" }, icon(info.icon)),
        h("span", { class: "grow" }, h("b", {}, S.data ? platformsOn().map((kind) => TRANSPORTS[kind].label).join(" · ") : info.label), h("small", {}, info.where)),
        lamp()),
      h("nav", { class: "side-nav" }, nav.map(([key, label, name, active, count]) => h("a", { href: `#/${key}`, class: active ? "active" : "" }, icon(name), h("span", {}, label), count ? h("i", { class: "nav-count", title: tr("{count} da rivedere", { count }) }, raw(String(count))) : null))),
      h("div", { class: "side-agents" },
        h("span", { class: "label" }, "Agenti"),
        S.data ? S.data.agents.map((agent) => h("a", { href: `#/agent/${agent.id}/chat`, class: section === "agent" && current === agent.id ? "active" : "" }, avatar(agent, "xs"), h("span", { class: "grow" }, raw(agent.name)), agentDot(agent))) : skeleton("rows"),
        h("a", { href: "#/new", class: section === "new" ? "active" : "" }, h("span", { class: "avatar xs add" }, icon("plus")), h("span", { class: "grow" }, "Nuovo agente"))),
      h("div", { class: "side-account" }, accountButton("side"))),
    h("header", { class: "appbar" },
      back ? h("a", { class: "icon-btn", href: back, "aria-label": "Indietro" }, icon("back")) : h("a", { class: "appbar-brand", href: "#/" }, h("img", { src: "/assets/icon-192.png", alt: "Cora" })),
      h("h1", {}, title),
      accountButton("bar")),
    h("main", { class: "content" }, h("div", { class: "wrap" }, content)),
    h("nav", { class: "tabbar" }, nav.map(([key, label, name, active, count]) => h("a", { href: `#/${key}`, class: active ? "active" : "" }, icon(name), h("span", {}, label), count ? h("i", { class: "nav-count", "aria-label": tr("{count} da rivedere", { count }) }, raw(String(count))) : null)))));
  updateLamp();
  if (scroll?.top || scroll?.left) restoreScroll(scroll);
}

function restoreScroll(position) {
  const content = app.querySelector(".content");
  let observer;
  let timer;
  const cancel = () => {
    observer?.disconnect();
    clearTimeout(timer);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) content.removeEventListener(event, cancel);
    S.restoreScroll = null;
    S.scrollTarget = null;
  };
  const apply = () => {
    content.scrollTop = position.top;
    content.scrollLeft = position.left;
    if (Math.abs(content.scrollTop - position.top) < 2) cancel();
  };
  S.scrollTarget = position;
  S.restoreScroll = cancel;
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) content.addEventListener(event, cancel, { passive: true });
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(apply);
    observer.observe(content, { childList: true, subtree: true });
  }
  timer = setTimeout(cancel, 10000);
  apply();
}

/* ---------- your account ---------- */
/** The signed-in person as a round mark: the picture their sign-in gave, or their initials. */
function userMark(user, size = "") {
  const label = user?.name || user?.email || tr("Owner");
  const initials = label.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const el = h("span", { class: `user-mark${size ? ` ${size}` : ""}`, "aria-hidden": "true" }, initials);
  if (/^https:\/\//.test(user?.avatar || "")) {
    const img = h("img", { src: user.avatar, alt: "", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove());
    el.append(img);
  }
  return el;
}

/** Who is signed in, top right on a phone and at the foot of the sidebar: it opens the account menu. */
function accountButton(where) {
  const user = S.data?.currentUser;
  const open = S.accountMenu?.where === where;
  const trigger = where === "bar"
    ? h("button", { class: "profile-btn", type: "button", "aria-haspopup": "menu", "aria-expanded": String(open), "aria-label": "Il tuo account" }, userMark(user))
    : h("button", { class: "side-identity", type: "button", "aria-haspopup": "menu", "aria-expanded": String(open) }, userMark(user, "sm"),
      h("span", { class: "grow" }, h("b", {}, raw(user?.name || user?.email || tr("Owner"))), h("small", {}, raw(user?.email || tr("Owner")))),
      icon("next", "up"));
  if (open) S.accountMenu.trigger = trigger;
  // A click from the keyboard has no detail: then the menu takes the focus, a pointer leaves it where it is.
  trigger.addEventListener("click", (event) => (S.accountMenu ? closeAccountMenu(true) : openAccountMenu(trigger, where, !event.detail)));
  return trigger;
}

/** The account menu: who you are here, your access, language, and Esci, which asks before signing out. */
function openAccountMenu(trigger, where, byKeyboard = false) {
  closeAccountMenu();
  const user = S.data?.currentUser;
  const go = (hash) => () => { closeAccountMenu(); location.hash = hash; };
  const item = (label, name, onclick, cls = "") => h("button", { class: `profile-item${cls ? ` ${cls}` : ""}`, type: "button", role: "menuitem", onclick }, icon(name), h("span", {}, label));
  const body = h("div", { class: "profile-body" });
  const showMenu = () => {
    body.replaceChildren(
      item("Accesso", "shield", go("#/settings/accesso")),
      item("Lingua e notifiche", "globe", go("#/settings/preferenze")),
      h("hr"),
      item("Esci", "logout", askToLeave, "out"));
    if (byKeyboard) body.querySelector(".profile-item")?.focus?.();
  };
  const askToLeave = () => {
    const stay = btn("Annulla", { cls: "ghost", onclick: showMenu });
    body.replaceChildren(h("div", { class: "profile-confirm", role: "alertdialog", "aria-label": "Vuoi uscire?" },
      h("b", {}, "Vuoi uscire?"),
      h("p", {}, S.cloud ? "Esci anche da usecora.space: per rientrare rifai il login." : "Per rientrare ti servirà di nuovo la password."),
      h("div", { class: "profile-actions" }, stay, btn("Esci", { icon: "logout", cls: "primary", onclick: () => { closeAccountMenu(); logout(); } }))));
    if (byKeyboard) stay.focus?.();
  };
  const menu = h("div", { class: `profile-menu ${where}`, role: "menu", "aria-label": "Il tuo account" },
    h("div", { class: "profile-head" }, userMark(user, "lg"),
      h("div", { class: "grow" }, h("b", {}, raw(user?.name || user?.email || tr("Owner"))), user?.email ? h("small", {}, raw(user.email)) : null),
      badge(user?.role === "member" ? "Utente" : "Owner", "on")),
    body);
  const box = trigger.getBoundingClientRect?.();
  if (box && where === "bar") menu.style.setProperty("--top", `${Math.round(box.bottom + 8)}px`);
  if (box && where === "side") {
    menu.style.setProperty("--left", `${Math.round(box.left)}px`);
    menu.style.setProperty("--bottom", `${Math.round(window.innerHeight - box.top + 8)}px`);
    menu.style.setProperty("--width", `${Math.round(Math.max(box.width, 300))}px`);
  }
  const scrim = h("div", { class: `profile-scrim ${where}`, onclick: () => closeAccountMenu(true) });
  document.body.append(scrim, menu);
  trigger.setAttribute("aria-expanded", "true");
  S.accountMenu = { where, trigger, menu, scrim };
  showMenu();
}

function closeAccountMenu(refocus = false) {
  const open = S.accountMenu;
  if (!open) return;
  S.accountMenu = null;
  open.menu.remove();
  open.scrim.remove();
  open.trigger.setAttribute("aria-expanded", "false");
  if (refocus) open.trigger.focus?.();
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
    out.push(h("a", { class: "banner", href: "#/settings/slack" }, icon("info"), h("span", {}, h("b", {}, "Nessun canale Slack acceso. "), "Invita un'app in un canale: compare qui, già acceso.")));
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

function agentAccount(agent, kind = S.data.transport) {
  if (kind === "slack") return agent.slackBot?.user ? ["App sua", "on"] : ["App principale", ""];
  if (kind === "telegram") return agent.telegramBot?.user ? ["Bot suo", "on"] : ["Bot principale", ""];
  return agent.bot?.user ? ["Bot suo", "on"] : ["Webhook", ""];
}

/** One badge per platform the agent is on, or a single one when it is only in the panel. */
function platformBadges(agent) {
  const kinds = agentPlatforms(agent);
  if (!kinds.length) return [badge("Solo pannello", "", "chat")];
  return kinds.map((kind) => {
    const [account, accountOn] = agentAccount(agent, kind);
    return badge(kinds.length > 1 ? `${TRANSPORTS[kind].label} · ${tr(account)}` : account, accountOn, TRANSPORTS[kind].icon);
  });
}

function agentCard(agent, index) {
  const running = agent.box?.running;
  const monitor = h("a", { class: "monitor", href: `#/agent/${agent.id}/desktop`, "aria-label": tr("Desktop di {name}", { name: agent.name }) });
  if (running) {
    const img = h("img", { alt: "", src: `/api/agents/${agent.id}/box/screenshot?t=${Date.now()}` });
    img.addEventListener("error", () => monitor.replaceChildren(h("span", { class: "dark" }, icon("monitor"), "Segnale assente")));
    monitor.append(img);
  } else monitor.append(h("span", { class: "dark" }, icon("monitor"), agent.tools ? "Desktop spento" : "Senza computer"));
  const routines = S.data.routines.filter((routine) => routine.agentId === agent.id && routine.enabled).length;
  return h("article", { class: `agent-card${agent.enabled ? "" : " off"}`, vars: { "--ring": agent.color || "#f2a93b", "--delay": `${index * 50}ms` } },
    monitor,
    h("a", { class: "agent-ident", href: `#/agent/${agent.id}/chat` },
      avatar(agent),
      h("span", { class: "grow" }, h("b", {}, raw(agent.name)), h("small", { title: modelLabel(agent.model) }, modelLabel(agent.model, { short: true }))),
      icon("next", "chev")),
    h("div", { class: "badges" },
      badge(agent.enabled ? "In onda" : "Muto", agent.enabled ? "on" : "", "radio"),
      badge(running ? "Desktop" : "Spento", running ? "on" : "", "monitor"),
      platformBadges(agent),
      badge(String(routines), routines ? "on" : "", "clock"),
      badge(String(agent.memoryCount), agent.memoryCount ? "on" : "", "book")),
    h("div", { class: "agent-actions" },
      btn("Chat", { icon: "chat", href: `#/agent/${agent.id}/chat`, cls: "sm" }),
      btn("Desktop", { icon: "monitor", href: `#/agent/${agent.id}/desktop`, cls: "sm" }),
      btn("", { icon: "bulb", href: `#/agent/${agent.id}/ragionamento`, cls: "sm", title: "Ragionamento" })));
}

function costLabel(items) {
  const totals = new Map();
  let estimated = false, partial = false;
  for (const item of items) {
    partial ||= Boolean(item.meter?.unpriced || (!item.meter?.costs?.length && /^(deepseek|orcarouter)\//.test(item.model || "")));
    for (const cost of item.meter?.costs || []) {
      const total = totals.get(cost.currency) || { amount: 0, max: 0 };
      total.amount += cost.amount; total.max += cost.maxAmount ?? cost.amount;
      totals.set(cost.currency, total); estimated ||= cost.estimated;
    }
  }
  if (!totals.size) return partial ? tr("Costo non disponibile") : "";
  const money = (amount, currency) => `${amount > 0 && amount < 0.0001 ? "<" : ""}${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount > 0 && amount < 0.0001 ? 0.0001 : amount)} ${currency}`;
  const cost = [...totals].map(([currency, value]) => value.max > value.amount * 1.0000001 ? `${money(value.amount, currency)}–${money(value.max, currency)}` : money(value.amount, currency)).join(" + ");
  return tr(estimated ? "Costo stimato: {cost}" : "Costo: {cost}", { cost }) + (partial ? ` · ${tr("parziale")}` : "");
}

function usageLine(item) {
  const cost = costLabel([item]);
  const steps = item.meter?.modelSteps;
  const sources = [...new Set((item.meter?.costs || []).filter((cost) => cost.estimated).map((cost) => `${cost.source} (${cost.version})`))];
  return h("span", { class: "row-usage" },
    steps !== null && steps !== undefined ? h("span", {}, raw(`${item.meter?.unknownModelSteps ? "≥ " : ""}${tr(steps === 1 ? "1 passaggio del modello" : "{count} passaggi del modello", { count: steps })}`)) : null,
    cost ? h("span", { class: "usage-cost", title: sources.length ? tr("Stima dalle tariffe pubblicate. Un intervallo include le possibili fasce orarie; gli addebiti definitivi sono nel provider.") + " " + sources.join(", ") : undefined }, raw(cost)) : null);
}

function traceRow(trace, { withAgent = false } = {}) {
  const agent = S.data.agents.find((item) => item.id === trace.agentId);
  const [label, cls] = TRACE_STATUS[trace.status] || [trace.status, ""];
  const total = (trace.tokensIn || 0) + (trace.tokensOut || 0);
  const lead = withAgent && agent
    ? avatar(agent, "sm")
    : h("span", { class: "goal-total" }, h("b", {}, total ? shortTokens(total) : "—"), h("small", {}, "token"));
  const spent = total ? `${tr("{in} in · {out} out", { in: shortTokens(trace.tokensIn || 0), out: shortTokens(trace.tokensOut || 0) })} · ` : "";
  return h("a", { class: "row-link", href: `#/agent/${trace.agentId}/ragionamento/${trace.id}` },
    lead,
    h("span", { class: "grow" },
      h("span", { class: "row-meta" }, withAgent && agent ? h("b", {}, raw(agent.name)) : null, tag(TRACE_KIND[trace.kind] || trace.kind), tag(label, cls), raw(`${spent}${traceWhere(trace)} · ${fmtTime(trace.startedAt, true)} · ${duration(trace)}`)),
      usageLine(trace),
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
    pageHead(h("span", {}, "Co", h("em", {}, "ra")), platformsOn().length > 1 ? tr("Vive su {transports}.", { transports: platformsOn().map((kind) => TRANSPORTS[kind].label).join(", ") }) : tr("Vive su {transport}: {where}.", { transport: info.label, where: tr(info.where) }), [btn("Archivio", { icon: "book", href: "#/archivio" }), btn("Salotto", { icon: "chat", href: "#/salotto" }), btn("Nuovo agente", { icon: "plus", href: "#/new", cls: "primary" })]),
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

function quotaAgents(record) {
  return S.data.agents.filter((agent) => String(agent.model || S.data.settings?.defaultModel || "").startsWith(`${record.provider}/`)
    && (record.server || agent.subscriptionId === record.id || (record.resident && !agent.subscriptionId)));
}

function quotaAccounts() {
  return [...new Map([...(S.data.quotaAccounts || S.data.subscriptions || []), ...(S.data.providerUsage || [])].map((record) => [record.id, record])).values()]
    .filter((record) => record.status === "ready" && record.installed !== false && record.usage?.issue !== "AUTH_REQUIRED"
      && (!record.resident || S.data.settings?.useResidentSubscriptions) && quotaAgents(record).length);
}

function quotaSignature(records) {
  return JSON.stringify([S.data.currentUser?.id, records.map(({ id, provider, label, email }) => [id, provider, label, email]), S.data.agents.map(({ id, name, model, subscriptionId }) => [id, name, model, subscriptionId])]);
}

function subscriptionUsagePanel() {
  const records = quotaAccounts(), signature = quotaSignature(records);
  if (!records.length) { S.quotaPanel = null; return { node: null, start: () => {} }; }
  if (S.quotaPanel?.signature === signature) { S.quotaPanel.apply(records); return S.quotaPanel; }
  const body = h("div", { class: "quota-accounts" });
  const tabs = h("div", { class: "quota-tabs", role: "tablist", "aria-label": "Abbonamenti" });
  const slots = new Map(), snapshots = new Map(), buttons = new Map();
  const labels = { claude: "Claude", codex: "ChatGPT", gemini: "Gemini", grok: "Grok", muse: "Muse", ollama: "Ollama", deepseek: "DeepSeek" };
  const names = { ...SUBSCRIPTION_NAMES, ollama: "Ollama Cloud", deepseek: "DeepSeek API" };
  const date = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const foot = (data) => [h("span", {}, data.fetchedAt ? tr("Lettura {date}", { date: date(data.fetchedAt) }) : tr("Nessuna lettura disponibile")),
    data.nextCheckAt ? h("span", {}, tr("Prossima verifica {date}", { date: date(data.nextCheckAt) })) : null].filter(Boolean);
  const paint = (record, data) => {
    const previous = snapshots.get(record.id);
    if (snapshots.has(record.id) && JSON.stringify(snapshots.get(record.id)) === JSON.stringify(data)) return;
    snapshots.set(record.id, data);
    const slot = slots.get(record.id), windows = data?.windows || [], balances = data?.balances || [];
    if (previous && data && ["windows", "balances", "state", "issue", "stale"].every((key) => JSON.stringify(previous[key]) === JSON.stringify(data[key]))) {
      slot.querySelector(".quota-foot")?.replaceChildren(...foot(data));
      return;
    }
    const loading = !data || data.state === "loading";
    const issues = { connecting: "Collegamento in corso…", AUTH_REQUIRED: "Accesso da verificare in Impostazioni.", RATE_LIMITED: "Il provider richiede una pausa prima della prossima lettura.", "no-data": "Il provider non ha restituito le percentuali.", unavailable: "Consumi temporaneamente non disponibili.", UNSUPPORTED: "Questo account non espone le percentuali." };
    const stale = data?.stale || windows.some((item) => item.resetsAt && Date.parse(item.resetsAt) <= Date.now());
    const state = loading ? h("div", { class: "quota-status", role: "status" }, h("span", { class: "subscription-spinner", "aria-hidden": "true" }), "Lettura delle quote…")
      : data.state !== "ready" || stale ? h("p", { class: "quota-status muted", role: "status" }, issues[data.issue] || (stale ? "Ultima lettura; in attesa di aggiornamento." : "In attesa del servizio quote.")) : null;
    const assigned = quotaAgents(record);
    slot.setAttribute("aria-busy", loading ? "true" : "false");
    slot.replaceChildren(...[
      h("header", { class: "quota-account-head" },
        h("div", { class: "grow" }, h("h3", {}, raw(record.label || names[record.provider])),
          h("p", {}, raw(record.email || names[record.provider]), assigned.length ? raw(` · ${assigned.map((agent) => agent.name).join(", ")}`) : null)),
        badge(record.server ? tr("Account dello spazio") : assigned.length === 1 ? tr("1 agente") : tr("{count} agenti", { count: assigned.length }))),
      windows.length ? h("div", { class: `quota-windows${stale ? " stale" : ""}` }, windows.map((item) => {
        const available = 100 - Math.min(100, Math.max(0, Number(item.usedPercent) || 0));
        const label = item.kind === "weekly" ? tr("Settimana") : item.kind === "monthly" ? tr("Mese") : item.kind === "session" ? tr("Sessione · 5 ore") : tr("Finestra · {minutes} min", { minutes: item.minutes || "—" });
        const percent = `${available.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%`;
        return h("div", { class: `quota-window${available <= 0 ? " exhausted" : available <= 20 ? " low" : ""}` },
          h("div", { class: "quota-window-label" }, h("span", {}, item.group ? raw(item.group) : record.provider === "gemini" ? "Gemini" : tr("Tutti i modelli")), h("strong", {}, raw(percent), h("small", {}, "disponibile"))),
          h("progress", { class: "quota-meter", value: available, max: 100, "aria-label": tr("{model} · {window}: {percent} disponibile", { model: item.group || names[record.provider], window: label, percent }) }),
          h("div", { class: "quota-window-meta" }, h("span", {}, label), h("span", { title: item.resetsAt || "" }, item.resetsAt ? tr("Reset {date}", { date: date(item.resetsAt) }) : tr("Reset non disponibile"))));
      })) : null,
      balances.length ? h("div", { class: "quota-balances" }, balances.map((item) => {
        const label = { total: "Saldo disponibile", granted: "Bonus", "topped-up": "Ricariche", included: "Credito incluso", allowance: "Plafond mensile", purchased: "Credito acquistato" }[item.kind];
        return h("div", { class: `quota-balance${item.kind === "total" && Number(item.amount) <= 0 ? " empty" : ""}` }, h("span", {}, label),
          h("strong", {}, raw(Number(item.amount).toLocaleString(LOCALE, { style: "currency", currency: item.currency, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 6 }))));
      })) : null, state,
      data ? h("footer", { class: "quota-foot" }, foot(data)) : null].filter(Boolean));
  };
  const select = (id) => {
    S.quotaAccount = id;
    for (const [key, slot] of slots) { slot.hidden = key !== id; buttons.get(key).classList.toggle("active", key === id); buttons.get(key).setAttribute("aria-selected", key === id ? "true" : "false"); buttons.get(key).setAttribute("tabindex", key === id ? "0" : "-1"); }
    if (tabs.scrollWidth > tabs.clientWidth) requestAnimationFrame(() => revealSelection(tabs));
  };
  for (const record of records) {
    const title = `${labels[record.provider]} · ${record.label}${record.email ? ` · ${record.email}` : ""}`;
    const duplicates = records.filter((item) => item.provider === record.provider);
    const identity = duplicates.length > 1 ? record.email || record.label : "";
    const button = h("button", { class: "quota-tab", type: "button", role: "tab", id: `quota-tab-${record.id}`, "aria-controls": `quota-${record.id}`, "aria-label": title, title,
      onclick: () => select(record.id), onkeydown: (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const at = records.findIndex((item) => item.id === record.id), next = event.key === "Home" ? 0 : event.key === "End" ? records.length - 1 : (at + (event.key === "ArrowLeft" ? -1 : 1) + records.length) % records.length;
        select(records[next].id); buttons.get(records[next].id).focus();
      } }, icon(SUBSCRIPTION_ICONS[record.provider] || (record.provider === "ollama" ? "globe" : "chip")),
      h("span", { class: "quota-tab-label" }, h("span", {}, raw(labels[record.provider])), identity ? h("small", { class: "quota-tab-account" }, raw(identity)) : null));
    const slot = h("article", { class: "quota-account", id: `quota-${record.id}`, role: "tabpanel", "aria-labelledby": `quota-tab-${record.id}`, "data-subscription": record.id });
    slots.set(record.id, slot); buttons.set(record.id, button); body.append(slot); tabs.append(button); paint(record, record.usage);
  }
  if (records.length) select(records.some((record) => record.id === S.quotaAccount) ? S.quotaAccount : records[0].id);
  else body.append(empty("chart", "Nessun abbonamento attivo.", btn("Collega un account", { href: "#/impostazioni/collegamenti" })));
  let pending = null, requested = false, checkedAt = 0;
  const update = () => {
    if (!body.isConnected || !records.length) return Promise.resolve();
    requested = true;
    if (pending) return pending;
    pending = (async () => {
      do {
        requested = false; checkedAt = Date.now();
        await Promise.all(records.map(async (record) => {
          try { const data = await api(record.server ? `/api/providers/${record.provider}/usage` : `/api/subscriptions/${record.id}/usage`); if (body.isConnected) { const current = [...(S.data.quotaAccounts || S.data.subscriptions || []), ...(S.data.providerUsage || [])].find((item) => item.id === record.id); if (current) current.usage = data; paint(record, data); } }
          catch { if (body.isConnected) paint(record, { ...snapshots.get(record.id), state: "error", issue: "unavailable", stale: true }); }
        }));
      } while (requested && body.isConnected);
    })().finally(() => { pending = null; if (body.isConnected && quotaSignature(quotaAccounts()) !== signature) renderAgents(); });
    return pending;
  };
  const node = panel({ icon: "chart", title: "Quote e saldi", hint: "Aggiornamento ogni minuto.", cls: "subscription-usage" }, records.length ? tabs : null, body);
  node.refreshQuota = update;
  S.quotaPanel = { signature, node, refresh: update, apply: (updated) => {
    if (node.isConnected && quotaSignature(quotaAccounts()) !== signature) { renderAgents(); return; }
    for (const record of updated) if (slots.has(record.id)) paint(record, record.usage);
  },
    start: () => { if (Date.now() - checkedAt >= 60000) void update(); if (tabs.scrollWidth > tabs.clientWidth) requestAnimationFrame(() => revealSelection(tabs)); S.timers.push(setInterval(update, 60000)); } };
  return S.quotaPanel;
}

function usageOverviewMode() {
  if (S.usageView) return S.usageView;
  try { return localStorage.getItem("cora.usageView") === "quotas" ? "quotas" : "usage"; } catch { return "usage"; }
}

function usageOverview(usage, subscriptions) {
  const global = panel({ icon: "chart", title: "Consumi globali", hint: "Tutti gli agenti, giorno per giorno.", actions: heatLegend() }, usage.global);
  const quotas = subscriptions.node;
  const root = h("div", { class: "usage-overview" }, global, quotas);
  if (!quotas) return root;
  const switches = [global, quotas].map((node) => {
    let actions = node.querySelector(".panel-actions");
    if (!actions) { actions = h("div", { class: "panel-actions" }); node.querySelector(".panel-head").append(actions); }
    actions.querySelector(".usage-toggle")?.remove();
    const button = btn("", { icon: "swap", cls: "ghost usage-toggle", title: "Alterna consumi e quote", onclick: () => {
      S.usageView = global.hidden ? "usage" : "quotas";
      try { localStorage.setItem("cora.usageView", S.usageView); } catch {}
      select(); switches[global.hidden ? 1 : 0].focus({ preventScroll: true });
    } });
    actions.append(button); return button;
  });
  const select = () => {
    const showQuotas = usageOverviewMode() === "quotas";
    global.hidden = showQuotas; quotas.hidden = !showQuotas;
    for (const button of switches) {
      button.setAttribute("aria-pressed", String(showQuotas));
      button.setAttribute("title", tr(showQuotas ? "Mostra consumi globali" : "Mostra quote e saldi"));
    }
    const rail = quotas.querySelector(".quota-tabs");
    if (showQuotas && rail.scrollWidth > rail.clientWidth) requestAnimationFrame(() => revealSelection(rail));
  };
  select(); return root;
}

function renderAgents() {
  const agents = S.data.agents;
  const usage = usagePanels(agents);
  const subscriptions = subscriptionUsagePanel();
  const heading = pageHead("Agenti"); heading.classList.add("agents-page-head");
  shell([
    heading,
    requestsStrip(),
    usageOverview(usage, subscriptions),
    panel({ icon: "users", title: "Gli agenti", cls: "agent-roster", actions: btn("Nuovo agente", { icon: "plus", href: "#/new", cls: "primary", title: "Nuovo agente" }) },
      agents.length ? h("div", { class: "rows" }, agents.map((agent) => {
        // One platform: how it writes there; several: where it is.
        const kinds = agentPlatforms(agent);
        const account = kinds.length === 1 ? tr(agentAccount(agent, kinds[0])[0]) : kinds.length ? kinds.map((kind) => TRANSPORTS[kind].label).join(" + ") : tr("Solo pannello");
        return h("a", { class: "row-link", href: `#/agent/${agent.id}/chat` },
          avatar(agent),
          h("span", { class: "grow" },
            h("span", { class: "row-title" }, raw(agent.name), agentDot(agent)),
            h("span", { class: "row-meta" }, `${modelLabel(agent.model, { short: true })} · ${tr(agent.box?.running ? "desktop acceso" : "desktop spento")} · ${account.toLowerCase()}`)),
          icon("next", "chev"));
      })) : empty("users", "Ancora nessun agente.", btn("Crea il primo", { icon: "plus", href: "#/new", cls: "primary" }))),
    panel({ icon: "chart", title: "Consumi per agente", hint: "Quanti token spende ognuno, giorno per giorno.", actions: heatLegend() }, usage.individual),
  ], { title: "Agenti" });
  subscriptions.start();
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
  grok: "Grok Build non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  muse: "Muse Code non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  gemini: "Antigravity CLI non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  hermes: "Hermes non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  deepseek: "DeepSeek Harness ha bisogno di dsh sul server (npm i -g @deepseek-ai/dsh) e di una chiave DeepSeek: la tua, oppure quella dello space in Impostazioni → DeepSeek.",
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
// Hermes turns away a model that holds less than this; the server says the same in the list.
const HERMES_MIN_CONTEXT = 64000;
const HERMES_TOO_SHORT = "troppo poco contesto per Hermes, che ne vuole almeno 64K";

/** The harnesses that run on someone's subscription: the account is part of the choice. */
const SUBSCRIPTION_HARNESSES = ["claude", "codex", "grok", "muse", "gemini"];

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

/** Hermes on a keyed endpoint: `hermes/ollama/<model>` or `hermes/deepseek/<model>`. */
function hermesBackendOf(model) {
  const parts = String(model || "").split("/");
  if (parts[0] !== "hermes" || parts.length < 3) return "";
  return parts[1] === "ollama" || parts[1] === "deepseek" ? parts[1] : "";
}

/** The key a model id needs: a keyed Hermes end, or DeepSeek Harness itself. */
function keyBackendOf(model) {
  const parts = String(model || "").split("/");
  if (parts[0] === "hermes") return hermesBackendOf(model);
  return parts[0] === "deepseek" ? "deepseek" : "";
}

function hermesPlaceOf(id) {
  const backend = hermesBackendOf(id);
  if (backend) return backend;
  const rest = String(id || "").split("/").slice(1).join("/");
  if (rest.startsWith("orcarouter/")) return "orcarouter";
  const known = (S.data.models || []).find((item) => item.id === id);
  if (known?.provider === "hermes" && known.local === false) return "ollama";
  return "local";
}

const HERMES_PLACES = {
  local: ["Su questa macchina", "I pesi stanno qui: niente esce, e la scheda decide la velocità.", "chip"],
  ollama: ["Ollama Cloud", "I modelli cloud di Ollama, con la tua chiave o quella dello space.", "layers"],
  deepseek: ["DeepSeek", "I modelli DeepSeek, con la tua chiave o quella dello space.", "spark"],
  orcarouter: ["OrcaRouter", "I modelli del router, con la chiave dello space.", "swap"],
};

function brainPanel(agent) {
  const fallback = S.data.settings.defaultModel || "";
  let harness = harnessOf(agent.model || fallback);
  let place = "";
  let chosen = agent.model || "";
  let hardware = null;
  let problem = "";
  // "" is the space key. A key_* id is the person's own key for that endpoint.
  // null means the person has not chosen yet: their own key if they have one, otherwise the space key.
  const keyChoice = { ollama: null, deepseek: null };
  const startedOn = keyBackendOf(agent.model);
  if (startedOn) keyChoice[startedOn] = agent.credentialId || "";
  const remoteModels = { ollama: [], deepseek: [] };
  const remoteStamp = { ollama: "", deepseek: "" };
  let remoteNote = "";
  let draftSecret = "";
  let draftLabel = "";
  const modelInput = h("input", { type: "hidden", name: "model", value: chosen });
  const hostInput = h("input", { type: "hidden", name: "ollamaHost", value: agent.ollamaHost || "" });
  const custom = h("input", {
    type: "text", name: "modelCustom", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    placeholder: "provider/modello, es. orcarouter/deepseek/deepseek-v4.1-flash",
  });
  const subscription = subscriptionPicker(agent.subscriptionId);
  const harnessInput = h("select", { "aria-label": "Harness" });
  const harnessHint = h("small", { class: "muted" });
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
    drawHarness();
    drawRight();
  };
  harnessInput.addEventListener("change", () => chooseHarness(harnessInput.value));

  function drawHarness() {
    harnessInput.replaceChildren(...Object.entries(HARNESSES).map(([key, item]) => {
      const ready = harnessReady(key);
      const status = ready ? "" : tr("non installato");
      return h("option", { value: key, selected: key === harness }, raw(tr(item.label) + (status ? ` · ${status}` : "")));
    }));
    harnessInput.value = harness;
    harnessHint.textContent = tr(HARNESSES[harness].hint);
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
      const short = harness === "hermes" && model.context > 0 && model.context < HERMES_MIN_CONTEXT;
      return modelRow({ id, label: model.name, tools: model.tools, vision: model.vision, ...(short ? { usable: false, reason: HERMES_TOO_SHORT } : {}) }, {
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


  function resolveKey(backend) {
    if (keyChoice[backend] !== null && keyChoice[backend] !== undefined) return keyChoice[backend];
    const mine = (S.data.credentials || []).filter((item) => item.provider === backend);
    return mine.length ? mine[0].id : "";
  }

  function credentialFor(modelId) {
    const backend = keyBackendOf(modelId);
    return backend ? resolveKey(backend) : "";
  }

  function hermesKeyProblem(modelId) {
    const backend = keyBackendOf(modelId);
    if (!backend) return "";
    const cred = resolveKey(backend);
    if (cred) {
      const own = (S.data.credentials || []).find((item) => item.id === cred && item.provider === backend);
      return own ? "" : tr("Questa chiave non è tua, o non va con questo provider.");
    }
    return S.data.keys?.[backend] ? "" : tr("Aggiungi la tua chiave, oppure configura quella dello space.");
  }

  function ensureRemote(backend) {
    const cred = resolveKey(backend);
    const stamp = `${backend}:${cred}`;
    if (remoteStamp[backend] === stamp) return;
    remoteStamp[backend] = stamp;
    // No key at all: the rows already say so, there is nothing to ask the endpoint.
    if (!cred && !S.data.keys?.[backend]) { remoteModels[backend] = []; remoteNote = ""; return; }
    const path = cred ? `/api/credentials/${cred}/models` : `/api/hermes/models?backend=${backend}`;
    api(path).then((data) => {
      if (remoteStamp[backend] !== stamp) return;
      remoteModels[backend] = data.models || [];
      remoteNote = "";
      if (place === backend) drawRight();
    }).catch((error) => {
      if (remoteStamp[backend] !== stamp) return;
      remoteModels[backend] = [];
      remoteNote = error.message || "";
      if (place === backend && document.activeElement?.tagName !== "INPUT") drawRight();
    });
  }

  function keyBox(backend) {
    const spaceOn = Boolean(S.data.keys?.[backend]);
    const mine = (S.data.credentials || []).filter((item) => item.provider === backend);
    const selected = resolveKey(backend);
    const chooseSpace = () => { keyChoice[backend] = ""; remoteStamp[backend] = ""; drawRight(); };
    const chooseOwn = (id) => { keyChoice[backend] = id; remoteStamp[backend] = ""; drawRight(); };
    const spaceChosen = !selected && spaceOn;
    const spaceRow = h("button", {
      type: "button", class: `row-link hermes-key${spaceChosen ? " on" : ""}`, role: "radio", "aria-checked": String(spaceChosen),
      disabled: !spaceOn, onclick: spaceOn ? chooseSpace : undefined,
    }, h("span", { class: "hermes-key-dot", "aria-hidden": "true" }), h("span", { class: "hermes-key-text" },
      h("span", { class: "hermes-key-name" }, "Chiave dello space"),
      h("span", { class: "hermes-key-meta" }, spaceOn ? "pronta in Impostazioni" : "non configurata")));
    const ownRows = mine.map((item) => {
      const on = selected === item.id;
      return h("button", {
        type: "button", class: `row-link hermes-key${on ? " on" : ""}`, role: "radio", "aria-checked": String(on),
        onclick: () => chooseOwn(item.id),
      }, h("span", { class: "hermes-key-dot", "aria-hidden": "true" }), h("span", { class: "hermes-key-text" },
        h("span", { class: "hermes-key-name" }, raw(item.label || tr("La tua chiave"))),
        h("span", { class: "hermes-key-meta" }, tr("La tua chiave"), " · ", raw(`···${item.last4 || ""}`))));
    });
    const secret = h("input", {
      type: "password", autocomplete: "new-password", autocapitalize: "off", spellcheck: "false",
      placeholder: "Incolla la chiave API", value: draftSecret, "aria-label": "La tua chiave API",
    });
    secret.addEventListener("input", () => { draftSecret = secret.value; });
    const label = h("input", {
      type: "text", autocomplete: "off", placeholder: "Nome, se ti serve", value: draftLabel, "aria-label": "Nome della chiave",
    });
    label.addEventListener("input", () => { draftLabel = label.value; });
    const add = btn("Aggiungi la tua chiave", { icon: "plus", cls: "sm", onclick: async () => {
      const value = draftSecret.trim();
      if (!value) return;
      const record = await guard(api("/api/credentials", { method: "POST", body: { provider: backend, secret: value, label: draftLabel.trim() } }));
      if (!record) return;
      draftSecret = "";
      draftLabel = "";
      const { models, ...saved } = record;
      S.data.credentials = [...(S.data.credentials || []).filter((item) => item.id !== saved.id), saved];
      keyChoice[backend] = saved.id;
      remoteModels[backend] = models || [];
      remoteStamp[backend] = `${backend}:${saved.id}`;
      remoteNote = "";
      drawRight();
    } });
    const remove = selected ? btn("Rimuovi", { icon: "trash", cls: "ghost sm", onclick: async () => {
      if (!await guard(api(`/api/credentials/${selected}`, { method: "DELETE" }), "Chiave rimossa")) return;
      S.data.credentials = (S.data.credentials || []).filter((item) => item.id !== selected);
      keyChoice[backend] = "";
      remoteStamp[backend] = "";
      drawRight();
    } }) : null;
    const form = h("div", { class: "stack-sm hermes-key-form" }, h("div", { class: "input-row hermes-key-add" }, secret, label), h("div", { class: "row" }, add));
    const hasKey = spaceOn || mine.length > 0;
    return h("div", { class: "stack-sm hermes-keys" },
      h("div", { class: "hermes-keys-head" }, h("span", { class: "label" }, "Chiave"), remove),
      h("div", { class: "hermes-key-list", role: "radiogroup", "aria-label": "Chiave" }, spaceRow, ...ownRows),
      hasKey ? h("details", { class: "brain-custom", ...(draftSecret ? { open: "" } : {}) }, h("summary", {}, tr("Aggiungi la tua chiave")), form) : form);
  }

  function keyedSide(backend) {
    ensureRemote(backend);
    const known = (S.data.models || []).filter((model) => model.provider === "hermes" && (model.id.startsWith(`hermes/${backend}/`) || model.backend === backend));
    const extra = (remoteModels[backend] || []).flatMap((model) => {
      const id = `hermes/${backend}/${model.name}`;
      if (!model.name || known.some((item) => item.id === id)) return [];
      return [{ id, label: model.label || model.name, tools: true, via: backend === "deepseek" ? "DeepSeek" : "Ollama Cloud" }];
    });
    const rows = [...known, ...extra];
    if (chosen && hermesPlaceOf(chosen) === backend && !rows.some((model) => model.id === chosen)) {
      rows.unshift({ id: chosen, label: chosen.split("/").slice(2).join("/") || chosen, tools: true });
    }
    const out = [keyBox(backend)];
    if (remoteNote) out.push(h("p", { class: "notice warn", role: "status" }, icon("alert"), h("span", {}, tr(remoteNote))));
    out.push(rows.length
      ? h("div", { class: "rows", role: "radiogroup", "aria-label": "Modello" }, ...rows.map((model) => modelRow(model, {
        subtitle: tr(model.via || (backend === "deepseek" ? "DeepSeek" : "Ollama Cloud")),
        selected: model.id === chosen,
      })))
      : h("small", { class: "muted" }, backend === "deepseek" ? "I modelli compaiono appena la chiave risponde." : "Scrivi il nome del modello, oppure aspetta l'elenco della chiave."));
    const typed = h("input", {
      type: "text", class: "hermes-model-name", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
      placeholder: backend === "deepseek" ? "deepseek-flash" : "qwen3-coder:480b", "aria-label": "Nome del modello",
    });
    const useTyped = () => {
      const name = typed.value.trim();
      if (!name || /[\s/]/.test(name)) {
        problem = tr("Il nome del modello non ha spazi né barre.");
        drawRight();
        return;
      }
      pick(`hermes/${backend}/${name}`);
    };
    const typedRow = h("div", { class: "input-row hermes-typed" }, typed, btn("Usa questo nome", { icon: "check", cls: "sm", onclick: useTyped }));
    out.push(rows.length ? h("details", { class: "brain-custom" }, h("summary", {}, tr("Un modello che non è in elenco")), h("div", { class: "stack-sm" }, typedRow)) : typedRow);
    return out;
  }

  function routerSide() {
    const models = (S.data.models || []).filter((model) => String(model.id).startsWith("hermes/orcarouter/"));
    if (!models.length) return [h("small", { class: "muted" }, "Nessun modello del router.")];
    return [h("div", { class: "rows", role: "radiogroup", "aria-label": "Modello" }, ...models.map((model) => modelRow(model, {
      subtitle: tr(model.via || "OrcaRouter"), selected: model.id === chosen,
    })))];
  }

  function drawRight() {
    const out = [];
    if (!harnessReady(harness)) {
      // Nothing to choose until the harness exists: no list, no default, no free-text id.
      out.push(h("div", { class: "notice warn" }, icon("alert"), h("div", { class: "stack-sm" },
        ...harnessMissing(harness).map((line) => h("span", {}, raw(line))),
        SUBSCRIPTION_HARNESSES.includes(harness)
          ? h("span", { class: "muted" }, tr("Dopo l'installazione l'account si collega qui, o in Impostazioni → Abbonamenti."))
          : null)));
      right.replaceChildren(...out);
      return;
    }
    if (harness === "hermes") {
      const ends = ["local", "ollama", "deepseek"];
      if ((S.data.models || []).some((model) => String(model.id).startsWith("hermes/orcarouter/"))) ends.push("orcarouter");
      if (!ends.includes(place)) place = ends.includes(hermesPlaceOf(chosen || fallback)) ? hermesPlaceOf(chosen || fallback) : "local";
      const switcher = h("div", { class: `segmented hermes-places${ends.length > 3 ? " four" : ""}`, role: "tablist", "aria-label": "Dove gira Hermes" });
      for (const key of ends) {
        switcher.append(h("button", {
          type: "button", role: "tab", class: `hermes-end${place === key ? " on" : ""}`, "aria-selected": String(place === key),
          onclick: () => { place = key; problem = ""; drawRight(); },
        }, icon(HERMES_PLACES[key][2]), h("span", {}, tr(HERMES_PLACES[key][0]))));
      }
      out.push(h("div", { class: "field" }, h("span", { class: "label" }, "Dove gira"), switcher, h("small", {}, tr(HERMES_PLACES[place][1]))));
    } else {
      const places = placesOf(harness);
      if (!place || !places.includes(place)) place = places.includes(placeOfModel(chosen || fallback)) ? placeOfModel(chosen || fallback) : places[0] || "cloud";
      if (SUBSCRIPTION_HARNESSES.includes(harness)) out.push(subscription.node);
      if (places.length > 1) {
        const switcher = h("div", { class: "segmented", role: "tablist", "aria-label": "Dove gira il modello" });
        for (const key of places) {
          switcher.append(h("button", {
            type: "button", role: "tab", class: place === key ? "on" : "", "aria-selected": String(place === key),
            onclick: () => { place = key; problem = ""; drawRight(); },
          }, tr(PLACES[key][0])));
        }
        out.push(h("div", { class: "field" }, h("span", { class: "label" }, "Dove gira"), switcher, h("small", {}, tr(PLACES[place][1]))));
      } else if (places.length === 1 && !SUBSCRIPTION_HARNESSES.includes(harness)) {
        out.push(h("small", { class: "muted" }, tr(PLACES[places[0]][1])));
      }
    }

    if (problem) out.push(h("p", { class: "notice warn", role: "alert" }, icon("alert"), h("span", {}, problem)));
    if (harness === "deepseek") out.push(keyBox("deepseek"), ...cloudSide());
    else if (harness === "hermes" && place === "ollama") out.push(...keyedSide("ollama"));
    else if (harness === "hermes" && place === "deepseek") out.push(...keyedSide("deepseek"));
    else if (harness === "hermes" && place === "orcarouter") out.push(...routerSide());
    else out.push(...(place === "local" ? localSide() : cloudSide()));
    const keyedHermes = harness === "hermes" && (place === "ollama" || place === "deepseek");
    if (!keyedHermes || custom.value.trim()) out.push(h("details", { class: "brain-custom" }, h("summary", {}, tr("Scrivi tu l'id del modello")),
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
    else problem = hermesKeyProblem(typed || chosen);
    if (problem) { drawRight(); toast(problem, true); right.scrollIntoView({ block: "center", behavior: "smooth" }); return false; }
    return subscription.validate();
  };

  subscription.setProvider(SUBSCRIPTION_HARNESSES.includes(harness) && harnessReady(harness) ? harness : "");
  drawHarness();
  drawRight();
  loadHardware();

  const node = h("div", { class: "brain" },
      setRows(setRow("Harness", "Chi guida il modello e gli passa gli strumenti.", h("div", { class: "stack-sm brain-harness" }, harnessInput, harnessHint), { stack: true })),
      h("div", { class: "stack-sm" }, h("span", { class: "label" }, "Modello"), right),
      modelInput, hostInput);
  node.refreshModels = () => {
    if (harness !== "gemini") return;
    if (!chosen) { chosen = opening(harness) || ""; modelInput.value = chosen; place = "cloud"; }
    drawHarness();
    drawRight();
  };
  return {
    node,
    validate,
    subscriptionId: () => subscription.value(),
    credentialId: () => credentialFor(custom.value.trim() || chosen),
  };
}

/** How long an agent thinks before it answers: the same four levels wherever it is chosen. */
function effortSelect(agent) {
  return h("select", { name: "effort", "aria-label": tr("Ragionamento") },
    [["", "Automatico"], ["low", "Basso"], ["medium", "Medio"], ["high", "Alto"]].map(([value, label]) =>
      h("option", { value, selected: (agent.effort || (agent.think ? "high" : "")) === value }, label)));
}

function brainTab(agent) {
  const brain = brainPanel(agent);
  const model = panel({ icon: "chip", title: "Modello e account", hint: "Chi guida il ciclo, dove gira il modello e quale." }, brain.node);
  const reasoning = panel({ icon: "spark", title: "Ragionamento" }, setRows(
    setRow("Ragionamento", "Quanto pensa prima di rispondere: più alto è più accurato ma più lento.", effortSelect(agent))));
  const computer = panel({ icon: "monitor", title: "Computer" }, setRows(
    setRow("Usa il suo computer", "Un desktop Linux tutto suo, che vedi anche tu.", switchInput("tools", "", agent.tools ?? true))));
  const form = h("form", { id: `agent-brain-${agent.id}`, class: "agent-settings-save" },
    h("div", { class: "savebar" }, h("span", { class: "spacer" }), btn("Salva", { icon: "check", type: "submit", cls: "primary" })));
  for (const pane of [model, reasoning, computer]) {
    for (const input of pane.querySelectorAll("input, select, textarea")) input.setAttribute("form", form.id);
  }
  const workspace = sectionWorkspace({ title: "Cervello", base: `#/agent/${agent.id}/cervello`, current: route()[3], entries: [
    ["modello", "Modello e account", "chip", "Harness, modello e abbonamento", [model]],
    ["ragionamento", "Ragionamento", "spark", "Quanto pensa prima di rispondere", [reasoning]],
    ["computer", "Computer", "monitor", "Desktop e strumenti", [computer]],
  ] });
  workspace.querySelector(".email-workspace-detail").append(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!brain.validate()) { workspace.selectSection("modello"); return; }
    const data = new FormData(form);
    const body = {
      model: pickedModel(data, "model"),
      ollamaHost: data.get("ollamaHost") || "",
      subscriptionId: brain.subscriptionId(),
      credentialId: brain.credentialId(),
      tools: form.elements.tools.checked,
      effort: data.get("effort"),
      think: false,
    };
    if (!await guard(api(`/api/agents/${agent.id}`, { method: "PUT", body }), "Salvato")) return;
    await loadState();
    renderAgent();
  });
  return workspace;
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

/**
 * Which account a librarian model runs on: a subscription for the CLIs, a key for
 * DeepSeek and Hermes, nothing to choose for the others.
 */
function brainAccountSelect(modelId, { subscriptionId = "", credentialId = "" } = {}, label = "Account") {
  const provider = String(modelId || "").split("/")[0];
  const backend = keyBackendOf(modelId);
  if (CLI_NAMES[provider]) {
    const all = (S.data.subscriptions || []).filter((item) => item.provider === provider);
    const resident = all.find((item) => item.resident);
    const options = [h("option", { value: "", selected: !subscriptionId }, raw(`${tr("Account del server")}${resident ? ` · ${tr(SUBSCRIPTION_STATES[resident.status] || resident.status)}` : ""}`)),
      ...all.filter((item) => !item.resident).map((item) => h("option", { value: item.id, selected: item.id === subscriptionId }, raw(`${item.email || item.label} · ${tr(SUBSCRIPTION_STATES[item.status] || item.status)}`)))];
    return h("select", { "aria-label": tr(label) }, options);
  }
  if (backend) {
    const keys = (S.data.credentials || []).filter((item) => item.provider === backend);
    return h("select", { "aria-label": tr(label) }, h("option", { value: "", selected: !credentialId }, tr("Chiave dello space")),
      ...keys.map((item) => h("option", { value: item.id, selected: item.id === credentialId }, raw(item.label || item.id))));
  }
  return null;
}

function brainAccountChange(modelId, value, plain = false) {
  const keyed = Boolean(keyBackendOf(modelId));
  if (plain) return { subscriptionId: keyed ? "" : value, credentialId: keyed ? value : "" };
  return { brainSubscriptionId: keyed ? "" : value, brainCredentialId: keyed ? value : "" };
}

/** The model a form asks for: the typed id if there is one, otherwise the list. */
function pickedModel(data, name) {
  return String(data.get(`${name}Custom`) || "").trim() || data.get(name) || "";
}

/** The program each subscription runs through, which is what has to be installed. */
const CLI_NAMES = { claude: "Claude Code", codex: "Codex", grok: "Grok Build", muse: "Muse Code", gemini: "Antigravity CLI" };
const SUBSCRIPTION_STATES = { disconnected: "Da collegare", connecting: "Accesso in corso", ready: "Collegata", error: "Accesso non riuscito" };

function subscriptionDisplay(record) {
  const { id, provider, resident, email, label, status, installed, issue, connectedBy, login } = record;
  return { id, provider, resident, email, label, status, installed, issue, connectedBy, login };
}

async function refreshSubscriptions(provider) {
  const ready = () => (S.data.subscriptions || []).filter((record) => record.provider === "gemini" && record.status === "ready").map((record) => record.id).join(",");
  const previous = ready();
  S.data.subscriptions = await api("/api/subscriptions");
  if (provider === "gemini" && previous !== ready()) {
    S.data.models = (await api("/api/state")).models;
    for (const node of document.querySelectorAll(".brain")) node.refreshModels?.();
  }
}

/** Whose an account is, as the person looking at the panel reads it. */
function isOwnAccount(record) {
  return Boolean(!record.resident && record.connectedBy?.id && record.connectedBy.id === S.data.currentUser?.id);
}
function accountOwner(record) {
  if (record.resident) return tr("Account del server");
  if (isOwnAccount(record)) return tr("Il tuo account");
  if (record.connectedBy?.name) return tr("Account di {name}", { name: record.connectedBy.name });
  return tr("Account collegato");
}

function subscriptionDeviceHelp() {
  return h("details", { class: "subscription-help" },
    h("summary", {}, icon("info"), "Problemi con il codice dispositivo?"),
    h("p", {}, "Abilita l'accesso con codice dispositivo nelle impostazioni Sicurezza di ChatGPT. Per un account aziendale deve abilitarlo un amministratore nei permessi del workspace."),
    h("a", { href: "https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta", target: "_blank", rel: "noopener" }, "Guida ufficiale OpenAI", icon("external")));
}

function subscriptionProgress(message) {
  return h("div", { class: "subscription-progress", role: "status", "aria-live": "polite" },
    h("span", { class: "subscription-spinner", "aria-hidden": "true" }), h("span", {}, message));
}

/** A sign-in under way: the official page to open, the device code to confirm, or an authorization to verify. */
function subscriptionLoginSteps(record, name, { authCode, act, busy = false }) {
  const out = [];
  const verifying = record.login?.phase === "verifying";
  authCode.disabled = busy || verifying;
  const step = (number, title, ...children) => h("li", {}, h("span", { class: "subscription-step", "aria-hidden": "true" }, number), h("div", { class: "subscription-step-body" }, h("b", {}, title), ...children));
  if (record.login?.url) {
    const open = btn(tr("Apri {provider}", { provider: name }), { icon: "external", cls: "primary", href: record.login.url, target: "_blank" });
    const steps = h("ol", { class: "subscription-steps" });
    if (record.login.userCode) {
      // Grok and Meta open the page with the code already in it: there it only has to match.
      const confirmOnly = record.login.url.includes(record.login.userCode);
      steps.append(step("1", confirmOnly ? "Il codice da confermare" : "Copia il codice", h("div", { class: "subscription-code" },
        h("strong", { tabindex: "0", "aria-label": "Codice dispositivo" }, raw(record.login.userCode)),
        btn("", { icon: "copy", cls: "ghost", title: "Copia codice", onclick: async () => {
          try { await navigator.clipboard.writeText(record.login.userCode); toast("Copiato"); }
          catch { toast("Non riesco a copiare: selezionalo a mano", true); }
        } }))),
      step("2", tr("Accedi a {provider}", { provider: name }), h("p", {}, confirmOnly
        ? "Controlla che la pagina ufficiale mostri lo stesso codice e autorizza il collegamento."
        : "Incolla il codice nella pagina ufficiale e autorizza il collegamento."), open));
    } else {
      steps.append(step("1", tr("Accedi a {provider}", { provider: name }), h("p", {}, "Apri la pagina ufficiale e autorizza il collegamento."), open));
      if (record.login.manualCode) steps.append(step("2", "Torna qui con il codice", field("Codice di autorizzazione", authCode),
        btn(verifying ? "Verifica dell'autorizzazione…" : "Completa collegamento", { icon: "check", cls: "subscription-complete", disabled: busy || verifying, onclick: () => {
          if (!authCode.value.trim()) { authCode.focus(); return; }
          const code = authCode.value;
          act(() => api(`/api/subscriptions/${record.id}/code`, { method: "POST", body: { code } }), "Verifica dell'autorizzazione…");
        } })));
    }
    out.push(steps);
  }
  out.push(h("div", { class: "subscription-footer" },
    subscriptionProgress(verifying ? "Verifica dell'autorizzazione…" : record.login?.url ? "In attesa di autorizzazione" : "Preparazione dell'accesso…"),
    btn("Annulla", { cls: "ghost", disabled: busy, onclick: () => act(() => api(`/api/subscriptions/${record.id}/cancel`, { method: "POST" }), "Annullamento dell'accesso…") })));
  if (record.provider === "codex") out.push(subscriptionDeviceHelp());
  return out;
}

/**
 * Every account of one subscription harness, as Settings manages them: whose
 * it is, its state, which agents use it, a check and a removal, and
 * "Aggiungi account" for one more. An account being signed in shows its steps
 * in place; a code typed for it survives the redraws.
 */
function subscriptionAccounts(provider, { onChange = () => {} } = {}) {
  const name = PROVIDER_SHORT[provider];
  const root = h("div", { class: "accounts", "data-provider": provider });
  const codes = new Map();
  let busy = false;
  let progress = "";
  let error = "";
  let snapshot = "";
  async function act(fn, message = "Verifica del collegamento…") {
    if (busy) return;
    busy = true;
    progress = message;
    error = "";
    draw(true);
    try { await fn(); }
    catch (failure) { error = failure.message; }
    try { await refreshSubscriptions(provider); }
    catch { error ||= "Impossibile aggiornare il collegamento. Riprova."; }
    busy = false;
    draw(true);
  }
  const add = () => act(async () => {
    const record = await api("/api/subscriptions", { method: "POST", body: { provider, label: name } });
    await api(`/api/subscriptions/${record.id}/login`, { method: "POST" });
  }, "Preparazione dell'accesso…");
  function draw(force = false) {
    const records = (S.data.subscriptions || []).filter((item) => item.provider === provider && !item.resident);
    for (const [id, code] of codes) {
      const record = records.find((item) => item.id === id);
      if (!record || record.status === "ready" || record.status === "disconnected") code.value = "";
      if (!record) codes.delete(id);
    }
    const next = JSON.stringify({ records: records.map(subscriptionDisplay), busy, progress, error, usage: (S.data.agents || []).map((agent) => [agent.id, agent.subscriptionId]) });
    if (!force && next === snapshot) return;
    snapshot = next;
    root.setAttribute("aria-busy", String(busy || records.some((record) => record.login?.phase === "verifying")));
    const installed = Boolean(S.data.providers?.[provider]);
    const rows = records.map((record) => {
      const used = (S.data.agents || []).filter((agent) => agent.subscriptionId === record.id).length;
      if (!codes.has(record.id)) codes.set(record.id, h("input", { type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Codice di autorizzazione", placeholder: "Incolla il codice di autorizzazione" }));
      const remove = btn("", { icon: "trash", cls: "sm ghost danger", title: used ? "In uso: prima scegli un altro account nel Cervello dell'agente" : "Rimuovi account", disabled: Boolean(used) || busy,
        onclick: () => act(() => api(`/api/subscriptions/${record.id}`, { method: "DELETE" }), "Rimozione dell'account…") });
      return h("div", { class: `account ${record.status}` },
        h("div", { class: "account-row" },
          h("span", { class: `subscription-option-dot ${record.status}`, "aria-hidden": "true" }),
          h("div", { class: "grow" }, h("b", {}, raw(record.email || record.label || name)),
            h("small", {}, raw(`${accountOwner(record)} · `), SUBSCRIPTION_STATES[record.status] || raw(record.status),
              used ? raw(` · ${used === 1 ? tr("Usato da un agente") : tr("Usato da {count} agenti", { count: used })}`) : null)),
          h("div", { class: "account-actions" },
            record.status === "ready" ? btn("", { icon: "refresh", cls: "sm ghost", title: "Verifica collegamento", disabled: busy, onclick: () => act(() => api(`/api/subscriptions/${record.id}/check`, { method: "POST" })) }) : null,
            record.status === "disconnected" || record.status === "error"
              ? btn("Ricollega", { icon: "external", cls: "sm", title: "Ricollega", disabled: busy, onclick: () => act(() => api(`/api/subscriptions/${record.id}/login`, { method: "POST" }), "Preparazione dell'accesso…") }) : null,
            remove)),
        record.status === "error" ? h("p", { class: "subscription-error", role: "alert" }, icon("alert"), record.issue === "isolation"
          ? "Questa istanza non supporta ancora il collegamento. Aggiorna Claude Code sul server e riprova."
          : "L'accesso non è stato completato. Riprova quando vuoi.") : null,
        record.status === "connecting" ? h("div", { class: "account-login" }, subscriptionLoginSteps(record, name, { authCode: codes.get(record.id), act, busy })) : null);
    });
    root.replaceChildren(...[
      error ? h("p", { class: "subscription-error", role: "alert" }, icon("alert"), tr(error)) : null,
      busy ? subscriptionProgress(progress) : null,
      rows.length ? h("div", { class: "account-list" }, rows)
        : h("p", { class: "accounts-empty" }, installed ? tr("Nessun altro account {provider} collegato.", { provider: name })
          : tr("{cli} non è installato su questa macchina, quindi non c'è ancora niente da collegare. Installalo sul server con l'utente di Cora e questa scheda si accende da sola.", { cli: CLI_NAMES[provider] || name })),
      installed ? h("div", { class: "accounts-add" }, btn("Aggiungi account", { icon: "plus", cls: rows.length ? "" : "primary", disabled: busy, onclick: add })) : null,
    ].filter(Boolean));
    onChange();
  }
  const poll = async () => {
    if (!root.isConnected) return;
    if (!busy && S.data.subscriptions?.some((item) => item.provider === provider && item.status === "connecting")) {
      try {
        await refreshSubscriptions(provider);
        draw();
      } catch {}
    }
    setTimeout(poll, 1500);
  };
  draw(true);
  root.refreshSubscription = () => draw();
  setTimeout(poll, 1500);
  return root;
}

function subscriptionPicker(currentId, { manage = false, isNew = false } = {}) {
  const accounts = () => [...new Map([...(S.data.quotaAccounts || []).filter(item => item.id === currentId), ...(S.data.subscriptions || [])].map(item => [item.id, item])).values()];
  let provider = "";
  let selectedId = currentId || "";
  let choosing = !selectedId;
  let requestBusy = false;
  let progress = "";
  let actionError = "";
  let snapshot = "";
  const selections = new Map();
  const input = h("input", { type: "hidden", name: "subscriptionId" });
  const content = h("div", { class: "subscription-content" });
  const root = h("section", { class: "subscription-picker", "aria-label": "Account del modello" }, input, content);
  const authCode = h("input", { type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Codice di autorizzazione", placeholder: "Incolla il codice di autorizzazione" });
  authCode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      content.querySelector(".subscription-complete")?.click();
    }
  });

  async function action(fn, message = "Verifica del collegamento…") {
    if (requestBusy) return;
    requestBusy = true;
    progress = message;
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
    await refreshSubscriptions(provider);
    draw();
  }

  function connectNew() {
    const nextProvider = provider;
    return action(async () => {
      const record = await api("/api/subscriptions", { method: "POST", body: { provider: nextProvider, label: PROVIDER_SHORT[nextProvider] } });
      selections.set(nextProvider, record.id);
      if (provider === nextProvider) { selectedId = record.id; choosing = false; }
      await api(`/api/subscriptions/${record.id}/login`, { method: "POST" });
    }, "Preparazione dell'accesso…");
  }

  function changeAccount() {
    choosing = !choosing;
    actionError = "";
    draw();
  }

  function draw(force = false) {
    const all = accounts().filter((record) => record.provider === provider);
    const records = all.filter((record) => !record.resident);
    const resident = !manage && S.data.settings.useResidentSubscriptions && all.find((record) => record.resident);
    const record = all.find((item) => item.id === selectedId) || (!selectedId && !choosing ? resident : null);
    const next = JSON.stringify({ provider, selectedId, choosing, records: all.map(subscriptionDisplay), requestBusy, actionError });
    if (!force && next === snapshot) return;
    snapshot = next;
    input.value = record?.resident ? "" : record?.id || "";
    root.setAttribute("aria-busy", String(requestBusy || record?.login?.phase === "verifying"));
    root.setAttribute("data-state", record?.status || "empty");
    content.replaceChildren();
    if (root.hidden) return;
    const name = PROVIDER_SHORT[provider];
    const state = record?.status || "disconnected";
    const status = h("span", { class: `subscription-status ${state}`, role: "status" }, h("i", { "aria-hidden": "true" }), SUBSCRIPTION_STATES[state]);
    content.append(h("header", { class: "subscription-head" },
      h("span", { class: "subscription-mark", "aria-hidden": "true" }, icon(SUBSCRIPTION_ICONS[provider])),
      h("div", { class: "grow" }, h("span", { class: "label" }, "Abbonamento"), h("h3", {}, raw(name))),
      record && !choosing ? status : null));
    if (actionError) content.append(h("p", { class: "subscription-error", role: "alert" }, icon("alert"), tr(actionError)));
    if (requestBusy) content.append(subscriptionProgress(progress));

    // Without the CLI on the server there is nothing to log in to: offering the
    // device code anyway only ever ends in "Accesso non riuscito".
    if (!S.data.providers?.[provider]) {
      // The account is ChatGPT's or Claude's; what is missing is the program that uses it.
      content.append(h("p", { class: "subscription-description" },
        tr("{cli} non è installato su questa macchina, quindi non c'è ancora niente da collegare. Installalo sul server con l'utente di Cora e questa scheda si accende da sola.", { cli: CLI_NAMES[provider] || name })));
      if (!manage) content.append(h("div", { class: "subscription-footer" }, btn("Impostazioni", { cls: "ghost", href: `#/settings/${provider}` })));
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
        h("span", { class: "grow" }, h("b", {}, item.resident ? "Account del server" : raw(item.email || item.label)), h("small", {}, item.resident ? (item.email ? raw(`${item.email} · `) : null) : raw(`${accountOwner(item)} · `), SUBSCRIPTION_STATES[item.status], count ? raw(` · ${count === 1 ? tr("Usato da un agente") : tr("Usato da {count} agenti", { count })}`) : null)),
        icon(item.id === selectedId ? "check" : "next"));
        list.append(option);
      }
      content.append(list, h("div", { class: "subscription-footer" },
        btn("Collega un altro account", { icon: "plus", onclick: connectNew }),
        record ? btn("Indietro", { cls: "ghost", onclick: changeAccount }) : null));
    } else if (record?.status === "ready") {
      authCode.value = "";
      content.append(h("span", { class: "subscription-source" }, record.resident ? "Account del server · predefinito" : raw(accountOwner(record))));
      // A member must see when an agent runs on the server's account rather than their own.
      const ownReady = records.some((item) => isOwnAccount(item) && item.status === "ready");
      const uses = manage ? "Disponibile per gli agenti di questa istanza."
        : record.resident ? (S.data.currentUser?.role === "owner" ? "Questo agente userà l'account del server."
          : ownReady ? "Questo agente userà l'account del server, non il tuo. Per usare il tuo, scegli «Cambia account»."
            : "Questo agente userà l'account del server. Per usare il tuo, collegalo da «Cambia account».")
        : isOwnAccount(record) ? "Questo agente userà il tuo account."
          : record.connectedBy?.name ? tr("Questo agente userà l'account di {name}.", { name: record.connectedBy.name }) : "Questo agente userà questo account.";
      content.append(h("div", { class: "subscription-identity" },
        h("span", { class: "subscription-connected", "aria-hidden": "true" }, icon("check")),
        h("div", { class: "grow" }, h("b", {}, raw(record.email || record.label)),
          h("p", {}, uses))));
      content.append(h("div", { class: "subscription-footer" },
        btn("Cambia account", { cls: "ghost", onclick: changeAccount }),
        (S.data.subscriptions || []).some(item => item.id === record.id) ? btn("", { icon: "refresh", cls: "ghost", title: "Verifica collegamento", onclick: () => action(() => api(`/api/subscriptions/${record.id}/check`, { method: "POST" })) }) : null));
    } else if (record?.status === "connecting") {
      content.append(...subscriptionLoginSteps(record, name, { authCode, act: action, busy: requestBusy }));
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
            btn("Impostazioni", { cls: "ghost", href: `#/settings/${provider}` })));
      } else content.append(h("div", { class: "subscription-footer" },
        btn(requestBusy ? "Preparazione dell'accesso…" : tr("Collega {provider}", { provider: name }), { icon: requestBusy ? "refresh" : "external", cls: "primary", onclick: record
          ? () => action(() => api(`/api/subscriptions/${record.id}/login`, { method: "POST" }), "Preparazione dell'accesso…") : connectNew }),
        records.length ? btn("Cambia account", { cls: "ghost", onclick: changeAccount }) : null));
      if (provider === "codex") content.append(subscriptionDeviceHelp());
    }
    if (choosing && record && !record.resident && !(S.data.agents || []).some((agent) => agent.subscriptionId === record.id)) {
      content.append(btn("Rimuovi account", { icon: "trash", cls: "ghost danger subscription-remove", onclick: () => action(async () => {
        await api(`/api/subscriptions/${record.id}`, { method: "DELETE" });
        selectedId = "";
        selections.delete(provider);
        choosing = true;
      }, "Rimozione dell'account…") }));
    }
    for (const button of content.querySelectorAll("button")) if (requestBusy) button.disabled = true;
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
  root.refreshSubscription = () => draw();
  return {
    node: root,
    setProvider(value) {
      if (provider) selections.set(provider, selectedId);
      const previous = provider;
      provider = value;
      const needs = SUBSCRIPTION_HARNESSES.includes(provider);
      root.hidden = !needs;
      input.disabled = !needs;
      if (previous !== provider) {
        // A new agent starts on the account its creator signed in themselves, when there is one.
        const own = isNew ? accounts().find((item) => item.provider === provider && item.status === "ready" && isOwnAccount(item)) : null;
        selectedId = selections.has(provider) ? selections.get(provider) : (accounts().find((item) => item.id === currentId && item.provider === provider)?.id) || own?.id || "";
        choosing = !selectedId && (manage || !S.data.settings.useResidentSubscriptions);
        actionError = "";
        authCode.value = "";
      }
      draw();
    },
    validate() {
      if (root.hidden) return true;
      const record = accounts().find((item) => item.provider === provider && (input.value ? item.id === input.value : item.resident && S.data.settings.useResidentSubscriptions));
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

function channelChips(selected, kind = S.data.transport) {
  const chosen = new Set(selected);
  const wrap = h("div", { class: "chips", "data-channels": "" });
  const channels = S.data.channels.filter((channel) => (channel.kind || "discord") === kind);
  for (const channel of channels) {
    const chip = h("button", { type: "button", class: `chip${chosen.has(channel.id) ? " on" : ""}`, "data-id": channel.id }, icon(channel.kind === "telegram" ? "send" : "hash"), raw(channelChipLabel(channel).replace(/^#/, "")));
    chip.addEventListener("click", () => chip.classList.toggle("on"));
    wrap.append(chip);
  }
  if (!channels.length) wrap.append(h("small", {}, kind === "telegram" ? "Nessuna chat Telegram accesa: accendile nelle impostazioni." : kind === "slack" ? "Nessun canale Slack acceso: accendili nelle impostazioni." : "Nessun canale visibile (Discord non collegato?)."));
  return wrap;
}

/**
 * Whether an agent is on one platform, and in which of its channels. Off, it neither hears
 * nor writes there; its private chat with its own Telegram bot counts as being there.
 */
function platformRow(agent, kind) {
  const on = !(agent.platformsOff || []).includes(kind);
  const chips = channelChips(agent.channelIds || [], kind);
  const toggle = switchInput(`platform-${kind}`, "", on);
  const body = h("div", { class: "stack-sm" }, chips);
  body.hidden = !on;
  toggle.querySelector("input").addEventListener("change", (event) => { body.hidden = !event.target.checked; });
  const hint = kind === "telegram" && agent.telegramBot?.user
    ? "Nessuna chat selezionata = le ascolta tutte. In privato col suo bot risponde sempre."
    : kind === "telegram" ? "Nessuna chat selezionata = le ascolta tutte." : "Nessuno selezionato = li ascolta tutti.";
  return setRow(tr("Su {transport}", { transport: TRANSPORTS[kind].label }), hint, h("div", { class: "stack-sm" }, toggle, body), { stack: true });
}

function armedButton(label, armedLabel, { icon: name = "trash", onconfirm, cls = "" }) {
  const button = btn(label, { icon: name, cls: `danger${cls ? ` ${cls}` : ""}` });
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

/** An image file cut to its centre square and drawn at 512 pixels, as a PNG: what Slack and Discord take for an icon. */
async function squarePng(file, size = 512) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = h("canvas", { width: size, height: size });
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

/**
 * The agent's picture. Cora draws it from the agent's colour and a seed, and
 * "Ridisegna" draws another face; or an image of one's own, made square here.
 * Nothing is sent before the form is saved: `upload()` then does its part.
 */
function avatarPicker(agent, colorInput) {
  const seedInput = h("input", { type: "hidden", name: "avatarSeed", value: agent.avatarSeed || (agent.id ? "" : crypto.randomUUID().slice(0, 8)) });
  // undefined: the picture stays as it is; a data URL: a new image; null: back to the drawing.
  let picked;
  const img = h("img", { alt: "" });
  const preview = h("span", { class: "avatar lg" }, img);
  const own = () => picked || (picked === undefined && agent.avatarUpload);
  const drawn = btn("Usa il disegno", { icon: "spark", cls: "sm ghost", onclick: () => { picked = null; show(); } });
  const show = () => {
    preview.style.setProperty("--ring", colorInput.value);
    preview.classList.toggle("drawn", !own());
    img.src = picked || (own() ? avatarSrc(agent)
      : `/api/avatars/preview?seed=${encodeURIComponent(seedInput.value || agent.id)}&color=${encodeURIComponent(colorInput.value)}`);
    drawn.hidden = !own();
  };
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", async () => {
    const chosen = file.files[0];
    file.value = "";
    if (!chosen) return;
    try {
      picked = await squarePng(chosen);
      show();
    } catch {
      toast(tr("Questa immagine non si apre"), true);
    }
  });
  colorInput.addEventListener("input", show);
  show();
  return {
    node: h("div", { class: "avatar-pick" }, preview,
      h("div", { class: "avatar-actions" },
        btn("Ridisegna", { icon: "refresh", cls: "sm", onclick: () => { seedInput.value = crypto.randomUUID().slice(0, 8); picked = null; show(); } }),
        btn("Carica la tua", { icon: "upgrade", cls: "sm", onclick: () => file.click() }),
        drawn),
      seedInput, file),
    /** After the agent is saved: the new image, or the drawing back in place of an old one. */
    async upload(id) {
      if (picked) return guard(api(`/api/agents/${id}/avatar`, { method: "PUT", body: { image: picked } }), "Immagine salvata");
      if (picked === null && agent.avatarUpload) return guard(api(`/api/agents/${id}/avatar`, { method: "DELETE" }), "Di nuovo il disegno di Cora");
      return true;
    },
  };
}

/**
 * Who an agent answers to: a real person of the chats, picked among the people who wrote there,
 * by platform. Nobody picked, it answers to the owner of the space.
 */
function agentOwnerPanel(agent) {
  const content = h("div", { class: "stack-sm" }, subscriptionProgress("Caricamento…"));
  const root = panel({ icon: "users", title: "Proprietari", cls: "agent-owner-panel", hint: "Condividi agente, conversazioni, quote, Brain e memorie con le persone scelte." }, content);
  let saving = false, dirty = false;
  const load = async (force = false) => {
    if (saving || dirty) return;
    try {
      const data = await api(`/api/agents/${agent.id}/owners`);
      if (!force && root.ownersVersion === data.version) return;
      root.ownersVersion = data.version;
      const chosen = new Set([...data.users, data.primaryId]), contacts = new Set(data.contacts);
      const primary = data.people.find(person => person.id === data.primaryId);
      const choices = (people, selected, field) => h("div", { class: "set-switches" }, people.map(person => {
        const row = switchInput(field, raw(person.name), selected.has(person.id), person.email || person.transport);
        const input = row.querySelector("input"); input.value = person.id;
        input.disabled = field === "proprietor" && person.id === data.primaryId;
        input.addEventListener("change", () => { dirty = true; if (input.checked) selected.add(person.id); else selected.delete(person.id); });
        return row;
      }));
      const feedback = h("p", { class: "muted", role: "status" });
      const save = btn("Salva proprietari", { icon: "check", cls: "primary", onclick: async () => {
        if (saving) return; saving = true; save.disabled = true; root.setAttribute("aria-busy", "true");
        save.textContent = tr("Salvataggio…"); feedback.textContent = "";
        try {
          const updated = await api(`/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [...chosen], contacts: [...contacts], version: data.version } });
          data.version = updated.ownersVersion; root.ownersVersion = updated.ownersVersion; dirty = false; Object.assign(agent, updated); S.data.agents = S.data.agents.map(item => item.id === agent.id ? updated : item);
          if (updated.brainOwnerId !== S.data.currentUser?.id && !updated.coOwnerIds.includes(S.data.currentUser?.id)) { await loadState(); location.hash = "#/agenti"; renderAgents(); }
          else feedback.textContent = tr("Proprietari aggiornati.");
        } catch (error) { feedback.textContent = tr(error.message); }
        finally { saving = false; save.disabled = false; save.textContent = tr("Salva proprietari"); root.setAttribute("aria-busy", "false"); }
      } });
      content.replaceChildren(
        h("p", { class: "muted" }, agent.brainSource === "external" ? tr("L’agente usa un Brain esterno in sola lettura: i comproprietari condividono questa fonte, senza aprire il Brain interno.") : tr("Il Brain di {name} e i ricordi condivisi dai suoi agenti saranno accessibili ai comproprietari.", { name: primary?.name || data.primaryId })),
        setRows(setRow("Persone dello spazio", "Possono gestire questo agente e il suo Brain.", choices(data.people, chosen, "proprietor"), { stack: true }),
          setRow("Proprietari in chat", "Le richieste di ciascuno valgono come quelle del proprietario. Non apre il pannello.", data.chatPeople.length ? choices(data.chatPeople, contacts, "chatProprietor") : h("p", { class: "muted" }, "Le persone compaiono dopo aver scritto nei canali dell'agente."), { stack: true })),
        h("div", { class: "row end" }, btn("Ricarica", { icon: "refresh", cls: "ghost", onclick: async () => { dirty = false; await load(true); } }), save), feedback);
    } catch (error) { content.replaceChildren(h("p", { class: "notice warn", role: "status" }, raw(error.message))); }
  };
  root.refreshOwners = load; root.readyOwners = load(); return root;
}

/* ---------- the character sheet ---------- */

/**
 * Six traits and two style axes make the Character panel. The same pure module
 * the server prompts with is imported here, so the preview is the text the
 * agent will really receive — no second generator to drift.
 */
function legacyStory(agent) {
  const story = String(agent?.personality || "").trim();
  if (!story || !agent?.id) return null;
  const on = Boolean(agent.character?.enabled);
  const row = h("div", { class: "character-legacy" },
    h("p", {}, on
      ? "Una storia precedente è conservata e non entra nel prompt."
      : "Una storia precedente è ancora il «Chi sei». Salva il Carattere: da lì comandano gli slider e la storia esce dal prompt."),
    btn("Togli la storia", { cls: "sm ghost", onclick: async () => {
      const saved = await guard(api(`/api/agents/${agent.id}`, { method: "PUT", body: { personality: "" } }), "Storia tolta");
      if (!saved) return;
      agent.personality = "";
      const live = S.data?.agents?.find((item) => item.id === agent.id);
      if (live) live.personality = "";
      row.remove();
    }}));
  return row;
}

function characterPanel(agent) {
  const initial = agent.character && typeof agent.character === "object" ? agent.character : null;
  const start = {
    ...CHARACTER_DEFAULT,
    ...(initial || {}),
    scores: { ...CHARACTER_DEFAULT.scores, ...(initial?.scores || {}) },
  };

  const traitInputs = {};
  const traitValues = {};
  const traits = h("div", { class: "character-stats" }, CHARACTER_TRAITS.map((trait) => {
    const input = h("input", { type: "range", class: "fader", name: `char-${trait.key}`, min: 1, max: 20, step: 1, value: Number(start.scores[trait.key]) || 10, "aria-label": LANG === "en" ? trait.labelEn : trait.label });
    const value = h("b", { class: "character-stat-value" });
    traitInputs[trait.key] = input;
    traitValues[trait.key] = value;
    input.addEventListener("input", draw);
    return h("div", { class: "character-stat" },
      h("div", { class: "character-stat-head" },
        h("span", { class: "character-stat-name" }, h("b", {}, LANG === "en" ? trait.labelEn : trait.label), h("small", {}, trait.abbr)),
        value),
      input,
      h("div", { class: "character-poles" }, h("span", {}, LANG === "en" ? trait.lowEn : trait.low), h("span", {}, LANG === "en" ? trait.highEn : trait.high)));
  }));

  const methodInput = h("input", { type: "range", class: "fader", name: "char-method", min: 1, max: 20, step: 1, value: Number(start.method) || 10, "aria-label": tr("Metodo") });
  const focusInput = h("input", { type: "range", class: "fader", name: "char-focus", min: 1, max: 20, step: 1, value: Number(start.focus) || 10, "aria-label": tr("Focus") });
  methodInput.addEventListener("input", draw);
  focusInput.addEventListener("input", draw);
  const methodValue = h("b", { class: "character-align-value" });
  const focusValue = h("b", { class: "character-align-value" });

  const typeBadge = h("span", { class: "character-badge" });
  const styleBadge = h("span", { class: "character-badge" });
  const preview = h("pre", { class: "character-preview" });

  const sheet = h("div", { class: "character-sheet" },
    h("div", { class: "character-badges" },
      h("span", { class: "character-badge-label" }, tr("Tipo")), typeBadge,
      h("span", { class: "character-badge-label" }, tr("Stile")), styleBadge),
    traits,
    h("div", { class: "character-align" },
      h("div", { class: "character-align-row" },
        h("div", { class: "character-align-head" }, h("span", { class: "label" }, tr("Metodo")), methodValue),
        methodInput,
        h("div", { class: "character-poles" }, h("span", {}, tr("Istintivo")), h("span", {}, tr("Adattivo")), h("span", {}, tr("Strutturato")))),
      h("div", { class: "character-align-row" },
        h("div", { class: "character-align-head" }, h("span", { class: "label" }, tr("Focus")), focusValue),
        focusInput,
        h("div", { class: "character-poles" }, h("span", {}, tr("Risultato")), h("span", {}, tr("Bilanciato")), h("span", {}, tr("Persone"))))),
    h("div", { class: "character-preview-box" },
      h("div", { class: "character-preview-head" }, h("span", { class: "label" }, tr("Prompt generato")), h("small", {}, tr("In italiano, la lingua in cui parla l'agente."))),
      preview),
    legacyStory(agent));

  // No off switch: the sliders are always visible. They are written only when
  // this section is saved, so Identità, Ascolto and Voce leave the sheet alone.
  function read() {
    return {
      version: 1,
      enabled: true,
      scores: Object.fromEntries(CHARACTER_TRAITS.map((trait) => [trait.key, Number(traitInputs[trait.key].value)])),
      method: Number(methodInput.value),
      focus: Number(focusInput.value),
    };
  }

  function draw() {
    const character = read();
    for (const trait of CHARACTER_TRAITS) traitValues[trait.key].textContent = String(character.scores[trait.key]);
    const style = characterStyle(character);
    typeBadge.textContent = characterType(character.scores).title;
    styleBadge.textContent = style.label;
    methodValue.textContent = `${character.method} · ${style.method.label}`;
    focusValue.textContent = `${character.focus} · ${style.focus.label}`;
    preview.textContent = characterSheet(character);
  }

  draw();

  const node = panel({ icon: "spark", title: "Carattere", hint: "Sei tratti e due assi scrivono il «Chi sei» dell'agente; il prompt si riscrive mentre li muovi." }, sheet);
  return { node, value: read };
}

/**
 * Who the agent is. Brain configuration belongs to the saved agent's own tab.
 */
function agentForm(agent, { only = "" } = {}) {
  const isNew = !agent.id;
  const wantsBrain = !isNew && only !== "profile";
  const nameInput = h("input", { type: "text", name: "name", value: agent.name || "", required: true, maxlength: 32, placeholder: "es. Marta", autocomplete: "off" });
  const colorInput = h("input", { type: "color", name: "color", value: agent.color || "#e8a33d" });
  const picture = avatarPicker(agent, colorInput);
  const genderInput = h("select", { name: "gender" },
    [["", "Non indicato"], ["female", "Femminile"], ["male", "Maschile"], ["neutral", "Neutro"]].map(([value, label]) => h("option", { value, selected: (agent.gender || "") === value }, label)));
  const hidden = (agent.channelIds || []).filter((id) => !S.data.channels.some((channel) => channel.id === id));
  // Two choices, not one: who runs the loop, and which model thinks.
  let harness = harnessOf(agent.model || S.data.settings.defaultModel || "");
  const model = wantsBrain ? modelPicker("model", agent.model || "", { harness }) : null;
  const harnessPick = wantsBrain ? h("select", {}, Object.entries(HARNESSES).map(([key, item]) =>
    h("option", { value: key, selected: key === harness }, tr(item.label)))) : null;
  const harnessHint = wantsBrain ? h("span", {}, tr(HARNESSES[harness].hint)) : null;
  const subscription = wantsBrain ? subscriptionPicker(agent.subscriptionId, { isNew }) : null;
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
  const identity = panel({ icon: "user", title: "Identità", hint: "Come si chiama e come appare." },
      setRows(
        setRow("Nome", "Chi lo nomina riceve la sua risposta.", nameInput),
        setRow("Colore", "Quello della sua immagine e del suo nome nel pannello.", colorInput),
        setRow("Genere", "Come parla di sé, e la voce che gli viene data.", genderInput),
        setRow("Immagine", "La disegna Cora con il colore dell'agente; «Ridisegna» propone un'altra faccia. Una tua viene tagliata quadrata.", picture.node, { stack: true })));
  const characterPane = characterPanel(agent);
  const listening = panel({ icon: "radio", title: "Ascolto", hint: "Dove ascolta. Parla solo quando qualcuno lo chiama." },
    setRows(platformsOn().map((kind) => platformRow(agent, kind)),
      setRow("In onda", "Spento non ascolta e non parla, da nessuna parte.", switchInput("enabled", "", agent.enabled ?? true))));
  const owner = !isNew ? agentOwnerPanel(agent) : null;
  const voice = voicePanel(agent, genderInput);
  const form = h("form", { class: "stack", ...(isNew ? {} : { id: `agent-settings-${agent.id}` }) }, identity,
    wantsBrain ? panel({ icon: "chip", title: "Cervello", hint: "Con che modello pensa e cosa può usare." },
      setRows(
        setRow("Harness", harnessHint, harnessPick),
        setRow("Modello", "Il modello che pensa, per l'harness scelto.", model, { stack: true }),
        h("div", { class: "set-row stack" }, subscription.node),
        setRow("Ragionamento", "Quanto pensa prima di rispondere: più alto è più accurato ma più lento.", effortSelect(agent)),
        setRow("Usa il suo computer", "Un desktop Linux tutto suo, che vedi anche tu.", switchInput("tools", "", agent.tools ?? true)))) : null,
    characterPane.node, listening, owner, voice,
    h("div", { class: "savebar" },
      isNew ? null : armedButton("Elimina", "Conferma", { onconfirm: async () => {
        if (await guard(api(`/api/agents/${agent.id}`, { method: "DELETE" }), `${agent.name} eliminato`)) {
          await loadState();
          location.hash = "#/agenti";
        }
      } }),
      h("span", { class: "spacer" }),
      btn(isNew ? "Crea agente" : "Salva", { icon: "check", type: "submit", cls: "primary" })));
  let controls = form;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (wantsBrain && !subscription.validate()) return;
    const data = new FormData(form);
    const body = {
      name: data.get("name"),
      avatarSeed: data.get("avatarSeed"),
      color: data.get("color"),
      gender: data.get("gender"),
      channelIds: [...hidden, ...[...controls.querySelectorAll("[data-channels] .chip.on")].map((chip) => chip.dataset.id)],
      // Platforms not switched on keep what the agent had there.
      platformsOff: [...(agent.platformsOff || []).filter((kind) => !platformsOn().includes(kind)), ...platformsOn().filter((kind) => form.elements[`platform-${kind}`] && !form.elements[`platform-${kind}`].checked)],
      ...(form.elements.ownerId ? { ownerId: form.elements.ownerId.value } : {}),
      enabled: form.elements.enabled.checked,
      // The old free-text personality is not edited here any more: an update that does not mention it keeps it.
      ...(data.has("personality") ? { personality: data.get("personality") } : {}),
      ...(shouldWriteCharacter({ isNew, section: route()[3] }) ? { character: characterPane.value() } : {}),
      // A voice select left disabled (no Soniox yet) keeps what the agent had.
      voice: data.has("voice") ? data.get("voice") : agent.voice || "",
      voiceLanguage: data.has("voiceLanguage") ? data.get("voiceLanguage") : agent.voiceLanguage || "",
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
    await picture.upload(saved.id);
    await loadState();
    if (isNew) location.hash = `#/agent/${saved.id}/impostazioni`;
    else renderAgent();
  });
  if (isNew || only !== "profile") return form;
  for (const input of form.querySelectorAll("input, select, textarea")) input.setAttribute("form", form.id);
  const savebar = form.lastElementChild;
  form.classList.add("agent-settings-save");
  form.replaceChildren(savebar);
  const entries = [
    ["identita", "Identità", "user", "Nome, immagine e colore", [identity]],
    ["carattere", "Carattere", "spark", "Personalità e modo di parlare", [characterPane.node]],
    ["ascolto", "Ascolto", "radio", "Canali e presenza", [listening]],
    ["voce", "Voce", "mic", "Lingua e risposte vocali", [voice]],
    ["autorizzazioni", "Autorizzazioni", "shield", "Chi può farlo lavorare", [agentPermissionsPane(agent), owner].filter(Boolean)],
    ...platformsOn().map((kind) => [kind, TRANSPORTS[kind].label, TRANSPORTS[kind].icon, "Account e collegamento", [kind === "slack" ? slackAccount(agent) : kind === "telegram" ? telegramAccount(agent) : discordAccount(agent)]]),
    ["github", "GitHub", "github", "App e repository", [githubAccount(agent)]],
  ];
  controls = sectionWorkspace({ title: "Impostazioni", base: `#/agent/${agent.id}/impostazioni`, current: route()[3], entries,
    onSelect: (id) => { form.hidden = !["identita", "carattere", "ascolto", "voce"].includes(id); } });
  controls.querySelector(".email-workspace-detail").append(form);
  return controls;
}

const VOICE_LANGUAGE_NAMES = { it: "Italiano", en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português" };

/**
 * The agent's voice: the language it speaks, a Soniox voice heard before it is chosen, and when it answers out loud.
 * The voices offered follow the agent's gender, in the order the server picks the automatic one.
 */
function voicePanel(agent, genderInput) {
  const language = h("select", { name: "voiceLanguage" },
    h("option", { value: "", selected: !agent.voiceLanguage }, "La lingua dell'istanza"),
    Object.entries(VOICE_LANGUAGE_NAMES).map(([code, name]) => h("option", { value: code, selected: agent.voiceLanguage === code }, raw(name))));
  const voice = h("select", { name: "voice" }, h("option", { value: agent.voice || "", selected: true }, agent.voice ? raw(agent.voice) : "Automatica"));
  const about = h("span", { class: "voice-about" });
  const player = h("audio", { class: "voice-preview", controls: true, hidden: true });
  let catalog = [];
  const spoken = () => language.value || S.data.settings.language || "it";
  // Of the agent's gender (a neutral one takes any); native in the language first, then the ones with no accent of their own.
  const fits = () => {
    const gender = ["male", "female"].includes(genderInput.value) ? genderInput.value : "";
    const own = catalog.filter((item) => !gender || item.gender === gender);
    const native = own.filter((item) => !item.languages.length || item.languages.includes(spoken()));
    return (native.length ? native : own.length ? own : catalog)
      .sort((a, b) => Number(b.languages.includes(spoken())) - Number(a.languages.includes(spoken())));
  };
  const fill = () => {
    const chosen = voice.value;
    voice.replaceChildren(h("option", { value: "" }, "Automatica"),
      fits().map((item) => h("option", { value: item.id, selected: item.id === chosen }, raw(`${item.id}${item.gender ? ` · ${item.gender}` : ""}`))));
    if (chosen && !fits().some((item) => item.id === chosen)) voice.value = "";
    const picked = catalog.find((item) => item.id === voice.value);
    about.textContent = picked ? picked.description : tr("Automatica: la prima voce di Soniox per la sua lingua e il suo genere.");
  };
  const listen = btn("Ascolta", { icon: "play", cls: "ghost", onclick: async () => {
    const heard = voice.value || fits()[0]?.id || catalog[0]?.id;
    if (!heard) return;
    listen.disabled = true;
    try {
      const response = await fetch("/api/voices/preview", { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ voice: heard, language: spoken() }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || tr("Anteprima non riuscita"));
      player.src = URL.createObjectURL(await response.blob());
      player.hidden = false;
      await player.play().catch(() => {});
    } catch (error) { toast(error.message, true); }
    listen.disabled = false;
  } });
  language.addEventListener("change", fill);
  voice.addEventListener("change", fill);
  // A voice of the other gender gives way to the automatic one.
  genderInput.addEventListener("change", fill);
  const body = h("div", { class: "stack-sm" },
    setRows(
      setRow("Lingua", "La lingua in cui parla, e in cui risponde a voce.", language),
      setRow("Voce", about, h("div", { class: "voice-pick" }, voice, listen)),
      h("div", { class: "voice-listen" }, player)));
  api("/api/voices").then((data) => {
    if (!data.configured) {
      for (const control of [voice, language]) control.disabled = true;
      listen.disabled = true;
      about.replaceChildren(tr("Per dare una voce agli agenti collega Soniox in "), h("a", { href: "#/settings/soniox" }, tr("Impostazioni → Soniox")), ".");
      return;
    }
    catalog = data.voices;
    fill();
  }).catch(() => { about.textContent = tr("Le voci di Soniox non rispondono: riprova tra poco."); });
  return panel({ icon: "mic", title: "Voce", hint: "A un vocale risponde solo a voce. Per avere il testo, chiediglielo." }, body);
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
    body = setRows(
      setRow("App sua", h("span", {}, "Collegata come ", h("b", {}, raw(`@${bot.user.username}`)), ". ", bot.inChannel ? "Scrive nel canale col suo account." : "Non è ancora nei canali accesi: invitala con /invite e scriverà da sola.")),
      h("div", { class: "set-row stack" }, slackAppSync(agent, bot)));
  } else {
    body = setRows(setRow("App sua", bot.state === "error" ? tr("I token salvati non funzionano ({error}): incollane di nuovi.", { error: bot.error }) : "Ora scrive tramite l'app principale, col suo nome sul messaggio. Con un'app sua è un utente Slack vero: la menzioni e le scrivi in privato.",
      h("div", { class: "stack-sm" }, steps(
        h("span", {}, "tocca «Crea l'app su Slack», scegli ", h("b", {}, "From a manifest"), " e incolla il manifest qui sotto;"),
        h("span", {}, "Install to Workspace, poi copia il ", h("b", {}, "Bot User OAuth Token"), " (xoxb-) da OAuth & Permissions;"),
        h("span", {}, "in Basic Information → App-Level Tokens crea un token con ", h("code", {}, "connections:write"), " e copia l'xapp-;"),
        h("span", {}, "incolla i due token qui: li controllo e li salvo in hush come ", h("code", {}, bot.env), " e ", h("code", {}, bot.appEnv), ";"),
        h("span", {}, "nel canale scrivi ", h("code", {}, `/invite @${agent.name}`), ".")),
      bot.manifest ? slackManifest(bot.manifest) : null,
      slackTokenForm({ path: `/api/agents/${agent.id}/slack-bot`, ok: "Token salvati" })), { stack: true }));
  }
  return panel({ icon: "slack", title: "Account Slack", hint: "La sua app su Slack.", actions }, body);
}

/**
 * The agent's own GitHub App: made from here (on GitHub the owner presses Create), installed on the
 * repositories the owner picks, and from then on git on its desktop is signed in as the app's bot.
 */
function githubAccount(agent) {
  const gh = agent.github;
  if (!gh || S.data.currentUser?.role !== "owner") return null;
  const head = { icon: "github", title: "Account GitHub", hint: "La sua app su GitHub: commit, pull request e issue a nome suo." };
  if (!gh.available) return panel(head, h("p", { class: "muted" }, "Le app GitHub vogliono un indirizzo pubblico di questo spazio, dove GitHub rimanda dopo ogni passo."));
  const refresh = async () => { await loadState(); renderAgent(); };
  const check = btn("Controlla su GitHub", { icon: "refresh", cls: "ghost", onclick: async () => {
    check.disabled = true;
    const view = await guard(api(`/api/agents/${agent.id}/github/check`, { method: "POST" }));
    check.disabled = false;
    if (view) refresh();
  } });
  // GitHub takes the app's picture only from its own page: the agent's, ready to upload there.
  const picture = setRow("Immagine", "GitHub non la prende da qui: scarica quella dell'agente e caricala nell'app, in Display information.",
    h("div", { class: "row" }, avatar(agent, "sm"),
      h("a", { class: "btn ghost sm", href: `/avatars/${agent.id}.png?v=${agent.avatarVersion || 0}`, download: `${gh.slug || agent.name}.png` }, icon("download"), h("span", {}, tr("Scarica l'immagine"))),
      btn("Apri l'app su GitHub", { icon: "external", cls: "ghost sm", href: gh.settingsUrl, target: "_blank" })));
  const forget = setRow("Scollega", "La toglie da Cora e dal suo desktop. Su GitHub l'app resta finché non la elimini tu.",
    armedButton("Scollega", "Conferma", { cls: "sm", onconfirm: async () => {
      const done = await guard(api(`/api/agents/${agent.id}/github`, { method: "DELETE" }), "App GitHub scollegata");
      if (done) refresh();
    } }));
  if (gh.state === "none") {
    const create = btn(tr("Crea l'app di {name}", { name: agent.name }), { icon: "github", cls: "primary", onclick: async () => {
      create.disabled = true;
      const made = await guard(api(`/api/agents/${agent.id}/github/manifest`, { method: "POST" }));
      create.disabled = false;
      if (!made) return;
      // GitHub takes the manifest only as a form posted to it: the owner then just presses Create.
      const form = h("form", { method: "post", action: made.action, hidden: true }, h("input", { type: "hidden", name: "manifest", value: made.manifest }));
      document.body.append(form);
      form.submit();
    } });
    const where = gh.org ? tr("Nasce nell'organizzazione {org}.", { org: gh.org }) : tr("Nasce nel tuo account GitHub: l'organizzazione si sceglie in Impostazioni → GitHub.");
    return panel({ ...head, actions: badge("Nessuna app", "", "github") },
      setRows(setRow("La sua app", `${where} ${tr("Su GitHub premi Create, poi la installi sui repo che scegli: due clic, e torni qui da solo.")}`, create)));
  }
  // Each organization, its repositories and whether the agent uses it; one more is added on GitHub.
  const add = btn(gh.installations.length ? "Aggiungi un'organizzazione" : "Installa su GitHub", { icon: "plus", cls: gh.installations.length ? "ghost" : "primary", onclick: async () => {
    const link = await guard(api(`/api/agents/${agent.id}/github/install`, { method: "POST" }));
    if (link?.url) location.href = link.url;
  } });
  const decide = (installation, approved) => async () => {
    if (await guard(api(`/api/agents/${agent.id}/github/installations/${installation.id}`, { method: "PUT", body: { approved } }), approved ? tr("Ora lavora su {account}", { account: installation.account }) : tr("Non usa più {account}", { account: installation.account }))) refresh();
  };
  const orgs = gh.installations.length
    ? h("div", { class: "gh-orgs" }, gh.installations.map((installation) => h("div", { class: `gh-org${installation.approved ? "" : " pending"}` },
      icon(installation.approved ? "check" : "alert"),
      h("span", { class: "grow" }, h("b", { class: "mono" }, raw(installation.account)),
        h("small", {}, raw(installation.repositorySelection === "all" ? tr("tutti i repo") : tr("i repo scelti")), raw(" · "),
          installation.approved ? tr(installation.account === gh.primary ? "in uso · gh lavora qui" : "in uso") : tr("installata da qualcun altro: da approvare"))),
      installation.approved ? null : btn("Approva", { icon: "check", cls: "sm primary", onclick: decide(installation, true) }),
      btn("Repo", { icon: "external", cls: "sm ghost", href: installation.url, target: "_blank", title: tr("Cambia i repo su GitHub") }))))
    : h("p", { class: "muted small" }, "Non è ancora installata da nessuna parte.");
  const desktopUntil = gh.installations.filter((item) => item.approved && item.tokenUntil).map((item) => item.tokenUntil).sort((a, b) => a - b)[0];
  const desktop = gh.error ? tr("Non riesco a scrivere i token sul suo desktop: {error}.", { error: gh.error })
    : desktopUntil ? tr("git e gh sono già autenticati come lui, un token per organizzazione; si rinnovano da soli, ora valgono fino alle {time}.", { time: fmtTime(new Date(desktopUntil).toISOString()) })
      : "git e gh saranno autenticati come lui appena il suo desktop è acceso.";
  const pending = gh.installations.filter((item) => !item.approved).length;
  const state = gh.state === "installed" ? badge(pending ? "Da approvare" : gh.error ? "Desktop da aggiornare" : "Collegata", pending || gh.error ? "warn" : "on", pending || gh.error ? "alert" : "check")
    : badge("Da installare", "warn", "alert");
  return panel({ ...head, actions: state },
    setRows(
      gh.state === "installed" ? setRow("Su GitHub è", h("span", {}, h("b", { class: "mono" }, raw(gh.login)))) : null,
      setRow("Organizzazioni", gh.public ? "Su GitHub scegli l'organizzazione e i repo; ripeti per ognuna. Quelle aggiunte da qui le usa subito." : tr("Quest'app è privata: si installa solo su {owner}. Per le altre organizzazioni scollegala e creala di nuovo: nasce pubblica.", { owner: gh.org || "il tuo account" }),
        h("div", { class: "stack-sm" }, orgs, h("div", { class: "row" }, add, check)), { stack: true }),
      gh.state === "installed" ? setRow("Dal suo desktop", desktop, null) : null,
      gh.keyMissing ? setRow("Chiave", "La chiave dell'app non è più in hush: scollegala e creala di nuovo.", null) : null,
      picture, forget));
}

/** How the agent's Slack app follows the panel: its name, description and image. */
function slackAppSync(agent, bot) {
  if (!S.data.slack?.apps?.configured) return h("small", { class: "muted" }, "Perché l'app Slack prenda da sola il nome e l'immagine dell'agente, collega il token di configurazione in Impostazioni → Slack.");
  const record = bot.appSync;
  const button = btn("Aggiorna su Slack", { icon: "refresh", cls: "sm ghost", onclick: async () => {
    button.disabled = true;
    if (await guard(api(`/api/agents/${agent.id}/slack-app`, { method: "POST" }), "App Slack aggiornata")) {
      await loadState();
      renderAgent();
    }
    button.disabled = false;
  } });
  const line = !record ? tr("Nome, descrizione e immagine passano all'app Slack appena si collega.")
    : record.error ? tr("Slack non ha preso l'ultimo aggiornamento: {error}.", { error: record.error })
      : record.separate ? tr("L'app è sul suo account Slack: nome e immagine li aggiorna chi la gestisce.")
        : tr("Nome, descrizione e immagine seguono il pannello: allineati {time}.", { time: fmtTime(record.at, true) });
  return h("div", { class: `slack-app-sync${record?.error ? " err" : ""}` }, icon(record?.error ? "alert" : record?.separate ? "slack" : "check"), h("span", { class: "grow" }, raw(line)), button);
}

/** Settings → Canali → Slack: the configuration token that lets every app follow the panel. */
function slackAppsField() {
  const apps = S.data.slack?.apps || { configured: false };
  const input = h("input", { type: "password", class: "mono", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Refresh token di configurazione", placeholder: apps.configured ? "Incolla un nuovo refresh token per sostituirlo" : "xoxe-…" });
  const save = btn(apps.configured ? "Sostituisci" : "Collega", { icon: "check", cls: apps.configured ? "" : "primary", onclick: async () => {
    if (!input.value.trim()) { input.focus(); return; }
    save.disabled = true;
    const token = input.value;
    input.value = "";
    if (await guard(api("/api/slack/config-token", { method: "PUT", body: { token } }), "Le app Slack seguono il pannello")) {
      await loadState();
      renderSettings();
    }
    save.disabled = false;
  } });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); save.click(); } });
  const now = apps.configured ? btn("Aggiorna tutte adesso", { icon: "refresh", cls: "ghost", onclick: async () => {
    now.disabled = true;
    await guard(api("/api/slack/apps/sync", { method: "POST" }), "App Slack aggiornate");
    now.disabled = false;
  } }) : null;
  return setRows(setRow("Token di configurazione", apps.configured
    ? "Nome, descrizione e immagine di ogni app seguono il pannello: cambi un agente qui e la sua app su Slack si aggiorna da sola."
    : "Con il token di configurazione di Slack nome, descrizione e immagine di ogni app seguono il pannello, senza passare da Slack.",
  h("div", { class: "stack-sm" },
    apps.error ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(apps.error))) : null,
    apps.configured ? null : steps(
      h("span", {}, "apri ", h("a", { href: "https://api.slack.com/apps", target: "_blank", rel: "noopener" }, "api.slack.com/apps"), " e, in fondo alla pagina, in ", h("b", {}, "Your App Configuration Tokens"), " tocca Generate Token per il workspace;"),
      h("span", {}, "copia il ", h("b", {}, "Refresh Token"), " (xoxe-…) e incollalo qui: Cora lo rinnova da sola e lo tiene in hush.")),
    h("div", { class: "input-row" }, input, save, now)), { stack: true }));
}

function steps(...items) {
  return h("ol", { class: "steps" }, items.map((item) => h("li", {}, item)));
}

function discordAccount(agent) {
  const bot = agent.bot || { configured: false, env: "" };
  const actions = bot.user ? badge("Account suo", "on", "check") : badge("Via webhook", bot.configured ? "err" : "", "hash");
  const rows = [];
  if (bot.user) {
    rows.push(setRow("Bot suo", h("span", {}, "Collegato come ", h("b", {}, raw(bot.user.username)), ". ", bot.inGuild ? "È nel server." : "Non è ancora nel server."),
      bot.inGuild ? null : btn("Invita nel server", { icon: "external", href: bot.inviteUrl, target: "_blank", cls: "primary" })));
  } else {
    rows.push(setRow("Bot suo", bot.configured ? tr("Il token salvato non funziona ({error}): incollane uno nuovo.", { error: bot.error || bot.state }) : "Ora parla tramite il bot principale, con nome e avatar suoi. Con un bot tutto suo è online, menzionabile e «sta scrivendo…» a nome suo.",
      h("div", { class: "stack-sm" }, steps(
        h("span", {}, "apri ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "discord.com/developers"), " → New Application, chiamala ", h("b", {}, raw(agent.name)), ";"),
        "sezione Bot → Reset Token → copia;",
        h("span", {}, "incollalo qui: lo controllo con Discord e lo salvo in hush come ", h("code", {}, bot.env), ";"),
        "poi tocca «Invita nel server»."),
      tokenForm({ placeholder: "Token del bot Discord", path: `/api/agents/${agent.id}/bot`, ok: "Token salvato" })), { stack: true }));
  }
  if (bot.configured) {
    const disconnect = armedButton("Scollega app", "Conferma scollegamento", { icon: "power", onconfirm: async () => {
      if (disconnect.disabled) return;
      disconnect.disabled = true;
      await guard((async () => {
        await api(`/api/agents/${agent.id}/bot`, { method: "DELETE" });
        await loadState();
        render();
      })(), "App Discord scollegata");
      disconnect.disabled = false;
    } });
    rows.push(setRow("Scollega l'app", "Torna a parlare tramite il bot principale.", disconnect));
  }
  return panel({ icon: "hash", title: "Account Discord", hint: "Il suo utente su Discord.", actions }, setRows(...rows));
}

function telegramGroupSetup(agent) {
  S.telegramSetups ||= new Map();
  const known = (S.data.telegram?.chats || []).filter((chat) => ["group", "supergroup"].includes(chat.type));
  if (!S.telegramSetups.has(agent.id)) S.telegramSetups.set(agent.id, { chatId: known.length === 1 ? known[0].id : "", probe: "", since: 0, data: null, request: 0, loading: false, error: "" });
  const state = S.telegramSetups.get(agent.id);
  const root = h("div", { class: "telegram-setup" });
  const load = async () => {
    if (state.probe && Date.now() + (state.serverOffset || 0) - state.since >= 30 * 60000) { state.probe = ""; state.since = 0; }
    const request = ++state.request;
    const params = new URLSearchParams({ chatId: state.chatId });
    if (state.probe) { params.set("probe", state.probe); params.set("since", state.since); }
    state.loading = true;
    state.error = "";
    state.draw?.();
    try {
      const data = await api(`/api/agents/${agent.id}/telegram-setup?${params}`);
      if (request !== state.request) return;
      state.data = data;
      state.serverOffset = data.checkedAt - Date.now();
    } catch (error) {
      if (request !== state.request) return;
      state.data = null;
      state.error = error.message;
      if (error.message === "avvia una nuova prova Telegram") { state.probe = ""; state.since = 0; }
    } finally {
      if (request === state.request) { state.loading = false; state.draw?.(); }
    }
  };
  const draw = () => {
    const data = state.data;
    const groups = data?.groups || known;
    const user = data?.bot.user || agent.telegramBot?.user;
    const handle = user?.username ? `@${user.username}` : "";
    const member = data?.group?.member;
    const privacy = data?.bot.state === "ready" ? data.bot.privacyDisabled ? true : data.group?.member === null ? null : ["administrator", "creator"].includes(data.group?.role) : null;
    const listening = data ? Object.values(data.listening).every(Boolean) : null;
    const verified = [data && data.bot.state !== "unavailable" ? data.bot.state === "ready" : null, privacy, member === true ? data.group.canSend : member ?? null, listening, data ? data.probe.state === "complete" : null];
    const ready = verified.slice(0, 4).every((value) => value === true);
    const group = h("select", { "aria-label": "Gruppo Telegram" },
      h("option", { value: "", selected: !state.chatId }, "Scegli il gruppo"),
      groups.map((item) => h("option", { value: item.id, selected: item.id === state.chatId }, raw(item.title))));
    group.addEventListener("change", () => {
      state.chatId = group.value;
      state.probe = "";
      state.since = 0;
      state.data = null;
      load();
    });
    const botfather = btn("Apri BotFather", { href: "https://t.me/BotFather", target: "_blank", icon: "external", cls: "sm" });
    const settings = () => btn("Apri impostazioni Telegram", { href: "#/settings/telegram", icon: "settings", cls: "sm" });
    const invite = handle ? btn("Aggiungi al gruppo", { href: `https://t.me/${user.username}?startgroup=cora`, target: "_blank", icon: "plus", cls: "sm" }) : null;
    const listenHelp = !data ? "Verifica quali chat e piattaforme sono accese."
      : !data.listening.platform ? "Accendi Telegram nelle impostazioni."
        : !data.listening.chat ? "Accendi questo gruppo in Impostazioni → Telegram → Ascolto."
          : !data.listening.agent ? "Accendi l'agente e Telegram nel suo Ascolto, poi salva."
            : !data.listening.assigned ? "Aggiungi questo gruppo ai canali dell'agente nel suo Ascolto, poi salva."
              : "Telegram, gruppo e ascolto dell'agente sono accesi.";
    const sample = handle && state.probe ? `${handle} ${tr("Rispondi a questa prova:")} ${state.probe}` : "";
    const testState = data?.probe.state;
    const testHelp = testState === "complete" ? "Messaggio ricevuto e risposta dell'agente consegnata in questo gruppo."
      : state.probe && !ready ? "Completa i passaggi precedenti, poi verifica di nuovo la risposta."
      : testState === "waiting-reply" ? "Il tuo messaggio è arrivato. La risposta dell'agente non è ancora arrivata: verifica di nuovo."
        : state.probe ? "Invia tu questo messaggio nel gruppo, poi verifica la risposta. La prova deve partire da una persona, non da un altro bot."
          : ready ? "Avvia la prova, copia il messaggio e invialo tu nel gruppo."
            : "Completa i primi quattro passaggi, poi avvia la prova con un tuo messaggio.";
    const rows = [
      ["Collega il bot", data?.bot.state === "ready" ? tr("Telegram riconosce {bot}.", { bot: handle })
        : data?.bot.state === "invalid-token" ? "Telegram rifiuta il token: collegalo di nuovo."
          : data?.bot.state === "unavailable" ? "Telegram non risponde: riprova la verifica."
            : "Cora controlla il token con Telegram, senza mostrarlo.",
      data && ["invalid-token", "missing-token"].includes(data.bot.state) ? tokenForm({ placeholder: "Token di BotFather (123456:ABC…)", path: `/api/agents/${agent.id}/telegram-bot`, ok: "Token salvato" }) : null],
      ["Permetti la lettura nel gruppo", privacy ? data.bot.privacyDisabled ? "Telegram conferma che la privacy è disattivata." : "Telegram conferma che il bot è amministratore del gruppo."
        : privacy === null && data?.bot.state === "ready" ? "Non riesco a verificare la privacy del gruppo: riprova."
        : h("span", {}, tr("In BotFather invia /setprivacy → {bot} → Disable. In alternativa, rendi il bot amministratore del gruppo.", { bot: handle || tr("il tuo bot") })), botfather],
      ["Invita il bot nel gruppo", member && data.group.canSend === false ? "Il bot è nel gruppo ma non può scrivere: controlla i suoi permessi su Telegram."
        : member === null && data?.bot.state === "ready" ? "Non riesco a verificare la presenza nel gruppo: riprova."
        : member ? testState === "complete" ? "Telegram conferma che il bot è nel gruppo." : "Telegram conferma che il bot è nel gruppo. Se hai cambiato la privacy mentre era già qui, rimuovilo e reinvitalo prima della prova."
          : "Aggiungi il bot al gruppo. Se c'era già, rimuovilo e aggiungilo di nuovo per applicare il cambio di privacy.", invite],
      ["Accendi l'ascolto in Cora", listenHelp, h("div", { class: "row" }, settings(), btn("Vai all'Ascolto", { cls: "sm ghost", icon: "radio", onclick: () => {
        document.getElementById("section-tab-ascolto")?.click();
        document.querySelector('input[name="platform-telegram"]')?.closest(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } }))],
      ["Verifica una risposta", testHelp, h("div", { class: "stack-sm" }, sample ? codeLine(sample) : null,
        h("div", { class: "row" }, btn(state.probe ? "Nuova prova" : "Avvia prova", { disabled: !ready || state.loading, cls: state.probe ? "sm ghost" : "sm primary", icon: "send", onclick: () => {
          state.probe = `cora-${Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0")}`;
          state.since = Date.now() + (state.serverOffset || 0) - 1000;
          load();
        } }), state.probe ? btn("Verifica risposta", { disabled: state.loading, cls: testState === "complete" ? "sm" : "sm primary", icon: "refresh", onclick: load }) : null))],
    ];
    const current = verified.findIndex((value) => value !== true);
    root.setAttribute("aria-busy", String(state.loading));
    root.replaceChildren(...[
      h("div", { class: "telegram-setup-toolbar" }, field("Gruppo Telegram", group), btn("Verifica passaggi", { icon: "refresh", disabled: state.loading, cls: "sm", onclick: load })),
      h("p", { class: `telegram-setup-progress${verified.every((value) => value === true) ? " complete" : ""}`, role: "status", "aria-live": "polite" }, state.loading ? "Verifica in corso…" : tr("{done} di {total} passaggi verificati", { done: verified.filter((value) => value === true).length, total: rows.length })),
      state.error ? h("p", { class: "notice warn" }, state.error) : null,
      h("ol", { class: "telegram-setup-steps" }, rows.map(([title, hint, action], index) => {
        const ok = verified[index] === true;
        return h("li", { class: `${ok ? "verified" : index === current ? "current" : ""}` },
          h("span", { class: "telegram-setup-number", "aria-hidden": "true" }, ok ? icon("check") : index + 1),
          h("div", { class: "telegram-setup-body" }, h("div", { class: "telegram-setup-title" }, h("b", {}, title), h("small", {}, ok ? "Verificato" : verified[index] === null ? "Da verificare" : "Da completare")),
            h("p", {}, hint), h("div", { class: "telegram-setup-actions" },
              !ok || index === 4 || (index === 2 && testState !== "complete") ? action : null,
              !ok && index < 4 ? btn("Ho fatto, verifica", { icon: "refresh", disabled: state.loading, cls: "sm ghost", onclick: load }) : null)));
      })),
      !groups.length ? h("p", { class: "muted" }, "Dopo l'invito, premi Verifica passaggi: il gruppo comparirà nell'elenco.") : null].filter(Boolean));
  };
  state.draw = draw;
  draw();
  if (!state.data && !state.loading) load();
  return root;
}

function telegramAccount(agent) {
  const bot = agent.telegramBot || { configured: false, env: "" };
  // Without a group turned on its bot lives in private chats, and that is fine.
  const groups = S.data.settings.telegramChatIds?.length > 0;
  const mainBot = Boolean(S.data.telegram?.user);
  const actions = bot.user
    ? groups ? badge(bot.inChat ? "Nel gruppo" : "Fuori dal gruppo", bot.inChat ? "on" : mainBot ? "err" : "warn", bot.inChat ? "check" : "alert") : badge("In privato", "on", "chat")
    : bot.configured && bot.state === "off" ? badge("Spento qui", "", "power")
      : badge("Bot principale", bot.state === "error" ? "err" : "", "send");
  const where = !groups ? "Scrivigli in privato su Telegram: risponde lui. Per un gruppo, aggiungilo e accendi la chat nelle impostazioni."
    : bot.inChat ? "Il bot è nel gruppo. Verifica qui sotto che riceva i messaggi e risponda."
      : mainBot ? "Non è ancora nel gruppo: finché non lo aggiungi scrive tramite il bot principale."
        : "Non è ancora nel gruppo: aggiungilo per sentirlo lì. In privato risponde già.";
  let body;
  if (bot.configured && !bot.user && bot.state === "off") {
    body = setRows(setRow("Bot suo", h("span", {}, "Il suo bot c'è (", h("code", {}, bot.env), "), ma è spento su Telegram: accendilo in Impostazioni → Ascolto.")));
  } else if (bot.user) {
    body = setRows(
      setRow("Bot suo", h("span", {}, "Collegato come ", h("b", {}, raw(`@${bot.user.username}`)), ". ", where),
        btn("Apri su Telegram", { icon: "external", href: bot.link, target: "_blank" })),
      setRow("Nome e foto", "Il nome segue il pannello; la foto si cambia da BotFather con /setuserpic."));
  } else {
    body = setRows(setRow("Bot suo", bot.state === "error" ? tr("Il token salvato non funziona ({error}): incollane uno nuovo.", { error: bot.error }) : "Ora scrive tramite il bot principale, col suo nome in grassetto. Con un bot tutto suo scrive col suo account ed è menzionabile.",
      h("div", { class: "stack-sm" }, steps(
        h("span", {}, "apri ", h("a", { href: "https://t.me/BotFather", target: "_blank", rel: "noopener" }, "@BotFather"), ", scrivi /newbot e chiamalo ", h("b", {}, raw(agent.name)), ";"),
        "copia il token che ti dà;",
        h("span", {}, "incollalo qui: lo controllo con Telegram e lo salvo in hush come ", h("code", {}, bot.env), ";"),
        "poi tocca «Aggiungi al gruppo»."),
      tokenForm({ placeholder: "Token di BotFather (123456:ABC…)", path: `/api/agents/${agent.id}/telegram-bot`, ok: "Token salvato" })), { stack: true }));
  }
  return panel({ icon: "send", title: "Account Telegram", hint: "Il suo bot su Telegram.", actions }, body,
    bot.configured ? setRows(setRow("Invita a un gruppo", "Segui i passaggi: Cora verifica la configurazione e una risposta reale nel gruppo.", telegramGroupSetup(agent), { stack: true })) : null);
}

function emailCopy(value, label = "Copia indirizzo") {
  return btn(label, { icon: "copy", cls: "sm ghost", onclick: () => navigator.clipboard?.writeText(value).then(() => toast("Copiato"), () => toast("Non riesco a copiare: selezionalo a mano", true)) });
}

async function agentEmailTab(agent, isCurrent = () => true) {
  let data;
  try { data = await api(`/api/agents/${agent.id}/mailbox`); }
  catch (error) { return panel({ icon: "alert", title: "Email non disponibile" }, h("p", { role: "alert" }, raw(tr(error.message))), btn("Riprova", { icon: "refresh", onclick: renderAgent })); }
  if (!isCurrent()) return null;
  const mailbox = data.mailbox;
  const ready = mailbox?.status === "ready";
  const address = ready ? h("div", { class: "mail-address" },
    h("a", { href: `mailto:${mailbox.email}` }, raw(mailbox.email)), emailCopy(mailbox.email)) :
    h("p", { class: "muted" }, mailbox?.status === "blocked" ? "La casella non è ancora pronta. Puoi riprovare assegnandole un indirizzo qui sotto." : "L'agente avrà una casella tutta sua, per inviare e ricevere email.");
  const identity = panel({ icon: "mail", title: "La sua email", hint: "Puoi scrivere all'agente a questo indirizzo e chiedergli di usare la sua casella.", actions: ready ? tag("Attiva", "ok") : null }, address,
    ready ? h("p", { class: "muted" }, "L'agente usa questo indirizzo quando gli chiedi di inviare posta.") : null);
  if (!data.available) return agentEmailWorkspace(agent, [identity, panel({ icon: "info", title: "Email non disponibile" }, h("p", {}, "Il servizio email non è ancora configurato per questo spazio."))]);
  const local = h("input", { type: "text", name: "local", required: true, minlength: 3, maxlength: 32, pattern: "[a-z0-9][a-z0-9\\-]{1,30}[a-z0-9]", autocomplete: "off", autocapitalize: "none", spellcheck: false, "aria-label": "Nome dell'indirizzo", value: ready ? mailbox.email.split("@")[0] : agent.name.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32), placeholder: "nico" });
  const usable = data.domains.filter((domain) => domain.ready);
  const domain = h("select", { name: "domain", required: true, "aria-label": "Dominio email" }, usable.map((item) => h("option", { value: item.name, selected: ready && mailbox.email.endsWith(`@${item.name}`) }, raw(item.name))));
  const feedback = h("p", { class: "mail-feedback", role: "status" });
  const submit = btn(ready ? "Cambia indirizzo" : "Attiva email", { icon: "check", type: "submit", cls: "primary", disabled: !data.canCustomize || !usable.length });
  local.disabled = domain.disabled = !data.canCustomize || !usable.length;
  const form = h("form", { class: "stack", onsubmit: async (event) => {
    event.preventDefault();
    feedback.textContent = tr("Attivazione dell'indirizzo…");
    feedback.classList.remove("err-text");
    submit.disabled = true;
    event.currentTarget.setAttribute("aria-busy", "true");
    try {
      await api(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: local.value, domain: domain.value } });
      await loadState();
      if (isCurrent()) renderAgent();
      toast("Indirizzo email aggiornato");
    } catch (error) { feedback.textContent = tr(error.message); feedback.classList.add("err-text"); submit.disabled = false; form.setAttribute("aria-busy", "false"); }
  } }, h("div", { class: "mail-address-form" }, field("Nome dell'indirizzo", local), h("span", { class: "mail-at", "aria-hidden": "true" }, raw("@")), field("Dominio", domain)),
    h("p", { class: "muted" }, "Da 3 a 32 lettere minuscole, numeri o trattini. Il nuovo indirizzo diventa quello principale; la casella precedente resta accessibile all'agente."),
    !data.canCustomize ? h("p", { class: "muted" }, "Accendi l'agente e abilita il suo computer per assegnargli un'email.") : null,
    !usable.length ? h("p", { class: "muted" }, "Prima verifica un dominio nella pagina Domini.") : null,
    feedback, h("div", { class: "row" }, btn("Gestisci domini", { icon: "globe", href: "#/settings/domini", cls: "ghost" }), h("span", { class: "spacer" }), submit));
  const previous = mailbox?.previousEmails?.length ? panel({ icon: "archive", title: "Indirizzi precedenti", hint: "Restano all'agente, insieme alla posta già ricevuta." },
    mailbox.previousEmails.map((email) => h("div", { class: "mail-address previous" }, h("code", {}, raw(email)), emailCopy(email)))) : null;
  return agentEmailWorkspace(agent, [identity, panel({ icon: "edit", title: "Personalizza indirizzo", hint: "Scegli il nome e uno dei domini pronti per inviare e ricevere." }, form), previous]);
}

function agentEmailWorkspace(agent, mailboxPanels) {
  const entries = [
    ["casella", "Casella", "mail", "Indirizzo e dominio"],
    ["ricezione", "Ricezione e regole", "radio", "Ascolto e resoconti"],
    ["invio", "Invio e firma", "send", "Mittente, risposte e aperture"],
    ["recap", "Recap email", "archive", "Ricevute, inviate e bozze"],
  ];
  const panes = new Map(entries.map(([id]) => [id, h("section", { class: "email-section stack", role: "tabpanel", id: `email-pane-${agent.id}-${id}`, "aria-labelledby": `email-tab-${agent.id}-${id}`, hidden: true })]));
  const tabs = new Map();
  let current = entries.some(([id]) => id === route()[3]) ? route()[3] : "";
  const detail = h("div", { class: "email-workspace-detail" }, btn("Email", { icon: "back", cls: "sm ghost email-section-back", onclick: () => show("") }), [...panes.values()]);
  const nav = h("nav", { class: "email-workspace-nav rail-nav", role: "tablist", "aria-label": "Sezioni email", "aria-orientation": "vertical" },
    h("span", { class: "rail-group" }, "Email"), entries.map(([id, title, mark, hint]) => {
      const tab = h("button", { class: "rail-item", type: "button", role: "tab", id: `email-tab-${agent.id}-${id}`, "aria-controls": `email-pane-${agent.id}-${id}`, onclick: () => show(id) },
        h("span", { class: "rail-mark" }, icon(mark)), h("span", { class: "rail-name" }, h("b", {}, title), h("small", {}, hint)), icon("next", "rail-go"));
      tabs.set(id, tab); return tab;
    }));
  const root = h("div", { class: "email-workspace email-channel" }, nav, detail);
  function show(id, update = true) {
    current = id;
    root.classList.toggle("open", Boolean(current));
    for (const [key, pane] of panes) pane.hidden = key !== (current || "casella");
    for (const [key, tab] of tabs) {
      tab.classList.toggle("active", key === (current || "casella"));
      tab.setAttribute("aria-selected", String(key === (current || "casella")));
      tab.tabIndex = key === (current || "casella") ? 0 : -1;
    }
    detail.scrollTop = 0;
    if (update) {
      history.replaceState(null, "", `#/agent/${agent.id}/email${current ? `/${current}` : ""}`);
      const back = document.querySelector(".appbar a.icon-btn");
      if (back) back.setAttribute("href", current ? `#/agent/${agent.id}/email` : "#/agenti");
    }
  }
  const rules = emailChannelPane(agent, (sections) => {
    panes.get("ricezione").replaceChildren(sections.rules);
    panes.get("invio").replaceChildren(...sections.sending);
    panes.get("recap").replaceChildren(sections.recap);
  }, () => root.isConnected);
  panes.get("casella").replaceChildren(...mailboxPanels.filter(Boolean));
  panes.get("ricezione").append(rules);
  panes.get("invio").append(panel({}, skeleton()));
  panes.get("recap").append(panel({}, skeleton()));
  nav.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const ids = entries.map(([id]) => id), at = ids.indexOf(current || "casella");
    const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + ids.length) % ids.length;
    show(ids[next]); tabs.get(ids[next]).focus();
  });
  show(current, false);
  return root;
}

function emailSettingsTabs(controls, agentsPanel, feedback) {
  const definitions = [["ricezione", "Ricezione", [0, 1, 3, 4]], ["resoconti", "Resoconti", [2]], ["risposte", "Risposte e aperture", [5, 6, 7]], ["agenti", "Agenti", []]];
  const pages = new Map(definitions.map(([id, , rows]) => [id, h("div", { class: "stack", role: "tabpanel", hidden: true }, id === "agenti" ? agentsPanel : setRows(...rows.map((index) => controls[index])))]));
  const buttons = new Map();
  const tabs = h("div", { class: "segmented email-settings-tabs", role: "tablist", "aria-label": "Sezioni email" }, definitions.map(([id, title]) => {
    const button = btn(title, { onclick: () => show(id) });
    button.setAttribute("role", "tab"); buttons.set(id, button); return button;
  }));
  function show(id, update = true) {
    for (const [key, page] of pages) page.hidden = key !== id;
    for (const [key, button] of buttons) { button.classList.toggle("on", key === id); button.setAttribute("aria-selected", String(key === id)); }
    if (update) history.replaceState(null, "", `#/settings/email/${id}`);
  }
  const initial = definitions.some(([id]) => id === route()[2]) ? route()[2] : "ricezione";
  show(initial, false);
  return panel({ icon: "mail", title: "E-mail", hint: "Dall'arrivo della posta al resoconto nel canale scelto." }, h("div", { class: "stack" }, tabs, [...pages.values()], feedback));
}

// The catalogue comes from the server (src/connectors): each module declares its card and its forms.
function connectorsPane() {
  const slot = h("div", { class: "stack connectors-pane" });
  const catalog = h("div", { class: "stack connector-catalog" });
  const detail = h("div", { class: "stack connector-detail", hidden: true });
  const results = h("div", { class: "connector-grid", "aria-live": "polite" });
  const search = h("input", { type: "search", "aria-label": "Cerca connettori", placeholder: "Cerca per nome, servizio o account", autocomplete: "off", maxlength: 200 });
  const filters = h("div", { class: "segmented", role: "group", "aria-label": "Filtra connettori" });
  const filterButtons = new Map();
  let data = null, filter = "all", current = route()[2] || "";
  const modeChoice = new Map(), optionalOpen = new Set();
  const services = () => data?.catalog || [];
  const serviceOf = (id) => services().find((service) => service.id === id) || null;
  const show = (id, update = true) => {
    current = !data || serviceOf(id) ? id || "" : "";
    catalog.hidden = Boolean(current); detail.hidden = !current;
    if (update) history.replaceState(null, "", current ? `#/settings/connettori/${current}` : "#/settings/connettori");
  };
  const keyRecord = (id) => (data?.keyConnectors || []).find((item) => item.service === id) || null;
  const serviceState = (id) => {
    if (serviceOf(id)?.kind === "google") {
      const count = data ? data.connections.length : 0;
      return { connected: count > 0, status: !data ? "In preparazione" : count ? count === 1 ? "1 account collegato" : "{count} account collegati" : data.available ? "Da collegare" : "In preparazione", count };
    }
    const record = keyRecord(id);
    if (!record || record.status === "new") return { connected: false, status: "Da collegare" };
    if (record.status === "connected") return { connected: true, status: record.workspace || "Collegato" };
    if (record.status === "app") return { connected: false, status: "App pronta" };
    return { connected: false, status: "Non serve" };
  };
  const drawCatalog = () => {
    for (const [key, button] of filterButtons) { button.classList.toggle("on", key === filter); button.setAttribute("aria-pressed", String(key === filter)); }
    if (!data) { results.replaceChildren(h("p", { role: "status", class: "muted" }, "Carico i connettori…")); return; }
    const query = search.value.trim().toLocaleLowerCase();
    const cards = services().filter((service) => {
      const state = serviceState(service.id);
      if (filter === "connected" && !state.connected) return false;
      const accounts = service.kind === "google" ? data.connections.map((item) => item.email).join(" ") : `${keyRecord(service.id)?.workspace || ""} ${keyRecord(service.id)?.account || ""}`;
      return `${service.name} ${service.description} ${service.meta} ${service.id} ${accounts}`.toLocaleLowerCase().includes(query);
    });
    if (!cards.length) {
      results.replaceChildren(h("div", { class: "connector-empty" }, icon("search"),
        h("h3", {}, filter === "connected" && !query ? "Nessun connettore collegato" : "Nessun connettore trovato"),
        h("p", {}, filter === "connected" && !query ? "Apri un connettore dal catalogo per collegare il primo account." : "Prova un altro nome o azzera i filtri."),
        btn("Azzera filtri", { cls: "ghost", onclick: () => { search.value = ""; filter = "all"; drawCatalog(); search.focus(); } })));
      return;
    }
    results.replaceChildren(...cards.map((service) => {
      const state = serviceState(service.id);
      const status = state.status.includes("{count}") ? tr(state.status, { count: state.count }) : tr(state.status);
      return h("button", { type: "button", class: "connector-card", "aria-label": tr("Apri connettore {name}", { name: service.name }), onclick: () => { show(service.id); draw(); detail.querySelector(".connector-back")?.focus(); } },
        h("span", { class: "connector-card-head" }, h("span", { class: "connector-mark", "aria-hidden": "true" }, icon(service.icon)), tag(status, state.connected ? "ok" : "agent")),
        h("span", { class: "connector-card-name" }, service.name),
        h("span", { class: "connector-card-description" }, tr(service.description)),
        h("span", { class: "connector-card-meta" }, tr(service.meta)),
        h("span", { class: "connector-card-action" }, tr("Apri connettore"), icon("next")));
    }));
  };
  for (const [id, label] of [["all", "Tutti"], ["connected", "Collegati"]]) {
    const button = btn(label, { onclick: () => { filter = id; drawCatalog(); } });
    filterButtons.set(id, button); filters.append(button);
  }
  search.addEventListener("input", drawCatalog);
  catalog.append(panel({ icon: "link", title: "Connettori", hint: "Scegli un servizio, collega il tuo account e decidi quali agenti possono usarlo." },
    h("div", { class: "connector-toolbar" }, h("div", { class: "connector-search" }, icon("search"), search), filters), results));

  const back = () => btn("Catalogo connettori", { icon: "back", cls: "ghost connector-back", onclick: () => { show(""); drawCatalog(); results.querySelector(".connector-card")?.focus(); } });

  const agentChoices = (record, service) => {
    const feedback = h("p", { class: "muted", role: "status" });
    const choices = (data.agents || []).map((agent) => {
      const input = h("input", { type: "checkbox", checked: record.agents.includes(agent.id), disabled: !data.canManage, "aria-label": tr("Autorizza {name}", { name: agent.name }) });
      input.addEventListener("change", async () => {
        for (const other of choices) other.input.disabled = true;
        try {
          await api(`/api/connectors/keys/${service}`, { method: "PUT", body: { agents: choices.filter((other) => other.input.checked).map((other) => other.id) } });
          feedback.textContent = tr("Agenti autorizzati aggiornati");
          await load();
        } catch (error) { input.checked = !input.checked; feedback.className = "err-text"; feedback.textContent = tr(error.message); for (const other of choices) other.input.disabled = !data.canManage; }
      });
      return { id: agent.id, input, node: h("label", { class: "email-folder" }, input, raw(agent.name)) };
    });
    return h("div", { class: "stack-sm" }, choices.length ? h("div", { class: "email-folders" }, choices.map((item) => item.node)) : h("p", { class: "muted" }, "Crea un agente per autorizzarlo."), feedback);
  };

  const connectedPanel = (service, record) => {
    const feedback = h("p", { class: "muted", role: "status" });
    const disconnect = armedButton("Scollega", "Conferma scollegamento", { icon: "power", onconfirm: async () => {
      disconnect.disabled = true;
      try { await api(`/api/connectors/keys/${service.id}`, { method: "DELETE" }); await load(); toast("Connettore scollegato"); }
      catch (error) { toast(error.message, true); disconnect.disabled = false; }
    } });
    return panel({ icon: service.icon, title: service.name, hint: tr(service.meta), actions: tag(record.workspace || tr("Collegato"), "ok") },
      h("p", {}, tr(service.intro)),
      setRows(
        setRow("Workspace", h("span", {}, raw(record.workspace || record.account || "—"), record.account && record.workspace ? h("small", {}, ` · ${record.account}`) : null), tag("Collegato", "ok")),
        record.mode === "oauth"
          ? setRow("Autorizzazione", h("span", {}, "Token OAuth nella cassaforte come ", h("code", {}, service.secret), ". Cora lo rinnova da solo quando scade."), authorizeButton(service, "Autorizza di nuovo"))
          : setRow("Chiave", h("span", {}, "Nella cassaforte come ", h("code", {}, service.secret), ". Gli agenti autorizzati la prendono da lì, senza vederla.")),
        service.tools?.length ? setRow("Strumenti degli agenti", h("span", { class: "connector-tools" }, "Gli agenti autorizzati hanno uno strumento di Cora per ogni azione, e Cora aggiunge la chiave a ogni chiamata: ", ...service.tools.flatMap((name, index) => [index ? ", " : "", h("code", {}, name)]), ".")) : null,
        setRow("Agenti autorizzati", "Solo gli agenti spuntati possono usare questo connettore.", agentChoices(record, service.id), { stack: true }),
        setRow("Scollega", "Toglie la chiave dalla cassaforte e l'accesso agli agenti.", disconnect)),
      feedback);
  };

  // A registered app is authorised with the owner's account on the service, which then sends them back to Cora.
  const authorizeButton = (service, label) => btn(label, { icon: "link", cls: "primary", disabled: !data.canManage, onclick: async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try { const result = await api(`/api/connectors/keys/${service.id}/authorize`, { method: "POST" }); window.location.assign(result.url); }
    catch (error) { toast(error.message, true); button.disabled = !data.canManage; }
  } });
  const redirectRow = (service) => setRow("Indirizzo di ritorno", "Aggiungilo tra gli indirizzi di ritorno (redirect URL) dell'app sul servizio.",
    service.redirect ? h("code", { class: "connector-redirect" }, raw(service.redirect)) : h("span", { class: "muted" }, "Cora non ha ancora un indirizzo pubblico."));

  const stepParts = (parts) => (Array.isArray(parts) ? parts : [parts]).map((part) => typeof part === "string" ? part
    : part.href ? h("a", { href: part.href, target: "_blank", rel: "noopener" }, part.text) : h("code", {}, part.code));

  // One form for every key connector, drawn from the modes its module declares.
  const keyForm = (service) => {
    const feedback = h("p", { class: "connector-feedback", role: "status" });
    const submit = (label, run) => {
      const button = btn(label, { icon: "check", cls: "primary", onclick: async () => {
        button.disabled = true; feedback.textContent = ""; feedback.classList.remove("err-text");
        try { await run(); await load(); } catch (error) { feedback.textContent = tr(error.message); feedback.classList.add("err-text"); button.disabled = false; }
      } });
      return button;
    };
    const record = keyRecord(service.id);
    const optional = service.optional;
    if (optional && record?.status !== "app" && !optionalOpen.has(service.id)) {
      return panel({ icon: service.icon, title: service.name, hint: tr(service.meta), actions: record?.status === "later" ? tag("Non serve") : tag("Da collegare", "agent") },
        h("p", {}, optional.intro),
        h("p", { role: "status", class: "notice warn" }, optional.notice),
        record?.status === "later" ? h("p", { class: "muted" }, optional.off) : null,
        h("div", { class: "row wrap" }, btn(record?.status === "later" ? optional.restart : optional.start, { icon: "plus", cls: "primary", onclick: () => { optionalOpen.add(service.id); draw(); } }),
          btn(optional.later, { cls: "ghost", onclick: async () => {
            try { await api(`/api/connectors/keys/${service.id}`, { method: "POST", body: { decision: "later" } }); optionalOpen.delete(service.id); await load(); toast(optional.done); }
            catch (error) { toast(error.message, true); }
          } })),
        feedback);
    }
    const modes = service.modes || [];
    const mode = modes.find((item) => item.id === modeChoice.get(service.id)) || modes.find((item) => item.id === record?.mode) || modes[0];
    const inputs = new Map();
    const input = (spec) => {
      const node = h("input", { type: spec.type || "text", placeholder: spec.placeholder, autocomplete: "off", autocapitalize: "none", spellcheck: "false", "aria-label": spec.label });
      inputs.set(spec.name, node);
      return node;
    };
    const send = () => api(`/api/connectors/keys/${service.id}`, { method: "POST", body: { ...(mode.body || {}), ...Object.fromEntries([...inputs].map(([name, node]) => [name, node.value.trim()])) } });
    let toggle = null;
    if (modes.length > 1) {
      toggle = h("div", { class: "segmented", role: "group", "aria-label": tr("Come collegare {name}", { name: service.name }) },
        modes.map((item) => btn(item.label, { onclick: () => { modeChoice.set(service.id, item.id); draw(); } })));
      [...toggle.children].forEach((button, index) => { const on = modes[index] === mode; button.classList.toggle("on", on); button.setAttribute("aria-pressed", String(on)); });
    }
    const rows = (mode.rows || []).map((row) => {
      const parts = [];
      if (row.steps) parts.push(steps(...row.steps.map(stepParts)));
      if (row.field) { const node = input(row.field); parts.push(row.submit ? h("div", { class: "input-row token" }, node, submit(row.submit, send)) : node); }
      if (row.fields) parts.push(h("div", { class: "stack-sm" }, row.fields.map((spec) => field(spec.title, input(spec))), row.submit ? h("div", { class: "row end" }, submit(row.submit, send)) : null));
      if (row.note) parts.push(h("p", { class: "muted" }, row.note));
      const control = parts.length === 1 && !row.steps ? parts[0] : h("div", { class: "stack-sm" }, parts);
      return setRow(row.title, row.hint || null, control, { stack: Boolean(row.steps || row.field || row.fields) });
    });
    const appReady = Boolean(mode.ready && record?.status === mode.ready);
    if (service.oauth && mode.ready) {
      rows.push(redirectRow(service));
      if (appReady) rows.push(setRow("Autorizzazione", tr("App salvata: autorizzala con il tuo account {name}. Cora salva i token nella cassaforte come {secret}.", { name: service.name, secret: service.secret }), authorizeButton(service, tr("Autorizza {name}", { name: service.name }))));
    }
    return panel({ icon: service.icon, title: service.name, hint: tr(service.meta), actions: appReady ? tag("App pronta", "warn") : tag("Da collegare", "agent") },
      h("p", {}, mode.intro || service.intro),
      toggle,
      mode.notice ? h("p", { role: "status", class: "notice warn" }, mode.notice) : null,
      setRows(...rows),
      feedback);
  };

  const keyDetail = (id) => {
    const service = serviceOf(id);
    const record = keyRecord(id);
    return [back(), record?.status === "connected" ? connectedPanel(service, record) : keyForm(service)];
  };

  const googleDetail = () => {
    const connect = btn(data.connections.length ? "Collega un altro account Google" : "Collega account Google", { icon: "plus", cls: "primary", disabled: !data.canManage || !data.available, onclick: async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { const result = await api("/api/connectors/google", { method: "POST" }); window.location.assign(result.url); }
      catch (error) { toast(error.message, true); button.disabled = !data.canManage || !data.available; }
    } });
    const accountNodes = data.connections.map((connection) => {
      const choices = data.agents.map((agent) => {
        const input = h("input", { type: "checkbox", checked: connection.agents.includes(agent.id), disabled: !data.canManage, "aria-label": tr("Autorizza {name}", { name: agent.name }) });
        return { id: agent.id, input, node: h("label", { class: "email-folder" }, input, raw(agent.name)) };
      });
      const feedback = h("p", { role: "status", class: "muted" });
      const senders = h("div", { class: "stack-sm connector-senders" });
      const drawSenders = () => {
        const selected = choices.filter((item) => item.input.checked);
        senders.replaceChildren(h("p", { class: "label" }, "3. Scegli il mittente"),
          h("p", { class: "muted" }, "Nella pagina Email dell'agente scegli questo account come mittente."),
          selected.length ? h("div", { class: "row wrap" }, selected.map((item) => btn(raw(tr("Email di {name}", { name: data.agents.find((agent) => agent.id === item.id).name })), { icon: "mail", cls: "ghost sm", href: `#/agent/${item.id}/email/invio` }))) : h("p", { class: "muted" }, "Autorizza almeno un agente per scegliere il mittente."));
      };
      drawSenders();
      for (const item of choices) item.input.addEventListener("change", async () => {
        for (const other of choices) other.input.disabled = true;
        try {
          await api(`/api/connectors/${connection.id}`, { method: "PUT", body: { agents: choices.filter((other) => other.input.checked).map((other) => other.id) } });
          connection.agents = choices.filter((other) => other.input.checked).map((other) => other.id);
          feedback.className = "muted"; feedback.textContent = tr("Agenti autorizzati aggiornati"); drawSenders();
        } catch (error) { item.input.checked = !item.input.checked; feedback.className = "err-text"; feedback.textContent = tr(error.message); }
        finally { for (const other of choices) other.input.disabled = !data.canManage; }
      });
      let armed = false;
      const disconnect = btn("Scollega", { icon: "power", cls: "ghost danger", disabled: !data.canManage, onclick: async () => {
        if (!armed) { armed = true; disconnect.textContent = tr("Conferma scollegamento"); return; }
        disconnect.disabled = true;
        try { await api(`/api/connectors/${connection.id}`, { method: "DELETE" }); await load(); }
        catch (error) { toast(error.message, true); disconnect.disabled = !data.canManage; }
      } });
      return panel({ icon: "mail", title: raw(connection.email), hint: "Account Google collegato", actions: disconnect },
        h("p", { class: "label" }, "2. Autorizza gli agenti"),
        choices.length ? h("div", { class: "email-folders" }, choices.map((item) => item.node)) : h("p", { class: "muted" }, "Crea un agente per assegnargli questo account."), feedback, senders);
    });
    return [back(),
      panel({ icon: "mail", title: "Google", hint: "Gmail e Google Workspace", actions: tag(data.connections.length ? "Collegato" : "Da collegare", data.connections.length ? "ok" : "agent") },
        h("p", {}, "Collega Gmail o Google Workspace con Fluxkit per inviare email dal tuo indirizzo."),
        h("p", { class: "muted" }, "Scegli quali agenti possono usare ogni account. La posta in arrivo di Google resta nel tuo account."),
        data.notice ? h("p", { role: "status" }, raw(tr(data.notice))) : null,
        setRows(setRow("1. Collega il tuo account", "Accedi su Google e conferma il permesso di invio. Puoi collegare più account.", h("div", { class: "stack-sm" },
          !data.available ? h("p", { role: "status", class: "notice warn" }, "Il collegamento di nuovi account Google non è disponibile in questo spazio. Puoi continuare a usare e gestire gli account già collegati.") : null,
          !data.canManage ? h("p", { class: "muted" }, "Solo il proprietario cambia i connettori.") : null,
          h("div", { class: "row" }, connect)), { stack: true }))),
      ...accountNodes];
  };

  const draw = () => {
    catalog.hidden = Boolean(current); detail.hidden = !current;
    drawCatalog();
    if (!current) return;
    if (!data) { detail.replaceChildren(back(), h("p", { class: "muted", role: "status" }, "Carico i connettori…")); return; }
    try { detail.replaceChildren(...(serviceOf(current)?.kind === "google" ? googleDetail() : keyDetail(current))); }
    catch (error) { detail.replaceChildren(back(), panel({ icon: "alert", title: "Connettore non disponibile" }, h("p", { role: "alert" }, raw(tr(error.message))))); }
  };

  slot.append(catalog, detail);
  async function load() {
    try {
      const response = await api("/api/connectors");
      if (!slot.isConnected) return;
      data = response;
      if (current && !serviceOf(current)) show("");
      slot.replaceChildren(catalog, detail);
      draw();
    } catch (error) { slot.replaceChildren(panel({ icon: "alert", title: "Connettori non disponibili" }, h("p", { role: "alert" }, raw(tr(error.message))), btn("Riprova", { icon: "refresh", onclick: load }))); }
  }
  slot.openCatalog = () => { show(""); draw(); };
  slot.readyConnectors = Promise.resolve().then(load);
  draw();
  return slot;
}

function panelMcpPane() {
  const endpoint = h("input", { type: "text", class: "mono", readonly: true, "aria-label": "Indirizzo MCP" });
  const name = h("input", { type: "text", name: "mcpName", required: true, maxlength: 80, placeholder: "es. Agente di lavoro", autocomplete: "off" });
  const days = h("select", { name: "mcpDays", "aria-label": "Durata dell’accesso MCP" }, [7, 30, 90, 365].map(value => h("option", { value, selected: value === 90 }, raw(tr("{count} giorni", { count: value })))));
  const readOnly = switchInput("mcpReadOnly", "Solo lettura", false, "Permette di consultare le configurazioni senza modificarle.");
  const token = h("input", { type: "password", class: "mono", readonly: true, autocomplete: "off", "aria-label": "Token MCP creato" });
  const feedback = h("p", { role: "status", class: "muted" });
  const rows = h("div", { class: "mcp-token-list" }, h("p", { class: "muted", role: "status" }, "Carico gli accessi MCP…"));
  const identity = h("p", { class: "muted" });
  let saving = false;
  const copy = async (input) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(input.value);
      else { input.focus(); input.select(); if (!document.execCommand("copy")) throw new Error("copy"); }
      toast("Copiato");
    } catch { input.focus(); input.select(); toast("Copia il valore dal campo selezionato.", true); }
  };
  const reveal = btn("Mostra", { icon: "eye", cls: "ghost", onclick: () => { const hidden = token.type === "password"; token.type = hidden ? "text" : "password"; reveal.textContent = tr(hidden ? "Nascondi" : "Mostra"); } });
  const receipt = h("div", { class: "mcp-secret stack-sm", hidden: true },
    h("b", {}, "Salva il token prima di chiudere questa pagina"),
    h("p", {}, "Lo mostriamo solo ora. Incollalo nel campo token o nelle impostazioni sicure del tuo client."),
    h("div", { class: "mcp-key-controls" }, token, reveal, btn("Copia token", { icon: "copy", cls: "primary", onclick: () => copy(token) })),
    btn("Ho salvato il token", { icon: "check", cls: "ghost", onclick: () => { token.value = ""; token.type = "password"; receipt.hidden = true; submit.disabled = false; } }));
  const submit = btn("Crea accesso MCP", { icon: "plus", cls: "primary", type: "submit" });
  const form = h("form", { class: "mcp-create stack-sm" },
    h("div", { class: "mcp-create-fields" }, field("Nome del client", name), field("Durata", days)), readOnly,
    h("div", { class: "row end" }, submit));
  const root = h("div", { class: "stack panel-mcp" },
    panel({ icon: "link", title: "Agenti esterni (MCP)", hint: "Configura Cora da un altro agente con i tuoi permessi." },
      identity, h("p", { class: "muted" }, "Le operazioni dello spazio restano riservate al proprietario. Le risorse private seguono proprietari e condivisioni."),
      setRows(setRow("Indirizzo MCP", "Nel client scegli HTTP o Streamable HTTP e incolla questo indirizzo.", h("div", { class: "mcp-key-controls" }, endpoint, btn("Copia indirizzo", { icon: "copy", cls: "ghost", onclick: () => copy(endpoint) })), { stack: true }),
        setRow("Autenticazione", "Usa un token personale creato qui sotto.", codeLine("Authorization: Bearer <token>"), { stack: true }))),
    panel({ icon: "key", title: "I tuoi accessi MCP", hint: "Un accesso per ogni client: puoi revocarlo quando vuoi.", actions: btn("Ricarica", { icon: "refresh", cls: "ghost", onclick: () => load() }) },
      form, receipt, feedback, rows));
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(new Date(value)) : "—";
  async function load() {
    try {
      const data = await api("/api/mcp/tokens");
      if (!root.isConnected) return;
      endpoint.value = data.endpoint;
      identity.textContent = tr("Il client agirà come {name}.", { name: data.user.name });
      rows.replaceChildren(...(data.tokens.length ? data.tokens.map(record => {
        let armed = false;
        const revoke = btn("Revoca", { icon: "unlink", cls: "ghost danger", onclick: async () => {
          if (!armed) { armed = true; revoke.textContent = tr("Conferma revoca"); return; }
          revoke.disabled = true; feedback.textContent = "";
          try { await api(`/api/mcp/tokens/${record.id}`, { method: "DELETE" }); if (token.value.startsWith(`cora_mcp_${record.id}.`)) { token.value = ""; receipt.hidden = true; submit.disabled = false; } await load(); }
          catch (error) { feedback.className = "err-text"; feedback.textContent = tr(error.message); revoke.disabled = false; }
        } });
        const expired = !(Date.parse(record.expiresAt) > Date.now());
        return h("article", { class: "mcp-token-row", "data-token-id": record.id },
          h("div", { class: "stack-sm" }, h("b", {}, raw(record.name)), h("div", { class: "row" }, tag(expired ? "Scaduto" : "Valido", expired ? "err" : "ok"), tag(record.readOnly ? "Solo lettura" : "Lettura e modifiche")),
            h("small", {}, raw(tr("Scade il {date}", { date: date(record.expiresAt) }))),
            h("small", {}, record.lastUsedAt ? raw(tr("Ultimo accesso: {date}", { date: fmtTime(record.lastUsedAt, true) })) : tr("Mai usato"))), revoke);
      }) : [h("p", { class: "muted" }, "Non hai ancora accessi MCP. Crea il primo per collegare un client.")]));
    } catch (error) { rows.replaceChildren(h("p", { class: "err-text", role: "alert" }, raw(tr(error.message)))); }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || token.value) return;
    saving = true; feedback.textContent = "";
    for (const input of [name, days, readOnly.querySelector("input"), submit]) input.disabled = true;
    try {
      const data = await api("/api/mcp/tokens", { method: "POST", body: { name: name.value.trim(), days: Number(days.value), readOnly: readOnly.querySelector("input").checked } });
      token.value = data.token; token.type = "password"; reveal.textContent = tr("Mostra"); receipt.hidden = false; name.value = ""; await load();
    } catch (error) { feedback.className = "err-text"; feedback.textContent = tr(error.message); }
    finally { saving = false; for (const input of [name, days, readOnly.querySelector("input")]) input.disabled = false; submit.disabled = Boolean(token.value); }
  });
  root.readyMcp = Promise.resolve().then(load);
  return root;
}

function emailChannelPane(agent = null, onSections = null, isCurrent = null) {
  const endpoint = agent ? `/api/agents/${agent.id}/email` : "/api/mail/channel";
  const slot = h("div", { class: "stack email-channel", "aria-busy": "true" }, panel({ icon: "mail", title: agent ? "Ricezione e regole" : "E-mail" }, h("p", { role: "status", class: "muted" }, "Carico la posta…")));
  const select = (label, options, value, save) => {
    const input = h("select", { "aria-label": label }, options.map(([id, name]) => h("option", { value: id, selected: String(value) === id }, name)));
    input.addEventListener("change", () => save(input.value, input));
    return input;
  };
  async function load() {
    slot.setAttribute("aria-busy", "true");
    try {
      let data = await api(endpoint);
      if (!(isCurrent ? isCurrent() : slot.isConnected)) return;
      const rules = agent ? data.overrides : data.settings, effective = agent ? data.effective : data.settings;
      const feedback = h("p", { role: "status", class: "mail-feedback" });
      const controls = [];
      const save = async (patch, input) => {
        const before = agent ? data.overrides : data.settings;
        if (input) input.disabled = true;
        feedback.textContent = tr("Salvo…"); feedback.classList.remove("err-text");
        try {
          data = await api(endpoint, { method: "PUT", body: patch });
          feedback.textContent = tr("Regole email aggiornate");
          toast("Regole email aggiornate");
          if (agent) destination.textContent = tr("Resoconti: {channel}", { channel: data.destination?.name || tr("Scegli un canale") });
        } catch (error) {
          feedback.textContent = tr(error.message); feedback.classList.add("err-text"); toast(error.message, true);
          if (input) {
            const key = Object.keys(patch)[0], previous = before[key];
            if (key === "folders") input.checked = before.folders.includes(input.value);
            else if (input.type === "checkbox") input.checked = Boolean(previous);
            else input.value = key === "senders" ? (previous || []).join(", ") : key === "track" ? previous == null && agent ? "inherit" : String(previous ?? true) : previous ?? (["mode", "replyMode"].includes(key) ? "inherit" : "");
          }
        }
        finally { if (input) input.disabled = false; }
      };
      if (!agent) {
        const enabled = h("input", { type: "checkbox", checked: rules.enabled, "aria-label": "Attiva canale E-mail" });
        enabled.addEventListener("change", () => save({ enabled: enabled.checked }, enabled));
        controls.push(setRow("Attiva canale E-mail", "Cora collega le caselle e recupera la posta automaticamente.", enabled));
      }
      const modes = [...(agent ? [["inherit", "Eredita regole generali"]] : []), ["manual", "Manuale"], ["notify", "Solo notifica"], ["auto", "Gestione automatica"]];
      const mode = select("Quando arriva un'email", modes, rules.mode || "inherit", (value, input) => save({ mode: value }, input));
      controls.push(setRow("Quando arriva un'email", "Manuale: controlla su richiesta. Notifica: avvisa nel canale. Automatico: legge e gestisce secondo le regole.", mode, { stack: true }));
      const channels = h("select", { "aria-label": "Canale dei resoconti email" }, h("option", { value: "" }, agent ? "Eredita destinazione generale" : "General, se accessibile"),
        data.channels.map((item) => h("option", { value: item.id, selected: rules.reportChannelId === item.id }, raw(`${item.name} · ${item.guildName || item.kind}`))));
      channels.value = rules.reportChannelId || "";
      channels.addEventListener("change", () => save({ reportChannelId: channels.value }, channels));
      const destination = h("p", { class: "muted" }, agent ? tr("Resoconti: {channel}", { channel: data.destination?.name || tr("Scegli un canale") }) : "Ogni agente scrive solo nei canali a cui può accedere.");
      controls.push(setRow("Canale dei resoconti email", "L'agente può cambiarlo se glielo chiede un utente autorizzato.", h("div", { class: "stack-sm" }, channels, destination), { stack: true }));
      const senders = h("input", { type: "text", value: (rules.senders || []).join(", "), placeholder: "persona@azienda.it, @azienda.it", "aria-label": "Mittenti da ascoltare", autocapitalize: "none", spellcheck: false });
      senders.addEventListener("change", () => save({ senders: senders.value }, senders));
      controls.push(setRow("Mittenti da ascoltare", agent ? "Vuoto: tutti quelli ammessi dalle regole generali. Puoi restringere con indirizzi o domini." : "Vuoto: tutti i mittenti. Spam, messaggi automatici e risposte a sé stesso non svegliano l'agente.", senders, { stack: true }));
      if (!agent) {
        const folders = [ ["inbox", "Posta in arrivo"], ["important", "Importanti"], ["transactional", "Transazionali"], ["notification", "Notifiche"] ].map(([id, label]) => {
          const input = h("input", { type: "checkbox", value: id, checked: rules.folders.includes(id) });
          return { id, input, node: h("label", { class: "email-folder" }, input, label) };
        });
        for (const item of folders) item.input.addEventListener("change", () => save({ folders: folders.filter((other) => other.input.checked).map((other) => other.id) }, item.input));
        controls.push(setRow("Cartelle da ascoltare", "Il recap include anche la posta che non avvia un'attività.", h("div", { class: "email-folders" }, folders.map((item) => item.node)), { stack: true }));
      }
      const replies = select("Risposte via email", [...(agent ? [["inherit", "Eredita regole generali"]] : []), ["draft", "Prepara una bozza"], ["auto", "Consenti risposta automatica"]], rules.replyMode || "inherit", (value, input) => save({ replyMode: value }, input));
      controls.push(setRow("Risposte via email", "La risposta automatica vale durante la gestione automatica e solo verso il mittente.", replies, { stack: true }));
      const instructions = h("textarea", { rows: 4, maxlength: 8000, "aria-label": agent ? "Regole aggiuntive dell'agente" : "Regole email generali", value: rules.instructions || "", placeholder: "Come deve gestire la corrispondenza" });
      instructions.addEventListener("change", () => save({ instructions: instructions.value }, instructions));
      controls.push(setRow(agent ? "Regole aggiuntive dell'agente" : "Regole email generali", agent ? "Si aggiungono alle istruzioni generali." : "Queste istruzioni valgono per tutti gli agenti.", instructions, { stack: true }));
      const track = select("Traccia aperture", [...(agent ? [["inherit", "Eredita regole generali"]] : []), ["true", "Attiva"], ["false", "Disattiva"]], agent && rules.track == null ? "inherit" : String(effective.track), (value, input) => save({ track: value === "inherit" ? null : value === "true" }, input));
      controls.push(setRow("Traccia aperture", "Il caricamento dell'immagine è un indizio di apertura, non una conferma di lettura.", track, { stack: true }));
      if (!data.canManage) for (const row of controls) for (const input of row.querySelectorAll("input,select,textarea")) input.disabled = true;
      const receiving = agent ? [controls[0], controls[1], controls[2], controls[4]] : controls;
      const content = [panel({ icon: "mail", title: agent ? "Ricezione e regole" : "E-mail", hint: agent ? "Le preferenze di questo agente, insieme alle regole dello spazio." : "Dall'arrivo della posta al resoconto nel canale scelto." }, setRows(...receiving), feedback)];
      if (agent) {
        const sender = h("select", { "aria-label": "Mittente delle email", disabled: !data.canManage }, h("option", { value: "" }, "La casella dell'agente"),
          (data.senders || []).map((item) => h("option", { value: item.id, selected: rules.senderId === item.id }, raw(item.email))));
        if (rules.senderId && !data.senders?.some((item) => item.id === rules.senderId)) sender.append(h("option", { value: rules.senderId, selected: true }, "Account da ricollegare"));
        sender.value = rules.senderId || "";
        sender.addEventListener("change", () => save({ senderId: sender.value }, sender));
        content.push(panel({ icon: "send", title: "Mittente delle email", hint: "Usa la sua casella oppure un account esterno autorizzato." }, sender,
          h("a", { href: "#/settings/connettori", class: "muted" }, "Gestisci connettori")));
        const signature = h("textarea", { rows: 3, maxlength: 1500, "aria-label": "Testo della firma", value: rules.signature || `${agent.name}\n${agent.mailbox?.email || ""}`, disabled: !data.canManage });
        signature.addEventListener("change", () => save({ signature: signature.value }, signature));
        const preview = h("div", { class: "email-signature-preview", role: "status" });
        content.push(panel({ icon: "edit", title: "Firma come immagine", hint: "Il suo avatar, il nome e i dettagli: la stessa firma nelle email HTML." }, field("Testo della firma", signature),
          btn("Mostra anteprima", { icon: "eye", cls: "ghost", onclick: async (event) => {
            const button = event.currentTarget; button.disabled = true;
            preview.replaceChildren(h("p", { class: "muted" }, "Preparo la firma…"));
            try {
              const response = await fetch(`${endpoint}/signature`, { credentials: "same-origin" });
              if (!response.ok) throw new Error("Non riesco a preparare la firma. Riprova.");
              const url = URL.createObjectURL(await response.blob());
              const image = h("img", { src: url, alt: tr("Anteprima della firma"), onload: (event) => { event.currentTarget.width = Math.round(event.currentTarget.naturalWidth / 2); URL.revokeObjectURL(url); } });
              preview.replaceChildren(image);
            } catch (error) { preview.replaceChildren(h("p", { class: "err-text", role: "alert" }, raw(tr(error.message)))); }
            finally { button.disabled = false; }
          } }), preview));
        content.push(emailRecap(agent, data));
      } else {
        content.push(panel({ icon: "users", title: "Caselle degli agenti", hint: "Le regole personali e il recap si trovano nella pagina Email di ogni agente." },
          h("div", { class: "email-agent-list" }, data.agents.map((item) => h("a", { class: "email-agent-row", href: `#/agent/${item.id}/email` }, raw(item.name), h("span", { class: "muted" }, tr("{received} ricevute · {sent} inviate", { received: item.received, sent: item.sent })), icon("chevron"))))));
      }
      if (agent && onSections) {
        onSections({ rules: content[0], sending: [content[1], panel({ icon: "sliders", title: "Risposte e aperture" }, setRows(controls[3], controls[5])), content[2]], recap: content[3] });
      } else if (!agent) slot.replaceChildren(emailSettingsTabs(controls, content[1], feedback));
      else slot.replaceChildren(...content);
      slot.setAttribute("aria-busy", "false");
    } catch (error) {
      slot.setAttribute("aria-busy", "false");
      const failure = () => panel({ icon: "alert", title: "Email non disponibile" }, h("p", { role: "alert" }, raw(tr(error.message))), btn("Riprova", { icon: "refresh", onclick: load }));
      if (onSections) onSections({ rules: failure(), sending: [failure()], recap: failure() });
      else slot.replaceChildren(failure());
    }
  }
  Promise.resolve().then(load);
  return slot;
}

function emailRecap(agent, initial) {
  let data = initial, filter = "all";
  const body = h("div", { class: "stack" });
  const stateLabel = { pending: "In coda", ignored: "Solo ricevuta", notified: "Segnalata", working: "In gestione", processed: "Gestita", stopped: "Fermata", interrupted: "Da verificare", error: "Da verificare", sent: "Inviata", sending: "Invio in corso", uncertain: "Invio da verificare", draft: "Bozza" };
  function draw() {
    const summary = data.summary, status = data.status;
    const modes = [["all", "Tutte"], ["received", "Ricevute"], ["sent", "Inviate"], ["draft", "Bozze"]];
    const picker = h("div", { class: "segmented", role: "group", "aria-label": "Filtra email" }, modes.map(([id, label]) => btn(label, { cls: filter === id ? "on" : "", onclick: () => { filter = id; draw(); } })));
    const messages = data.recent.filter((item) => filter === "all" || item.direction === filter);
    body.replaceChildren(h("div", { class: "email-totals" }, [[summary.received, "Ricevute"], [summary.sent, "Inviate"], [summary.draft, "Bozze"]].map(([value, label]) => h("div", {}, h("strong", {}, raw(value)), h("span", {}, label)))),
      h("div", { class: "row" }, picker, h("span", { class: "spacer" }), btn("Aggiorna posta", { icon: "refresh", cls: "sm ghost", onclick: async (event) => {
        const button = event.currentTarget; button.disabled = true;
        try { data = await api(`/api/agents/${agent.id}/email/refresh`, { method: "POST" }); draw(); }
        catch (error) { toast(error.message, true); button.disabled = false; }
      } })),
      status?.error ? h("p", { class: "err-text", role: "status" }, raw(tr(status.error))) : h("p", { class: "muted" }, status?.checkedAt ? tr("Ultimo controllo: {date}", { date: new Date(status.checkedAt).toLocaleString(LANG) }) : "Il primo controllo partirà automaticamente."),
      status?.partial ? h("p", { class: "muted" }, "Sono mostrate le email più recenti.") : "",
      h("div", { class: "email-ledger" }, messages.length ? messages.map((item) => h("article", { class: "email-ledger-row" },
        h("div", { class: "email-ledger-main" }, icon(item.direction === "received" ? "mail" : "send"), h("div", {}, h("strong", {}, raw(item.subject || tr("Senza oggetto"))), h("p", { class: "muted" }, raw(item.direction === "received" ? item.from : (item.to || []).join(", "))))),
        h("div", { class: "email-ledger-meta" }, tag(item.opened ? "Apertura rilevata" : stateLabel[item.status] || "Ricevuta", item.opened ? "ok" : ["error", "interrupted", "uncertain"].includes(item.status) ? "agent" : ""), h("time", { datetime: item.at }, raw(new Date(item.at).toLocaleString(LANG))),
          item.direction === "sent" && !item.opened ? h("small", { class: "muted" }, item.tracked ? "Nessuna apertura rilevata" : "Tracking disattivato") : null))) : h("p", { class: "muted" }, "Nessuna email da mostrare.")));
  }
  draw();
  return panel({ icon: "mail", title: "Recap email", hint: "La posta ricevuta e inviata dall'agente, con lo stato di gestione e apertura." }, body);
}

function mailDomainChecks(domain, account) {
  const records = domain.records || [];
  const sending = records.filter((item) => ["DKIM", "SPF"].includes(item.record));
  const receiving = records.filter((item) => item.record === "Receiving");
  const sent = domain.status === "verified" && sending.length && sending.every((item) => item.status === "verified");
  const received = domain.capabilities?.receiving === "enabled" && receiving.length && receiving.every((item) => item.status === "verified");
  const checks = [
    [account?.ready, "Account Resend", "Collega e verifica l'account che gestisce il dominio."],
    [sent, sent ? "Invio verificato" : "Verifica invio", "Aggiungi i record DKIM e SPF nel DNS, poi verifica."],
    [received, received ? "Ricezione verificata" : "Verifica ricezione", "Aggiungi il record MX di ricezione nel DNS."],
    [domain.ready && domain.relayReady, "Pronto per gli agenti", "Completa le verifiche per assegnare indirizzi su questo dominio."],
  ];
  let current = false;
  return h("ol", { class: "mail-checks" }, checks.map(([done, title, hint], index) => {
    const active = !done && !current;
    if (active) current = true;
    return h("li", { class: done ? "done" : active ? "current" : "" }, h("span", { class: "mail-step" }, done ? icon("check") : raw(String(index + 1))), h("div", {}, h("b", {}, title), !done ? h("p", {}, hint) : null));
  }));
}

function mailDomainsPane() {
  const slot = h("div", { class: "stack", "aria-busy": "true" }, panel({}, skeleton("rows", 3)));
  const current = () => slot.isConnected && route()[0] === "settings";
  const load = async () => {
    try {
      const data = await api("/api/mail/domains");
      if (!current()) return;
      slot.setAttribute("aria-busy", "false");
      if (!data.available) { slot.replaceChildren(panel({ icon: "mail", title: "Email non disponibile" }, h("p", {}, "Il servizio email non è ancora configurato per questo spazio."))); return; }
      const feedback = h("p", { class: "mail-feedback", role: "alert" });
      const act = async (button, fn) => {
        button.disabled = true;
        feedback.textContent = "";
        try { await fn(); if (current()) await load(); }
        catch (error) { feedback.textContent = tr(error.message); button.disabled = false; feedback.scrollIntoView({ block: "center", behavior: "smooth" }); }
      };
      const accountForm = (account = null) => {
        const name = h("input", { type: "text", required: true, maxlength: 80, value: account?.name || "", placeholder: "Per esempio: Azienda" });
        const key = h("input", { type: "password", required: true, autocomplete: "new-password", placeholder: "re_…", maxlength: 1024 });
        const submit = btn(account ? "Salva nuova chiave" : "Collega account", { icon: "link", cls: "primary", type: "submit" });
        return h("form", { class: "mail-account-form stack", onsubmit: (event) => { event.preventDefault(); act(submit, async () => { await api(account ? `/api/mail/accounts/${account.id}` : "/api/mail/accounts", { method: account ? "PUT" : "POST", body: { name: name.value, key: key.value } }); key.value = ""; }); } },
          field("Nome account", name), field("API key Resend", key), h("p", { class: "muted" }, "Usa una chiave con accesso completo: Cora verifica domini e ricezione. La chiave non viene mostrata agli agenti."),
          h("div", { class: "row" }, btn("Apri Resend", { href: "https://resend.com/api-keys", target: "_blank", icon: "external", cls: "ghost" }), h("span", { class: "spacer" }), submit));
      };
      const accountRows = data.accounts.map((account) => h("article", { class: "mail-account" },
        h("header", {}, h("div", { class: "grow" }, h("h3", {}, raw(account.name)), h("p", { class: "muted" }, "Resend")), tag(account.ready ? "Collegato" : account.error ? "Collegamento da verificare" : "Da verificare", account.ready ? "ok" : account.error ? "err" : "agent"),
          data.canManage ? btn("Verifica account", { icon: "refresh", cls: "sm ghost", onclick: (event) => act(event.currentTarget, () => api(`/api/mail/accounts/${account.id}/check`, { method: "POST" })) }) : null),
        account.error ? h("p", { class: "err-text" }, raw(tr(account.error))) : null,
        data.canManage ? h("details", {}, h("summary", {}, "Sostituisci chiave"), accountForm(account)) : null));
      const accounts = panel({ icon: "key", title: "Account Resend", hint: "Ogni dominio usa l'account a cui appartiene. Puoi collegarne più di uno." },
        accountRows.length ? accountRows : h("p", { class: "muted" }, "Collega il primo account Resend per aggiungere un tuo dominio."),
        data.canManage ? h("details", { open: !accountRows.length, class: "mail-add-account" }, h("summary", {}, "Aggiungi account"), accountForm()) : h("p", { class: "muted" }, "Gli account e i domini vengono gestiti dal proprietario dello spazio."));
      const domainCards = data.domains.map((domain) => panel({ icon: "globe", title: raw(domain.name), hint: raw(domain.accountName), actions: tag(domain.ready ? "Pronto" : "Da completare", domain.ready ? "ok" : "agent") },
        domain.legacy ? h("p", { class: "muted" }, "Dominio di Cora, già disponibile per gli agenti.") : h("div", { class: "stack" },
          mailDomainChecks(domain, data.accounts.find((account) => account.id === domain.accountId)),
          domain.error ? h("p", { class: "err-text", role: "alert" }, raw(tr(domain.error))) : null,
          domain.records?.length ? h("details", { class: "mail-dns", open: !domain.ready }, h("summary", {}, "Record DNS da configurare"), h("p", { class: "muted" }, "Copia questi valori nel pannello DNS del dominio. La verifica può richiedere la propagazione dei record."),
            h("div", { class: "mail-records" }, domain.records.map((record) => h("article", { class: "mail-record" }, h("header", {}, h("b", {}, raw(`${record.record === "Receiving" ? tr("Ricezione") : record.record} · ${record.type}`)), tag(record.status === "verified" ? "Verificato" : "Da verificare", record.status === "verified" ? "ok" : "agent")),
              h("dl", {}, h("dt", {}, "Nome"), h("dd", {}, h("code", {}, raw(record.name || "@")), emailCopy(record.name || "@", "Copia")), h("dt", {}, "Valore"), h("dd", {}, h("code", {}, raw(record.value)), emailCopy(record.value, "Copia")), record.priority !== undefined ? [h("dt", {}, "Priorità"), h("dd", {}, raw(String(record.priority)))] : null))))) : null,
          data.canManage ? h("div", { class: "row" }, btn("Verifica DNS", { icon: "check", cls: "primary", onclick: (event) => act(event.currentTarget, () => api(`/api/mail/domains/${domain.id}/verify`, { method: "POST" })) }), btn("Aggiorna", { icon: "refresh", cls: "ghost", onclick: (event) => act(event.currentTarget, () => api(`/api/mail/domains/${domain.id}/check`, { method: "POST" })) })) : null)));
      let addDomain = null;
      if (data.canManage) {
        const name = h("input", { type: "text", required: true, placeholder: "posta.azienda.it", maxlength: 253, autocapitalize: "none", spellcheck: false });
        const account = h("select", { required: true }, data.accounts.filter((item) => item.ready).map((item) => h("option", { value: item.id }, raw(item.name))));
        const submit = btn("Aggiungi dominio", { icon: "plus", cls: "primary", type: "submit", disabled: !data.accounts.some((item) => item.ready) });
        addDomain = panel({ icon: "plus", title: "Aggiungi dominio", hint: "Scegli il dominio e l'account che lo gestisce." }, h("form", { class: "stack", onsubmit: (event) => { event.preventDefault(); act(submit, () => api("/api/mail/domains", { method: "POST", body: { name: name.value, accountId: account.value } })); } },
          field("Dominio", name), field("Account Resend", account),
          h("p", { class: "mail-domain-note" }, icon("info"), "Se il dominio riceve già posta altrove, usa un sottodominio dedicato: cambiare i record MX cambia dove arrivano le email."),
          !data.accounts.some((item) => item.ready) ? h("p", { class: "muted" }, "Collega e verifica prima un account Resend.") : null, submit));
      }
      slot.replaceChildren(feedback, accounts, ...domainCards, ...(addDomain ? [addDomain] : []));
    } catch (error) {
      if (current()) { slot.setAttribute("aria-busy", "false"); slot.replaceChildren(panel({ icon: "alert", title: "Domini non disponibili" }, h("p", { role: "alert" }, raw(tr(error.message))), btn("Riprova", { icon: "refresh", onclick: load }))); }
    }
  };
  load();
  return h("div", { class: "stack" },
    h("div", { class: "stack-sm" }, h("div", { class: "panel-title" }, h("h2", {}, "Domini")), h("p", { class: "lead muted" }, "Gli indirizzi degli agenti, sui tuoi domini. Collega gli account Resend e verifica invio e ricezione.")), slot);
}

function renderNew() {
  shell([pageHead("Nuovo agente", "Dagli un nome e un carattere."), agentForm({ enabled: true, tools: true })], { title: "Nuovo agente", back: "#/agenti" });
}

async function renderAgent() {
  const view = location.hash;
  S.live = null;
  const [, id, requested = "impostazioni", sub] = route();
  const tab = requested === "profilo" ? "impostazioni" : requested;
  if (requested === "profilo") history.replaceState(null, "", `#/agent/${id}/impostazioni${sub ? "/" + sub : ""}`);
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
  const workspaceTab = ["email", "memoria", "impostazioni", "cervello", "routine"].includes(tab);
  shell([
    h("section", { class: `hero${compact ? " compact" : ""}`, vars: { "--ring": agent.color || "#f2a93b" } },
      avatar(agent, compact ? "" : "lg"),
      h("div", { class: "hero-text" },
        h("h1", {}, raw(agent.name)),
        h("div", { class: "badges" },
          badge(h("span", { class: "hero-model", title: modelLabel(agent.model, { short: true }) }, raw(modelLabel(agent.model, { short: true }))), "", "chip"),
          compact ? null : badge(agent.box?.running ? "Desktop acceso" : "Desktop spento", agent.box?.running ? "on" : "", "monitor"),
          compact || !agent.box?.outdated || !agent.box?.exists ? null : badge("Da aggiornare", "warn", "upgrade"),
          compact ? null : platformBadges(agent)),
        !compact && agent.mailbox?.status === "ready" ? h("a", { class: "agent-email", href: `#/agent/${agent.id}/email` }, icon("mail"), raw(agent.mailbox.email)) : null),
      toggle),
    h("nav", { class: "tabs" }, TABS.map(([key, label, name]) => {
      const count = key === "memoria" ? agent.memoryCount : key === "routine" ? routines.length : null;
      return h("a", { href: `#/agent/${agent.id}/${key}`, class: key === tab ? "active" : "" }, icon(name), h("span", {}, label), count ? h("i", { class: "count" }, count) : null);
    })),
    slot,
  ], { title: agent.name, back: workspaceTab && sub ? `#/agent/${agent.id}/${tab}` : sub ? `#/agent/${agent.id}/ragionamento` : "#/agenti", mode: compact ? "chat" : workspaceTab ? "email" : "" });
  document.querySelector(".tabs a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  const isCurrent = () => slot.isConnected && (workspaceTab ? location.hash.startsWith(`#/agent/${agent.id}/${tab}`) : location.hash === view);
  let body;
  if (tab === "memoria") body = await memoryTab(agent);
  else if (tab === "routine") body = await routineTab(agent, routines);
  else if (tab === "desktop") body = await desktopTab(agent);
  else if (tab === "attivita") body = activityTab(agent);
  else if (tab === "chat") body = await chatPanel(`web-${agent.id}`, { placeholder: tr("Scrivi a {name}…", { name: agent.name }), hint: agent.enabled ? null : "È muto: accendilo per parlarci.", isCurrent });
  else if (tab === "ragionamento") body = sub ? await traceDetail(agent, sub, isCurrent) : await tracesTab(agent, isCurrent);
  else if (tab === "cervello") body = brainTab(agent);
  else if (tab === "email") body = await agentEmailTab(agent, isCurrent);
  else body = agentForm(agent, { only: "profile" });
  if (isCurrent()) slot.replaceChildren(...[body].flat().filter(Boolean));
}

async function memoryTab(agent) {
  const data = await guard(api(`/api/agents/${agent.id}/memories`));
  if (!data) return panel({ icon: "alert", title: "Memoria non disponibile" });
  const source = data.knowledge ? agentKnowledgePane(agent, data.knowledge) : null;
  if (data.source === "external") return sectionWorkspace({ title: "Memoria", base: `#/agent/${agent.id}/memoria`, current: route()[3], entries: [["fonte", "Fonte", "book", "Memoria e knowledge", [source]]] });
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

  // A new memory is a line at the top of the list, like a rule in Accesso: no panel of its own.
  const input = h("input", { type: "text", name: "text", placeholder: "Un fatto da ricordare. Es: «Sara odia le riunioni prima delle 10».", "aria-label": tr("Nuovo ricordo"), autocomplete: "off" });
  const add = h("form", { class: "memory-add" }, input,
    h("div", { class: "memory-add-options" }, data.brain || data.ownerMemory ? null : switchInput("shared", "Condiviso", false), switchInput("pinned", "Fissato", false),
      btn("Aggiungi", { icon: "plus", type: "submit", cls: "primary" })));
  add.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    const body = { text: input.value, shared: Boolean(add.elements.shared?.checked), pinned: add.elements.pinned.checked };
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
    list.replaceChildren(...(shown.length ? shown.map((memory) => memoryItem(agent, memory, data.brain)) : [empty("book", query ? "Nessun ricordo trovato." : "Ancora nessun ricordo.")]));
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
  return sectionWorkspace({ title: "Memoria", base: `#/agent/${agent.id}/memoria`, current: route()[3], entries: [
    ["fonte", "Fonte", "book", "Memoria e knowledge", [source]],
    ["ricordi", data.ownerMemory ? "Ricordi del proprietario" : "Ricordi", "book", "Fatti e preferenze", [panel({ icon: "book", title: data.ownerMemory ? "Ricordi del proprietario" : "Ricordi", hint: `${data.ownerMemory ? (all.length === 1 ? tr("1 ricordo del Brain, disponibile ai proprietari autorizzati e agli agenti che lo usano.") : tr("{count} ricordi del Brain, disponibili ai proprietari autorizzati e agli agenti che lo usano.", { count: all.length })) : data.brain && !data.shared.length ? tr("{count} ricordi suoi. Quelli comuni a tutti sono nel Brain.", { count: all.length }) : tr("{count} tra privati e condivisi.", { count: all.length })} ${tr("A ogni messaggio riaffiorano quelli pertinenti; quelli fissati ci sono sempre.")}` },
      add, h("label", { class: "search" }, icon("search"), search), list)]],
    ["scheda", "Scheda", "layers", "Sempre a mente", [corePanel]],
    ["diario", "Diario", "moon", "Consolidamento e diario", [panel({ icon: "moon", title: "Diario", hint: "Le ultime due pagine gli tornano in mente ogni giorno." }, diary)]],
  ] });
}

function sectionWorkspace({ title, base, current = "", entries, onSelect = () => {} }) {
  const first = entries[0][0], panes = new Map(), tabs = new Map();
  const back = btn(title, { icon: "back", cls: "sm ghost email-section-back", onclick: () => show("") });
  const detail = h("div", { class: "email-workspace-detail" }, back);
  const nav = h("nav", { class: "email-workspace-nav rail-nav", role: "tablist", "aria-label": tr("Sezioni di {title}", { title: tr(title) }), "aria-orientation": "vertical" }, h("span", { class: "rail-group" }, title));
  const root = h("div", { class: "email-workspace" }, nav, detail);
  for (const [id, label, mark, hint, content] of entries) {
    const tabId = `section-tab-${id}`, paneId = `section-pane-${id}`;
    const pane = h("section", { class: "email-section stack", role: "tabpanel", id: paneId, "aria-labelledby": tabId }, content);
    const tab = h("button", { class: "rail-item", role: "tab", type: "button", id: tabId, "aria-controls": paneId, onclick: () => show(id) },
      h("span", { class: "rail-mark" }, icon(mark)), h("span", { class: "rail-name" }, h("b", {}, label), h("small", {}, hint)), icon("next", "rail-go"));
    panes.set(id, pane); tabs.set(id, tab); detail.append(pane); nav.append(tab);
  }
  function show(id, update = true) {
    current = panes.has(id) ? id : "";
    root.classList.toggle("open", Boolean(current));
    for (const [key, pane] of panes) pane.hidden = key !== (current || first);
    for (const [key, tab] of tabs) { tab.classList.toggle("active", key === (current || first)); tab.setAttribute("aria-selected", String(key === (current || first))); tab.tabIndex = key === (current || first) ? 0 : -1; }
    if (update) { history.replaceState(null, "", base.startsWith("#/brain") ? brainHref(base + (current ? "/" + current : "")) : base + (current ? "/" + current : "")); app.querySelector(".appbar a.icon-btn")?.setAttribute("href", base.startsWith("#/brain") ? brainHref(current ? base : "#/brain") : current ? base : "#/agenti"); }
    detail.scrollTop = 0;
    onSelect(current || first);
  }
  nav.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const ids = [...panes.keys()], at = ids.indexOf(current || first);
    const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + ids.length) % ids.length;
    show(ids[next]); tabs.get(ids[next]).focus();
  });
  show(current, false);
  root.selectSection = show;
  return root;
}

function agentKnowledgePane(agent, data) {
  const source = h("select", { "aria-label": tr("Fonte della memoria"), disabled: !data.canManage },
    h("option", { value: "internal", selected: data.source === "internal" }, "Brain interno"),
    h("option", { value: "external", selected: data.source === "external" }, "Brain esterno · sola lettura"));
  const link = h("input", { type: "password", autocomplete: "off", "aria-label": tr("Link al Brain esterno"), placeholder: "https://…", disabled: !data.canManage });
  const external = h("div", { class: "stack-sm" }, link,
    h("p", { class: "muted" }, data.external.configured ? tr("Link salvato: {host}", { host: data.external.host }) : tr("Collega un link HTTPS che espone le pagine in JSON o Markdown.")),
    h("p", { class: "muted" }, "Quando scegli questa fonte, l'agente usa solo il Brain esterno per memoria e knowledge. Se non risponde, segnala il problema."));
  const externalRow = setRow("Brain esterno", null, external, { stack: true });
  externalRow.hidden = source.value !== "external";
  source.addEventListener("change", () => { externalRow.hidden = source.value !== "external"; });
  const owner = data.owners ? h("select", { "aria-label": tr("Proprietario del Brain") },
    h("option", { value: "", selected: !data.owner }, "Non assegnato"),
    data.owners.map((person) => h("option", { value: person.id, selected: person.id === data.owner?.id }, raw(person.name)))) : null;
  const feedback = h("p", { role: "status", class: "muted" });
  const check = btn("Verifica collegamento", { icon: "check", cls: "ghost", disabled: !data.canManage || data.source !== "external", onclick: async () => {
    check.disabled = true;
    try { const result = await api(`/api/agents/${agent.id}/knowledge/check`, { method: "POST" }); feedback.textContent = tr("Collegamento verificato: {count} pagine in sola lettura.", { count: result.pages }); }
    catch (error) { feedback.textContent = tr(error.message); }
    finally { check.disabled = false; }
  } });
  const save = btn("Salva fonte", { icon: "check", cls: "primary", disabled: !data.canManage, onclick: async () => {
    save.disabled = true;
    const body = { source: source.value, ...(link.value.trim() ? { url: link.value.trim() } : {}), ...(owner ? { ownerId: owner.value } : {}) };
    link.value = "";
    try { await api(`/api/agents/${agent.id}/knowledge`, { method: "PUT", body }); await loadState(); renderAgent(); }
    catch (error) { feedback.textContent = tr(error.message); save.disabled = false; }
  } });
  return panel({ icon: "book", title: "Memoria e knowledge", hint: "La fonte che l'agente usa per ricordare e recuperare informazioni." },
    setRows(setRow("Fonte", null, source), externalRow,
      owner ? setRow("Proprietario del Brain", "Gestisce questa memoria.", owner) : null),
    h("div", { class: "row end" }, data.source === "internal" && data.owner ? btn("Apri Brain", { icon: "book", cls: "ghost", href: "#/brain?" + new URLSearchParams({ ownerId: data.owner.id }) }) : null, check, save), feedback);
}

function memoryItem(agent, memory, brain = false) {
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
      brain && memory.scope !== "shared"
        ? btn("", { icon: "bulb", cls: "sm ghost", title: "Manda al brain", onclick: () => update({ shared: true }, "Mandato al bibliotecario del brain") })
        : btn("", { icon: "share", cls: `sm ghost${memory.scope === "shared" ? " lit" : ""}`, title: memory.scope === "shared" ? "Rendi privato" : "Condividi con tutti", onclick: () => update({ shared: memory.scope !== "shared" }, memory.scope === "shared" ? "Ora è privato" : "Ora lo sanno tutti") }),
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

function routineForm(agent, routine = {}, { onCancel, onSaved } = {}) {
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
  const timing = h("div", { class: "stack-sm task-timing" });
  const submit = btn("Crea routine", { icon: "check", type: "submit", cls: "primary" });
  const drawTiming = () => {
    schedule.required = kind === "routine";
    runAt.required = kind === "reminder";
    submit.replaceChildren(icon("check"), h("span", {}, kind === "reminder" ? isNew ? "Crea reminder" : "Salva reminder" : isNew ? "Crea routine" : "Salva routine"));
    timing.replaceChildren(...(kind === "reminder"
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
    S.data.channels.filter((channel) => agentPlatforms(agent).includes(channel.kind || "discord")).map((channel) => h("option", { value: channel.id, selected: channel.id === routine.channelId }, raw(platformsOn().length > 1 ? `${TRANSPORTS[channel.kind || "discord"].label} · ${channelChipLabel(channel)}` : channelChipLabel(channel)))));
  if (routine.channelId && !routine.channelId.startsWith("web") && !S.data.channels.some((channel) => channel.id === routine.channelId)) {
    channelSelect.append(h("option", { value: routine.channelId, selected: true }, tr("{channel} (non attivo)", { channel: channelName(routine.channelId) })));
  }
  const form = panel({ tag: "form", icon: isNew ? "plus" : "edit", title: isNew ? "Nuova attività" : tr("Modifica «{name}»", { name: routine.name }), hint: "Un compito, quando serve, con un risultato da ritrovare." },
    setRows(
      isNew ? setRow("Tipo", "Una routine si ripete; un reminder va una volta sola, poi in archivio.", kindPicker, { stack: true })
        : setRow("Tipo", null, badge(kind === "reminder" ? "Reminder" : "Routine", "", "clock")),
      setRow("Nome", "Come la ritrovi nell'elenco e nell'archivio.", h("input", { type: "text", name: "name", value: routine.name || "", required: true, placeholder: "es. Rassegna stampa" })),
      setRow(platformsOn().length === 1 && S.data.transport === "telegram" ? "Chat" : "Canale", "Dove pubblica il risultato.", channelSelect),
      setRow("Quando", null, timing, { stack: true }),
      setRow("Compito", "Cosa deve fare, dove guardare, cosa riportare.", h("textarea", { name: "prompt", class: "tall", required: true, placeholder: "Cosa deve fare, dove guardare, cosa riportare. Se non c'è niente da dire può restare in silenzio." }, routine.prompt || ""), { stack: true }),
      setRow("Attiva", "Spenta resta in elenco ma non parte.", switchInput("enabled", "", routine.enabled ?? true))),
    h("div", { class: "row end" },
      isNew ? null : btn("Annulla", { icon: "close", ...(onCancel ? { onclick: onCancel } : { href: `#/agent/${agent.id}/routine` }), cls: "ghost" }),
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
    if (onSaved) { onSaved(saved); return; }
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
  const base = `#/agent/${agent.id}/routine`;
  let workspace, archive;
  const editor = h("div", { class: "stack", hidden: true });
  const archiveSlot = h("div", { class: "stack" });
  const createSlot = h("div", { class: "stack" });
  const closeEditor = () => { editor.hidden = true; scheduled.hidden = false; };
  const saved = () => { closeEditor(); drawTasks(); workspace.selectSection("programma"); };
  const edit = (routine) => {
    editor.replaceChildren(routineForm(agent, routine, { onCancel: closeEditor, onSaved: saved }));
    editor.hidden = false; scheduled.hidden = true;
    workspace?.selectSection("programma");
  };
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
          btn("", { icon: "play", cls: "sm", title: reminder && ["blocked", "unverified", "error", "interrupted", "stopped"].includes(routine.lastStatus) ? "Riprova" : "Esegui ora", disabled: routine.running, onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}/run`, { method: "POST" }), "Attività avviata")) scheduleRefresh();
          } }),
          btn("", { icon: "edit", cls: "sm", title: "Modifica", onclick: () => edit(routine) }),
          btn("", { icon: routine.enabled ? "pause" : "power", cls: "sm", title: routine.enabled ? "Metti in pausa" : "Riattiva", onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}`, { method: "PUT", body: { enabled: !routine.enabled } }))) { await loadState(); drawTasks(); }
          } }),
          armedButton("Archivia", "Conferma archiviazione", { cls: "sm", onconfirm: async () => {
            if (await guard(api(`/api/routines/${routine.id}`, { method: "DELETE" }), "Attività archiviata")) { await loadState(); drawTasks(); }
          } }))),
      h("div", { class: "row-meta" }, status, routine.nextRunAt && routine.enabled ? tr("prossima {time}", { time: fmtTime(routine.nextRunAt, true) }) : "", routine.lastRunAt ? tr(" · ultima {time}", { time: fmtTime(routine.lastRunAt, true) }) : ""),
      routine.lastVerification?.reason ? h("p", { class: "task-verification" }, raw(routine.lastVerification.reason)) : null,
      h("details", {}, h("summary", {}, "Compito e ultimo risultato"), h("pre", {}, raw(routine.prompt)), routine.lastOutput ? h("pre", {}, raw(routine.lastOutput)) : null));
  });
  const taskList = h("div", { class: "stack-sm" });
  function drawTasks() {
    const rows = items();
    taskList.replaceChildren(...(rows.length ? rows : [empty("clock", "Nessuna attività in programma. Apri Nuova attività per crearne una.")]));
    const tab = [...document.querySelectorAll(".tabs a")].find((node) => node.getAttribute("href") === base);
    const count = tab?.querySelector(".count");
    if (!rows.length) count?.remove();
    else if (count) count.textContent = rows.length;
    else tab?.append(h("i", { class: "count" }, rows.length));
  }
  drawTasks();
  S.taskRefresh = () => { if (taskList.isConnected) drawTasks(); };
  const scheduled = panel({ icon: "clock", title: "In programma", hint: "Le routine si ripetono. I reminder si archiviano dopo un successo verificato." }, taskList);
  const create = () => routineForm(agent, {}, { onSaved: () => { createSlot.replaceChildren(create()); saved(); } });
  createSlot.append(create());
  const current = params.get("view") === "archive" ? "archivio" : editing ? "programma" : route()[3];
  if (params.has("view") || editing) history.replaceState(null, "", base + "/" + (current || "programma"));
  workspace = sectionWorkspace({ title: "Routine e reminder", base, current, entries: [
    ["programma", "In programma", "clock", "Routine e reminder attivi", [scheduled, editor]],
    ["nuova", "Nuova attività", "plus", "Crea una routine o un reminder", [createSlot]],
    ["archivio", "Archivio", "book", "Esecuzioni, risultati e verifiche", [archiveSlot]],
  ], onSelect: (id) => {
    if (id !== "archivio") return;
    if (!archive) { archive = routineArchive(agent); archiveSlot.append(archive); }
    else archive.refresh();
  } });
  const routine = routines.find((item) => item.id === editing);
  if (routine) edit(routine);
  return workspace;
}

function routineArchive(agent = null) {
  const results = h("div", { class: "task-history-results", role: "status" }, h("p", { class: "muted" }, "Caricamento…"));
  const mode = h("select", { "aria-label": "Mostra" }, h("option", { value: "history" }, "Storico esecuzioni"), h("option", { value: "archive" }, "Attività archiviate"));
  const kind = h("select", { "aria-label": "Tipo di attività" }, h("option", { value: "" }, "Routine e reminder"), h("option", { value: "routine" }, "Routine"), h("option", { value: "reminder" }, "Reminder"));
  const search = h("input", { type: "search", "aria-label": "Cerca nell'archivio", placeholder: "Nome, compito o risultato", maxlength: 200 });
  const agents = h("select", { "aria-label": "Agente" }, h("option", { value: "" }, "Tutti gli agenti"), S.data.agents.map((item) => h("option", { value: item.id }, raw(item.name))));
  let offset = 0;
  let generation = 0;
  const root = panel({ icon: "book", title: "Storico", hint: "Compiti, risultati e verifiche. Una storia che resta anche dopo l'archiviazione." },
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
  root.refresh = load;
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
  if (/^audio\//.test(file.type)) return h("audio", { src: url, controls: true, preload: "metadata", class: "chat-file audio" });
  return h("a", { href: url, class: "chat-file doc" }, icon("file"), raw(file.name));
}

/* ---------- markdown ---------- */
// One pass over the inline marks. Group numbers matter: they are read in mdInline().
const MD_INLINE = [
  "(`+)([^`][\\s\\S]*?)\\1(?!`)",
  "\\[\\[([a-z0-9-]{2,60})\\]\\]",
  "(!?)\\[([^\\]\\n]{1,300})\\]\\(\\s*<?((?:https?:\\/\\/|mailto:)[^\\s)>]+)>?(?:\\s+\"[^\"\\n]*\")?\\s*\\)",
  "<((?:https?:\\/\\/|mailto:)[^>\\s]+)>",
  "(https?:\\/\\/[^\\s<>\"]+)",
  "(\\*\\*|__)(?=\\S)([\\s\\S]*?\\S)\\9(?![*_])",
  "~~(?=\\S)([\\s\\S]*?\\S)~~",
  "(\\*|_)(?=[^\\s*_])([\\s\\S]*?[^\\s\\\\])\\12(?![\\p{L}\\p{N}])",
  "\\\\([\\\\`*_{}\\[\\]()#+\\-.!|~>])",
].join("|");

function mdLink(href, label) {
  return h("a", href.startsWith("mailto:") ? { href } : { href, target: "_blank", rel: "noopener noreferrer" }, label);
}

/** Text with its line breaks kept. */
function mdText(text) {
  return String(text).split("\n").flatMap((line, index) => (index ? [h("br"), raw(line)] : [raw(line)]));
}

function mdInline(text, wiki) {
  const count = (value, char) => value.split(char).length - 1;
  const re = new RegExp(MD_INLINE, "gu");
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const at = m.index;
    let end = at + m[0].length;
    // An underscore inside a word (snake_case) is part of the word.
    if ((m[9] === "__" || m[12] === "_") && /[\p{L}\p{N}]/u.test(text[at - 1] || "")) { re.lastIndex = at + 1; continue; }
    let node;
    if (m[1]) node = h("code", {}, raw(m[2].replace(/^ (.*) $/s, "$1")));
    else if (m[3]) node = wiki ? h("a", { href: `#/brain/p/${m[3]}`, class: "brain-link" }, raw(m[3])) : raw(m[0]);
    else if (m[6]) node = mdLink(m[6], m[4] ? raw(m[5]) : mdInline(m[5], wiki));
    else if (m[7]) node = mdLink(m[7], raw(m[7].replace(/^mailto:/, "")));
    else if (m[8]) {
      // Sentence punctuation after a bare link is not part of it; a closing bracket only when unbalanced.
      let url = m[8];
      while (/[.,;:!?'»…*_]$/.test(url) || (url.endsWith(")") && count(url, ")") > count(url, "("))) url = url.slice(0, -1);
      end = at + url.length;
      re.lastIndex = end;
      node = mdLink(url, raw(url));
    } else if (m[10]) node = h("strong", {}, mdInline(m[10], wiki));
    else if (m[11]) node = h("del", {}, mdInline(m[11], wiki));
    else if (m[13]) node = h("em", {}, mdInline(m[13], wiki));
    else node = raw(m[14]);
    if (at > last) out.push(...mdText(text.slice(last, at)));
    out.push(node);
    last = end;
  }
  if (last < text.length) out.push(...mdText(text.slice(last)));
  return out;
}

function mdCode(body, lang) {
  const copy = btn("", { icon: "copy", cls: "sm ghost", title: "Copia", onclick: () => {
    navigator.clipboard?.writeText(body).then(() => toast("Copiato"), () => toast("Non riesco a copiare: selezionalo a mano", true));
  } });
  return h("div", { class: "md-pre" }, h("div", { class: "md-pre-head" }, h("span", {}, raw(lang)), copy), h("pre", {}, h("code", {}, raw(body))));
}

const MD = {
  fence: /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/,
  rule: /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,
  item: /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/,
  quote: /^\s{0,3}>\s?(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

function mdCells(row) {
  return row.trim().replace(/\\\|/g, "\u0000").replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.replace(/\u0000/g, "|").trim());
}

function mdTable(lines, start, wiki) {
  const head = mdCells(lines[start]);
  const align = mdCells(lines[start + 1]).map((cell) => (/^:-+:$/.test(cell) ? "center" : /-:$/.test(cell) ? "right" : ""));
  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(mdCells(lines[i++]));
  const cell = (tag, text, index) => h(tag, align[index] ? { class: `md-${align[index]}` } : {}, mdInline(text, wiki));
  return {
    node: h("div", { class: "md-table" }, h("table", {},
      h("thead", {}, h("tr", {}, head.map((text, index) => cell("th", text, index)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, head.map((_, index) => cell("td", row[index] || "", index))))))),
    next: i,
  };
}

function mdList(lines, start, wiki) {
  const entries = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j < lines.length && MD.item.test(lines[j])) { i = j; continue; }
      break;
    }
    const m = MD.item.exec(line);
    if (m && !MD.rule.test(line)) {
      const entry = { indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), number: parseInt(m[2], 10), text: m[3] };
      // A numbered list after a bulleted one (or the other way round) is a list of its own.
      if (entries.length && entry.indent <= entries[0].indent && entry.ordered !== entries[0].ordered) break;
      entries.push(entry);
    }
    else if (entries.length && (/^\s{2,}\S/.test(line) || !(MD.heading.test(line) || MD.fence.test(line) || MD.quote.test(line) || MD.rule.test(line) || (line.includes("|") && MD.tableSep.test(lines[i + 1] || ""))))) entries.at(-1).text += `\n${line.trim()}`;
    else break;
    i += 1;
  }
  const newList = (entry) => h(entry.ordered ? "ol" : "ul", entry.ordered && entry.number !== 1 ? { start: entry.number } : {});
  const root = newList(entries[0]);
  const stack = [{ indent: entries[0].indent, list: root, last: null }];
  for (const entry of entries) {
    let top = stack.at(-1);
    if (entry.indent > top.indent + 1 && top.last) {
      const list = newList(entry);
      top.last.append(list);
      stack.push(top = { indent: entry.indent, list, last: null });
    } else {
      while (stack.length > 1 && entry.indent < top.indent) { stack.pop(); top = stack.at(-1); }
    }
    const task = /^\[([ xX])\]\s+(.*)$/s.exec(entry.text);
    const li = task
      ? h("li", { class: "task" }, h("input", { type: "checkbox", disabled: true, checked: task[1] !== " " }), mdInline(task[2], wiki))
      : h("li", {}, mdInline(entry.text, wiki));
    top.list.append(li);
    top.last = li;
  }
  return { node: root, next: i };
}

/**
 * Markdown as people and agents write it, built as DOM nodes: nothing in the
 * text ever becomes HTML. Headings, paragraphs with their line breaks, lists
 * (nested, numbered, with checkboxes), quotes, fenced code, tables and rules;
 * inline code, bold, italic, strikethrough, links (web and mail only) and bare
 * web addresses. With `wiki`, [[slug]] links to that page of the brain.
 */
function markdown(text, { wiki = false } = {}) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  // A numbered line breaks into a paragraph only as "1.": "2026. Poi…" stays a sentence.
  const startsBlock = (line, next) => MD.heading.test(line) || MD.fence.test(line) || MD.rule.test(line) || MD.quote.test(line)
    || (MD.item.test(line) && !/^\s*(?:\d*[02-9]|\d{2,})[.)]\s/.test(line)) || (line.includes("|") && MD.tableSep.test(next || ""));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i += 1; continue; }
    if ((m = MD.fence.exec(line))) {
      const body = [];
      const close = new RegExp(`^\\s{0,3}${m[1][0] === "`" ? "`" : "~"}{${m[1].length},}\\s*$`);
      for (i += 1; i < lines.length && !close.test(lines[i]); i += 1) body.push(lines[i]);
      i += 1;
      blocks.push(mdCode(body.join("\n"), m[2]));
    } else if ((m = MD.heading.exec(line))) {
      blocks.push(h(`h${Math.min(6, m[1].length + 2)}`, {}, mdInline(m[2], wiki)));
      i += 1;
    } else if (MD.rule.test(line)) {
      blocks.push(h("hr"));
      i += 1;
    } else if (line.includes("|") && MD.tableSep.test(lines[i + 1] || "")) {
      const table = mdTable(lines, i, wiki);
      blocks.push(table.node);
      i = table.next;
    } else if (MD.quote.test(line)) {
      const inner = [];
      while (i < lines.length && (m = MD.quote.exec(lines[i]))) { inner.push(m[1]); i += 1; }
      blocks.push(h("blockquote", {}, markdown(inner.join("\n"), { wiki })));
    } else if (MD.item.test(line)) {
      const list = mdList(lines, i, wiki);
      blocks.push(list.node);
      i = list.next;
    } else {
      const paragraph = [line.trim()];
      for (i += 1; i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1]); i += 1) paragraph.push(lines[i].trim());
      blocks.push(h("p", {}, mdInline(paragraph.join("\n"), wiki)));
    }
  }
  return blocks;
}

function chatMessage(item, answer) {
  const agent = item.agentId ? S.data.agents.find((entry) => entry.id === item.agentId) : null;
  const mine = item.kind === "owner" && (!S.data.currentUser || item.authorId === S.data.currentUser.id || item.authorId === "panel");
  const text = item.voiceOnly ? "" : item.file ? item.content.replace(/\s*\[file: [^\]]*\]$/, "") : item.content;
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
      text ? h("div", { class: "text md" }, markdown(text)) : null,
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
    pageHead(h("span", {}, "Il ", h("em", {}, "salotto")), "Tutti gli agenti in onda: risponde chi chiami con la chiocciola, @Nome."),
    requestsStrip(),
    slot,
  ], { title: "Salotto", mode: "chat", back: "#/banco" });
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

/**
 * What each goal cost: every turn that worked toward it, with the tokens they used
 * in and out. A goal opens onto its own turns.
 */
/**
 * A goal and every turn that worked toward it, as one row of the Reasoning
 * list: what it cost, then, opened, its turns. The turns load when it opens.
 */
function goalGroup(agent, item) {
  const turns = h("div", { class: "goal-turns" });
  const total = item.tokensIn + item.tokensOut;
  const [label, cls] = TRACE_STATUS[item.status] || [item.status, ""];
  const row = h("details", { class: "goal-row" },
    h("summary", {},
      h("span", { class: "goal-total" }, h("b", {}, total ? shortTokens(total) : "—"), h("small", {}, "token")),
      h("span", { class: "grow" },
        h("span", { class: "row-meta" }, tag("Obiettivo", "agent"), tag(label, cls),
          raw(`${tr(item.turns === 1 ? "1 esecuzione" : "{count} esecuzioni", { count: item.turns })} · ${tr("{in} in · {out} out", { in: shortTokens(item.tokensIn), out: shortTokens(item.tokensOut) })} · ${traceWhere(item)} · ${fmtTime(item.last, true)}`)),
        usageLine(item),
        h("span", { class: "goal-text" }, raw(item.goal))),
      icon("next", "chev")),
    turns);
  row.addEventListener("toggle", async () => {
    if (!row.open || turns.childElementCount) return;
    turns.append(skeleton("rows", 2));
    const list = ((await guard(api(`/api/agents/${agent.id}/traces?${new URLSearchParams({ goal: item.goal, limit: "100" })}`))) || [])
      .filter((trace) => (trace.channelId || "") === (item.channelId || ""));
    turns.replaceChildren(h("div", { class: "rows" }, list.map((trace) => traceRow(trace))));
  });
  return row;
}

async function tracesTab(agent, isCurrent = () => true) {
  const read = () => Promise.all([guard(api(`/api/agents/${agent.id}/traces`)), guard(api(`/api/agents/${agent.id}/goals`))]);
  const initial = await read();
  if (!isCurrent()) return null;
  const content = h("div", { class: "reasoning-list" });
  const totals = h("span", { class: "reasoning-totals" });
  const rows = new Map();
  const paint = ([list, goals]) => {
    const groups = goals?.goals || [];
    const grouped = (trace) => trace.goal && groups.some((item) => item.goal === trace.goal && (item.channelId || "") === (trace.channelId || ""));
    const ungrouped = (list || []).filter((trace) => !grouped(trace));
    const items = [
      ...groups.map(item => ({ key: JSON.stringify([item.goal, item.channelId || ""]), at: Date.parse(item.last) || 0, item, goal: true })),
      ...ungrouped.map(item => ({ key: item.id, at: Date.parse(item.startedAt) || 0, item })),
    ].sort((a, b) => b.at - a.at);
    const next = items.map(({ key, item, goal }) => {
      let node = goal ? rows.get(key) : null;
      if (node) {
        const summary = node.querySelector("summary"), focused = document.activeElement === summary;
        const updated = goalGroup(agent, item).querySelector("summary");
        summary.replaceWith(updated);
        if (focused) updated.focus();
        for (const link of node.querySelectorAll(".row-link")) {
          const trace = (list || []).find(trace => link.getAttribute("href")?.endsWith(`/ragionamento/${trace.id}`));
          if (trace) link.replaceWith(traceRow(trace));
        }
      } else node = goal ? goalGroup(agent, item) : traceRow(item);
      rows.set(key, node);
      return node;
    });
    for (const key of rows.keys()) if (!items.some(item => item.key === key)) rows.delete(key);
    if (!next.length || content.childElementCount !== next.length || next.some((node, index) => content.children[index] !== node)) {
      content.replaceChildren(...(next.length ? next : [empty("bulb", "Ancora nessun turno registrato.")]));
    }
    const visible = [...groups, ...ungrouped];
    const spent = visible.reduce((sum, item) => sum + (item.tokensIn || 0) + (item.tokensOut || 0), 0);
    const cost = costLabel(visible);
    totals.replaceChildren(...[
      spent ? h("span", { class: "reasoning-total" }, h("b", {}, shortTokens(spent)), h("small", {}, "token")) : null,
      cost ? h("span", { class: "usage-cost" }, raw(cost)) : null,
    ].filter(Boolean));
  };
  paint(initial);
  let pending = null, refreshing = false, again = false;
  const refresh = async () => {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try { const data = await read(); if (isCurrent() && data.every(Boolean)) paint(data); }
    finally { refreshing = false; if (again && isCurrent()) { again = false; pending = setTimeout(() => { pending = null; void refresh(); }, 1500); } }
  };
  S.live = (entry) => {
    if (entry.type !== "trace" || entry.event === "step" || entry.trace.agentId !== agent.id || pending) return;
    pending = setTimeout(() => { pending = null; if (isCurrent()) void refresh(); }, 1500);
  };
  const hint = "Un obiettivo raccoglie le esecuzioni di Cora. Ogni esecuzione può contenere molti passaggi del modello. I costi API si aggiornano con il consumo; i dati storici mancanti restano non disponibili.";
  return panel({ icon: "bulb", title: "Ragionamento", hint, actions: totals }, content);
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
  const usageSlot = h("div", { class: "trace-usage" }, usageLine(trace), h("small", {}, raw(tr("{in} in · {out} out", { in: shortTokens(trace.tokensIn || 0), out: shortTokens(trace.tokensOut || 0) }))));
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
      if (entry.event === "usage" && entry.trace.id === trace.id) usageSlot.replaceChildren(
        usageLine(entry.trace), h("small", {}, raw(tr("{in} in · {out} out", { in: shortTokens(entry.trace.tokensIn || 0), out: shortTokens(entry.trace.tokensOut || 0) }))));
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
      usageSlot,
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
/** The language: of the panel on this device, and of the agents' automatic messages. Saved at once. */
function languagePanel() {
  const choose = h("div", { class: "segmented", role: "group", "aria-label": tr("Lingua") }, Object.entries(LANGS).map(([code, label]) => h("button", { type: "button", class: code === LANG ? "on" : "", "aria-pressed": String(code === LANG), onclick: async () => {
    if (code === LANG) return;
    if (await saveSettings({ language: code })) setLanguage(code);
  } }, raw(label))));
  return panel({ icon: "globe", title: "Lingua", hint: "Gli agenti rispondono comunque nella lingua in cui scrivi." },
    setRows(setRow("Lingua del pannello", "Del pannello su questo dispositivo, e dei messaggi automatici degli agenti.", choose)));
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
  const body = h("div", {}, setRows(setRow("Su questo dispositivo", "Controllo…")));
  const draw = async () => {
    const push = S.data.push || {};
    let text;
    let actions = null;
    if (!push.enabled) text = "Le notifiche non sono ancora configurate sul server.";
    else if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      text = isIos() ? "Su iPhone: tocca Condividi → «Aggiungi alla schermata Home», poi apri Cora da lì e torna qui." : "Questo browser non supporta le notifiche push.";
    } else if (isIos() && !isInstalled()) {
      text = "Su iPhone le notifiche funzionano solo dall'app: Condividi → «Aggiungi alla schermata Home», poi apri Cora da lì.";
    } else if (Notification.permission === "denied") {
      text = "Le notifiche sono bloccate per Cora: riattivale dalle impostazioni del telefono o del browser.";
    } else {
      const subscription = await currentSubscription().catch(() => null);
      if (subscription) {
        text = h("span", {}, "Attive su questo dispositivo", push.devices > 1 ? tr(" (e su altri {count})", { count: push.devices - 1 }) : "", ".");
        actions = [
          btn("Prova", { icon: "bell", onclick: () => guard(api("/api/push/test", { method: "POST" }), "Notifica inviata") }),
          btn("Disattiva qui", { icon: "close", cls: "ghost", onclick: async () => {
            await guard(api("/api/push/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } }));
            await subscription.unsubscribe().catch(() => {});
            await loadState();
            draw();
          } }),
        ];
      } else {
        text = "Ti arrivano le richieste degli agenti, i loro avvisi e le risposte quando il pannello è chiuso.";
        actions = btn("Attiva le notifiche", { icon: "bell", cls: "primary", onclick: () => enableNotifications().then(draw) });
      }
    }
    body.replaceChildren(setRows(setRow("Su questo dispositivo", text, actions)));
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
/* ---------- company brain ---------- */
const BRAIN_KINDS_LABEL = { client: "Cliente", project: "Progetto", person: "Persona", decision: "Decisione", procedure: "Procedura", topic: "Tema" };
const BRAIN_KINDS_PLURAL = { client: "Clienti", project: "Progetti", person: "Persone", decision: "Decisioni", procedure: "Procedure", topic: "Temi" };
const BRAIN_ACTIONS = { create: "Pagina nuova", update: "Modificata", archive: "Archiviata", restore: "Ripristinata", revert: "Annullata" };
const BRAIN_REVIEWS = { pending: "Da rivedere", flagged: "Da verificare", approved: "Approvata", reverted: "Annullata" };

/** Who wrote a brain revision, in the panel's words. */
function brainAuthor(author) {
  if (author === "librarian") return "il bibliotecario";
  if (String(author).startsWith("owner:")) return raw(author.slice(6));
  return raw(author);
}

/** A page's text: markdown, with [[slug]] as links to the other pages; nothing in it becomes HTML. */
function brainText(text) {
  return h("div", { class: "brain-text md" }, markdown(text, { wiki: true }));
}

/** The lines a change took out and put in, as the review shows them. */
function brainDiff(before, after) {
  const a = String(before || "").split("\n");
  const b = String(after || "").split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { rows.push(["same", a[i]]); i += 1; j += 1; }
    else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) { rows.push(["add", b[j]]); j += 1; }
    else { rows.push(["del", a[i]]); i += 1; }
  }
  return h("div", { class: "brain-diff" }, rows.filter(([, line]) => line.trim()).map(([kind, line]) => h("div", { class: `diff-${kind}` }, h("span", { "aria-hidden": "true" }, kind === "add" ? "+" : kind === "del" ? "−" : " "), raw(line))));
}

function brainSources(sources) {
  if (!sources?.length) return null;
  return h("ul", { class: "brain-sources" }, sources.map((source) => h("li", {},
    h("span", { class: "brain-source-who" }, source.author ? raw(source.author) : source.type === "memory" ? "ricordo condiviso" : "qualcuno"),
    h("small", {}, raw([source.channel, source.at ? fmtTime(source.at, true) : ""].filter(Boolean).join(" · "))),
    source.quote ? h("q", {}, raw(source.quote)) : null)));
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) el.setAttribute(key, String(value));
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const plainText = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * The brain as a map: pages as nodes in their kind's colour, sized by how many
 * pages they touch; a [[link]] is a line, a title named without one a dashed
 * line. The layout is a small force simulation with no library: every page
 * pushes the others away, linked pages pull together, and a light pull to the
 * centre keeps loose pages in view. Returns the element and `filter()`.
 */
function brainMap(graph) {
  const nodes = graph.nodes.map((node) => ({ ...node, degree: 0, links: new Set(), x: 0, y: 0, vx: 0, vy: 0, fixed: false, hit: true }));
  const bySlug = new Map(nodes.map((node) => [node.slug, node]));
  const edges = graph.edges.map((edge) => ({ ...edge, a: bySlug.get(edge.source), b: bySlug.get(edge.target) })).filter((edge) => edge.a && edge.b);
  for (const edge of edges) {
    edge.a.degree += 1;
    edge.b.degree += 1;
    edge.a.links.add(edge.b.slug);
    edge.b.links.add(edge.a.slug);
  }
  // The hubs start in the middle, the rest on a sunflower spiral around them: the same map every time.
  nodes.sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
  nodes.forEach((node, index) => {
    const radius = 18 * Math.sqrt(0.5 + index);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    node.x = radius * Math.cos(angle);
    node.y = radius * Math.sin(angle);
    node.r = 9 + 3.2 * Math.sqrt(node.degree);
  });

  const edgeLayer = svgEl("g", { class: "edges" });
  const nodeLayer = svgEl("g", { class: "nodes" });
  const world = svgEl("g", {}, edgeLayer, nodeLayer);
  const svg = svgEl("svg", { class: "brain-map-svg", role: "group", "aria-label": tr("Mappa del brain") }, world);
  for (const edge of edges) edge.el = edgeLayer.appendChild(svgEl("line", { class: `edge ${edge.kind}` }));
  const owner = new Map();
  for (const node of nodes) {
    const label = node.title.length > 30 ? `${node.title.slice(0, 29)}…` : node.title;
    node.el = svgEl("g", { class: `node kind-${node.kind}`, tabindex: 0, role: "button", "aria-label": `${node.title}, ${tr(BRAIN_KINDS_LABEL[node.kind] || node.kind)}` },
      node.pending ? svgEl("circle", { class: "ring", r: (node.r + 4).toFixed(1) }) : null,
      svgEl("circle", { class: "disc", r: node.r.toFixed(1) }),
      svgEl("circle", { class: "core", r: Math.max(2, node.r * 0.28).toFixed(1) }),
      svgEl("text", { class: "name", y: node.r.toFixed(1), dy: "1.25em" }, label));
    node.name = node.el.querySelector(".name");
    owner.set(node.el, node);
    nodeLayer.append(node.el);
  }

  /* ---------- the simulation ---------- */
  let alpha = 1;
  // The map takes the well's shape: on a wide screen the pull to the centre is weaker across than down, on a phone the other way round.
  const gravity = { x: 0.04, y: 0.07 };
  const shape = () => {
    const ratio = Math.min(2.5, Math.max(0.5, (svg.clientWidth || 16) / (svg.clientHeight || 10)));
    gravity.x = 0.07 / ratio ** 1.3;
  };
  const tick = () => {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let l2 = dx * dx + dy * dy;
        if (l2 > 400000) continue;
        if (l2 < 0.01) { dx = (i - j) * 0.1; dy = 0.1; l2 = dx * dx + dy * dy; }
        const push = (240 * alpha) / l2;
        a.vx -= dx * push; a.vy -= dy * push;
        b.vx += dx * push; b.vy += dy * push;
        const room = a.r + b.r + 24;
        if (l2 < room * room) {
          const l = Math.sqrt(l2);
          const overlap = ((room - l) / l) * 0.35;
          a.vx -= dx * overlap; a.vy -= dy * overlap;
          b.vx += dx * overlap; b.vy += dy * overlap;
        }
      }
    }
    for (const { a, b, kind } of edges) {
      const dx = b.x + b.vx - a.x - a.vx;
      const dy = b.y + b.vy - a.y - a.vy;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = ((l - (kind === "link" ? 95 : 140)) / l) * alpha * ((kind === "link" ? 0.8 : 0.3) / Math.min(a.degree, b.degree)) * 0.5;
      a.vx += dx * pull; a.vy += dy * pull;
      b.vx -= dx * pull; b.vy -= dy * pull;
    }
    for (const node of nodes) {
      if (node.fixed) { node.vx = 0; node.vy = 0; continue; }
      node.vx = (node.vx - node.x * gravity.x * alpha) * 0.6;
      node.vy = (node.vy - node.y * gravity.y * alpha) * 0.6;
      node.x += node.vx;
      node.y += node.vy;
    }
    alpha *= 0.977;
  };
  const draw = () => {
    for (const { el, a, b } of edges) {
      el.setAttribute("x1", a.x.toFixed(1)); el.setAttribute("y1", a.y.toFixed(1));
      el.setAttribute("x2", b.x.toFixed(1)); el.setAttribute("y2", b.y.toFixed(1));
    }
    for (const node of nodes) node.el.setAttribute("transform", `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
    declutter();
  };
  // Names that would overlap on screen: the better-linked page keeps its name, and the chosen page and its neighbours always do.
  const byWeight = [...nodes].sort((a, b) => b.degree - a.degree);
  const declutter = () => {
    if (!svg.isConnected) return;
    const placed = [];
    const overlaps = (box, other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1];
    // Every disc is in the way of the other pages' names.
    const discs = nodes.map((node) => {
      const x = node.x * view.k + view.x;
      const y = node.y * view.k + view.y;
      const r = node.r * view.k;
      return { node, box: [x - r, y - r, x + r, y + r] };
    });
    const first = selected ? [selected, ...byWeight.filter((node) => selected.links.has(node.slug))] : [];
    for (const node of [...first, ...byWeight.filter((node) => !first.includes(node))]) {
      node.width ||= node.name.getComputedTextLength() * view.k;
      const x = node.x * view.k + view.x;
      const y = (node.y + node.r) * view.k + view.y;
      const box = [x - node.width / 2 - 3, y + 2, x + node.width / 2 + 3, y + 18];
      const free = node === selected || (!placed.some((other) => overlaps(box, other)) && !discs.some((disc) => disc.node !== node && overlaps(box, disc.box)));
      node.name.style.display = free ? "" : "none";
      if (free) placed.push(box);
    }
  };

  /* ---------- the view: pan, zoom, fit ---------- */
  const view = { k: 1, x: 0, y: 0 };
  let touched = false;
  const apply = () => {
    world.setAttribute("transform", `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`);
    // Names keep their size on screen: zooming in spreads the pages, not the letters.
    svg.style.setProperty("--k", view.k.toFixed(3));
    declutter();
  };
  const fit = () => {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    if (!width || !height || !nodes.length) return;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.r); maxX = Math.max(maxX, node.x + node.r);
      minY = Math.min(minY, node.y - node.r); maxY = Math.max(maxY, node.y + node.r);
    }
    // Screen room for the names on the sides and below, and for the legend on top.
    const k = Math.min(1.6, Math.max(0.2, Math.min((width - 170) / Math.max(maxX - minX, 1), (height - 120) / Math.max(maxY - minY, 1))));
    view.k = k;
    view.x = width / 2 - (k * (minX + maxX)) / 2;
    view.y = (height + 36) / 2 - (k * (minY + maxY)) / 2;
    apply();
  };
  const zoomAt = (px, py, factor) => {
    const k = Math.min(3, Math.max(0.2, view.k * factor));
    view.x = px - ((px - view.x) * k) / view.k;
    view.y = py - ((py - view.y) * k) / view.k;
    view.k = k;
    apply();
  };
  let frame = 0;
  let frames = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const run = () => {
    if (frame) return;
    const step = () => {
      if (!frames) shape();
      frames += 1;
      tick();
      if (alpha > 0.3) tick();
      draw();
      if (!touched) fit();
      frame = alpha > 0.005 && (svg.isConnected || frames < 10) ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  };

  /* ---------- selection and the card ---------- */
  const card = h("div", { class: "brain-map-card", hidden: true, "aria-live": "polite" });
  let selected = null;
  const select = (node) => {
    selected = node;
    svg.classList.toggle("focus", Boolean(node));
    for (const other of nodes) {
      other.el.classList.toggle("on", Boolean(node) && (other === node || node.links.has(other.slug)));
      other.el.classList.toggle("picked", other === node);
    }
    for (const edge of edges) edge.el.classList.toggle("on", Boolean(node) && (edge.a === node || edge.b === node));
    declutter();
    if (!node) { card.hidden = true; return; }
    const linked = [...node.links].map((slug) => bySlug.get(slug)).sort((a, b) => b.degree - a.degree);
    card.replaceChildren(
      h("div", { class: "row" }, badge(BRAIN_KINDS_LABEL[node.kind] || raw(node.kind)), node.pending ? badge("Da rivedere", "warn") : null, h("span", { class: "spacer" }),
        btn("", { icon: "close", cls: "sm ghost", title: "Chiudi", onclick: () => select(null) })),
      h("b", {}, raw(node.title)),
      node.summary ? h("p", {}, raw(node.summary)) : null,
      h("small", {}, linked.length === 1 ? tr("1 pagina collegata") : tr("{count} pagine collegate", { count: linked.length })),
      linked.length ? h("div", { class: "chips" }, linked.slice(0, 12).map((other) => h("button", { type: "button", class: "chip", onclick: () => select(other) }, raw(other.title)))) : null,
      h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Apri la pagina", { icon: "next", cls: "sm primary", href: `#/brain/p/${node.slug}` })));
    card.hidden = false;
    reveal(node);
  };
  // A page the card would cover glides into the free part of the well, above the card.
  let glide = 0;
  const reveal = (node) => {
    const width = svg.clientWidth;
    const room = svg.getBoundingClientRect();
    const cardTop = card.getBoundingClientRect().top - room.top;
    const cardRight = card.getBoundingClientRect().right - room.left;
    const x = node.x * view.k + view.x;
    const y = node.y * view.k + view.y;
    const covered = y + node.r * view.k > cardTop - 12 && (cardRight > width - 40 || x - node.r * view.k < cardRight + 12);
    if (!covered && y > 60) return;
    const target = { x: view.x + width / 2 - x, y: view.y + Math.max(70, cardTop / 2) - y };
    const from = { x: view.x, y: view.y };
    const started = performance.now();
    touched = true;
    cancelAnimationFrame(glide);
    const step = (now) => {
      const t = reduced ? 1 : Math.min(1, (now - started) / 320);
      const ease = 1 - (1 - t) ** 3;
      view.x = from.x + (target.x - from.x) * ease;
      view.y = from.y + (target.y - from.y) * ease;
      apply();
      if (t < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };
  const open = (node) => { location.hash = `#/brain/p/${node.slug}`; };

  /* ---------- pointer, wheel and keys ---------- */
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let lastTap = { node: null, at: 0 };
  const local = (event) => {
    const box = svg.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  svg.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    try { svg.setPointerCapture(event.pointerId); } catch {}
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinch = { distance: Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, k: view.k, x: view.x, y: view.y, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] };
      drag = null;
      return;
    }
    const node = owner.get(event.target.closest?.(".node")) || null;
    drag = { node, start: local(event), moved: false, viewX: view.x, viewY: view.y };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, local(event));
    if (pinch && pointers.size === 2) {
      touched = true;
      const [p, q] = [...pointers.values()];
      const k = Math.min(3, Math.max(0.2, (pinch.k * (Math.hypot(p[0] - q[0], p[1] - q[1]) || 1)) / pinch.distance));
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      view.x = mid[0] - ((pinch.mid[0] - pinch.x) * k) / pinch.k;
      view.y = mid[1] - ((pinch.mid[1] - pinch.y) * k) / pinch.k;
      view.k = k;
      apply();
      return;
    }
    if (!drag) return;
    const [x, y] = local(event);
    if (!drag.moved && Math.hypot(x - drag.start[0], y - drag.start[1]) < 5) return;
    drag.moved = true;
    touched = true;
    if (drag.node) {
      drag.node.fixed = true;
      drag.node.x = (x - view.x) / view.k;
      drag.node.y = (y - view.y) / view.k;
      alpha = Math.max(alpha, 0.25);
      draw();
      run();
    } else {
      svg.classList.add("grabbing");
      view.x = drag.viewX + x - drag.start[0];
      view.y = drag.viewY + y - drag.start[1];
      apply();
    }
  });
  const release = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    svg.classList.remove("grabbing");
    if (drag && !drag.moved) {
      const now = Date.now();
      if (drag.node && lastTap.node === drag.node && now - lastTap.at < 400) open(drag.node);
      else select(drag.node);
      lastTap = { node: drag.node, at: now };
    }
    if (drag?.node) drag.node.fixed = false;
    drag = null;
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    touched = true;
    const [x, y] = local(event);
    zoomAt(x, y, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  svg.addEventListener("keydown", (event) => {
    const node = owner.get(event.target.closest?.(".node"));
    if (event.key === "Escape") { select(null); return; }
    if (!node || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (selected === node) open(node);
    else select(node);
  });

  const tools = h("div", { class: "brain-map-tools" },
    btn("", { icon: "plus", cls: "sm", title: "Avvicina", onclick: () => { touched = true; zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.3); } }),
    btn("", { icon: "minus", cls: "sm", title: "Allontana", onclick: () => { touched = true; zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1 / 1.3); } }),
    btn("", { icon: "maximize", cls: "sm", title: "Mostra tutto", onclick: () => { touched = false; fit(); } }));
  const counts = new Map();
  for (const node of nodes) counts.set(node.kind, (counts.get(node.kind) || 0) + 1);
  const legend = h("div", { class: "brain-map-legend", "aria-hidden": "true" },
    Object.keys(BRAIN_KINDS_PLURAL).filter((kind) => counts.has(kind)).map((kind) => h("span", { class: `kind-${kind}` }, h("i"), BRAIN_KINDS_PLURAL[kind], h("em", {}, String(counts.get(kind))))),
    edges.length ? h("span", { class: "lines" }, h("i", { class: "line" }), "collegamento") : null,
    edges.some((edge) => edge.kind === "mention") ? h("span", { class: "lines" }, h("i", { class: "line mention" }), "citazione") : null);
  const element = h("div", { class: "brain-map" }, svg, legend, tools, card,
    h("div", { class: "brain-map-hint" }, "Trascina per spostarti · rotella per lo zoom · doppio clic apre"));
  new ResizeObserver(() => { if (!touched) fit(); }).observe(svg);
  if (reduced) {
    requestAnimationFrame(() => {
      shape();
      while (alpha > 0.005) tick();
      draw();
      fit();
    });
  } else {
    draw();
    run();
  }
  return {
    element,
    /** Dim what does not match a kind or a search, without moving anything. */
    filter({ kind = "", query = "" } = {}) {
      const words = plainText(query).trim();
      for (const node of nodes) {
        node.hit = (!kind || node.kind === kind) && (!words || plainText(`${node.title} ${node.summary}`).includes(words));
        node.el.classList.toggle("dim", !node.hit);
      }
      for (const edge of edges) edge.el.classList.toggle("dim", !(edge.a.hit && edge.b.hit));
      if (selected && !selected.hit) select(null);
    },
  };
}

const BRAIN_TZ = () => S.data?.timezone || "Europe/Rome";
/** The calendar day (YYYY-MM-DD) an instant falls on in the instance's time zone. */
function brainDayOf(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BRAIN_TZ(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}
function brainShiftDay(day, by) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}
/** The instant a calendar day starts in the instance's time zone, daylight saving included. */
function brainDayStart(day) {
  const [y, m, d] = day.split("-").map(Number), wall = Date.UTC(y, m - 1, d);
  const offset = (at) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: BRAIN_TZ(), hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - at;
  };
  return new Date(wall - offset(wall - offset(wall)));
}
function brainDayLabel(day, short = false) {
  const [y, m, d] = day.split("-").map(Number);
  const text = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", ...(short ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }).format(new Date(Date.UTC(y, m - 1, d)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Brain → Diario: one day of the brain, the page changes and the notes each agent left. */
function brainDiary({ day: initial = "", onDay = () => {} } = {}) {
  const element = h("div", { class: "brain-diary stack" });
  let day = initial, who = "", data = null, ticket = 0;
  const today = () => brainDayOf(Date.now());
  function go(next) { day = next >= today() ? "" : next; who = ""; onDay(day); load(); }
  function head(current) {
    const now = today();
    const picker = h("input", { type: "date", class: "brain-diary-pick", value: current, max: now, "aria-label": tr("Scegli il giorno"), onchange: (event) => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) go(event.target.value); } });
    return h("div", { class: "brain-diary-head" },
      btn("", { icon: "back", cls: "ghost", title: tr("Giorno prima"), "aria-label": tr("Giorno prima"), onclick: () => go(brainShiftDay(current, -1)) }),
      h("div", { class: "grow brain-diary-day" }, h("b", {}, raw(brainDayLabel(current))), h("small", {}, current === now ? tr("Oggi") : current === brainShiftDay(now, -1) ? tr("Ieri") : "")),
      picker,
      btn("", { icon: "next", cls: "ghost", title: tr("Giorno dopo"), "aria-label": tr("Giorno dopo"), disabled: current >= now, onclick: () => go(brainShiftDay(current, 1)) }),
      current < now ? btn("Oggi", { cls: "ghost", onclick: () => go(now) }) : null);
  }
  const whoOf = (change) => [...new Set([...(change.author && change.author !== "librarian" ? [change.author] : []), ...change.sources.map((source) => source.author).filter(Boolean)])];
  function draw(current) {
    const { changes, notes } = data;
    const people = [...new Set([...notes.map((note) => note.author || tr("Senza nome")), ...changes.flatMap(whoOf)])].sort((a, b) => a.localeCompare(b));
    const shownChanges = who ? changes.filter((change) => whoOf(change).includes(who)) : changes;
    const shownNotes = who ? notes.filter((note) => (note.author || tr("Senza nome")) === who) : notes;
    const count = (action) => changes.filter((change) => action.includes(change.action)).length;
    const summary = [[count(["create", "restore"]), "{count} aggiunte"], [count(["update"]), "{count} modificate"], [count(["archive", "revert"]), "{count} tolte"], [notes.length, "{count} note"]]
      .filter(([value]) => value).map(([value, text]) => tr(text, { count: value }));
    const jump = (at, label, name) => at ? btn(tr(label, { day: brainDayLabel(brainDayOf(at), true) }), { icon: name, cls: "sm ghost", onclick: () => go(brainDayOf(at)) }) : null;
    const jumps = h("div", { class: "row brain-diary-jumps" },
      data.before && brainDayOf(data.before) !== brainShiftDay(current, -1) ? jump(data.before, "Attività precedente: {day}", "back") : null,
      h("span", { class: "spacer" }),
      data.after && brainDayOf(data.after) !== brainShiftDay(current, 1) ? jump(data.after, "Attività seguente: {day}", "next") : null);
    if (!changes.length && !notes.length) {
      element.replaceChildren(head(current), empty("book", tr("Niente di nuovo nel brain in questo giorno.")), jumps);
      return;
    }
    const filter = people.length > 1 ? h("div", { class: "chips", role: "group", "aria-label": tr("Chi") },
      [["", tr("Tutti")], ...people.map((name) => [name, raw(name)])].map(([key, label]) => h("button", { type: "button", class: `chip${who === key ? " on" : ""}`, "aria-pressed": String(who === key), onclick: () => { who = key; draw(current); } }, label))) : null;
    const changeRow = (change) => h("a", { class: "brain-diary-row", href: brainHref(`#/brain/p/${change.slug}`) },
      h("span", { class: "brain-diary-time mono" }, raw(fmtTime(change.createdAt))),
      h("div", { class: "grow" }, h("b", {}, raw(change.title)), change.note ? h("small", {}, raw(change.note)) : null,
        whoOf(change).length ? h("small", { class: "brain-diary-who" }, tr("da {who}", { who: whoOf(change).join(" · ") })) : null),
      h("div", { class: "brain-row-meta" }, badge(BRAIN_ACTIONS[change.action] || raw(change.action), ["create", "restore"].includes(change.action) ? "on" : ["archive", "revert"].includes(change.action) ? "warn" : ""),
        ["pending", "flagged"].includes(change.review) ? badge("Da rivedere", "warn") : null));
    const groups = new Map();
    for (const note of shownNotes) { const name = note.author || tr("Senza nome"); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(note); }
    element.replaceChildren(head(current),
      h("p", { class: "brain-diary-sum mono" }, summary.join(" · ")),
      ...(filter ? [filter] : []),
      h("section", { class: "stack-sm" }, h("h3", { class: "label" }, tr("Pagine")),
        shownChanges.length ? h("div", { class: "brain-list" }, shownChanges.map(changeRow)) : h("p", { class: "muted" }, tr("Nessuna pagina cambiata."))),
      h("section", { class: "stack-sm" }, h("h3", { class: "label" }, tr("Note degli agenti")),
        groups.size ? h("div", { class: "brain-diary-agents" }, [...groups].map(([name, items]) => h("div", { class: "brain-diary-agent" },
          h("div", { class: "row" }, icon("user"), h("b", {}, raw(name)), h("span", { class: "spacer" }), h("small", { class: "faint mono" }, tr(items.length === 1 ? "1 nota" : "{count} note", { count: items.length }))),
          items.map((note) => h("div", { class: "brain-diary-note" },
            h("span", { class: "brain-diary-time mono" }, raw(fmtTime(note.createdAt))),
            h("p", { class: "grow" }, raw(note.text)),
            badge(note.usedAt ? "Nel brain" : "In attesa", note.usedAt ? "on" : "")))))) : h("p", { class: "muted" }, tr("Nessuna nota lasciata."))),
      jumps);
  }
  async function load() {
    const current = day || today(), mine = ++ticket;
    element.replaceChildren(head(current), skeleton("rows", 3));
    try {
      const result = await api(`/api/brain/diary?${new URLSearchParams({ from: brainDayStart(current).toISOString(), to: brainDayStart(brainShiftDay(current, 1)).toISOString() })}`);
      if (mine !== ticket) return;
      data = result; draw(current);
    } catch (error) { if (mine === ticket) element.replaceChildren(head(current), h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr(error.message))))); }
  }
  return { element, load, get loaded() { return Boolean(data); } };
}

const BRAIN_EVENT_ICON = { read: "book", batch: "list", ask: "chat", model: "refresh", reasoning: "bulb", page: "edit", skip: "close", error: "alert", done: "check" };

/** One line of the librarian's run: when, what kind of step, and what it did. */
function brainEventEl(event) {
  const text = event.slug && event.kind === "page" ? h("a", { href: brainHref(`#/brain/p/${encodeURIComponent(event.slug)}`) }, raw(event.text)) : h("span", {}, raw(event.text));
  return h("li", { class: `brain-event ${event.kind || ""}` },
    h("span", { class: "at" }, fmtTime(event.at)),
    h("span", { class: "ico", "aria-hidden": "true" }, icon(BRAIN_EVENT_ICON[event.kind] || "info")),
    text);
}

/** The last run in the librarian's own page: what it did, and each model call's reasoning on demand. */
function brainLastRun(lastRun) {
  if (!lastRun) return null;
  const events = Array.isArray(lastRun.log) ? lastRun.log : [];
  const calls = (lastRun.traceIds || []).map((id, index) => {
    const box = h("div", { class: "steps-log" });
    let loaded = false;
    return h("details", { class: "raw", ontoggle: async (event) => {
      if (!event.target.open || loaded) return;
      loaded = true;
      box.replaceChildren(skeleton("rows", 2));
      const trace = await guard(api(`/api/traces/${id}`));
      if (!trace) { box.replaceChildren(empty("alert", "Ragionamento non più disponibile.")); return; }
      const started = Date.parse(trace.startedAt);
      const steps = (trace.steps || []).filter((step, at, all) => !(step.type === "thinking" && step.hidden && all[at - 1]?.type === "thinking" && all[at - 1]?.hidden));
      box.replaceChildren(...(steps.length ? steps.map((step) => stepEl(step, started)) : [empty("info", "Il modello ha risposto senza passi intermedi visibili.")]),
        h("details", { class: "raw" }, h("summary", {}, icon("edit"), h("span", {}, tr("Risposta"))), h("pre", {}, raw(trace.output || trace.error || ""))));
    } }, h("summary", {}, icon("bulb"), h("span", {}, raw(tr("Ragionamento della chiamata {n}", { n: index + 1 })))), box);
  });
  return panel({ icon: "clock", title: "Ultimo giro", hint: tr("{time} · {model} · {seconds} s", { time: fmtTime(lastRun.startedAt || lastRun.at, true), model: modelLabel(lastRun.model, { short: true }), seconds: Math.round((lastRun.ms || 0) / 1000) }) },
    events.length ? h("ol", { class: "brain-live-events" }, events.map(brainEventEl)) : h("p", { class: "muted" }, tr("Il registro dei passi c'è dai giri successivi a questo aggiornamento.")),
    ...calls);
}

function renderBrain() {
  const [, view, slug] = route();
  if (view === "nuova") return renderBrainCreate(slug);
  if (view === "p" && slug) return renderBrainPage(slug);
  if (view === "revisione") return renderBrainReview();
  const body = h("div", { class: "stack" }, skeleton("rows", 4));
  let state = null;
  let kind = "";
  let map = null, mapLoading = false, listLoaded = false;
  const mapBox = h("div", {}, skeleton("rows", 3));
  const searchField = () => h("input", { type: "search", placeholder: tr("Cerca nel brain…"), "aria-label": tr("Cerca nel brain"), autocomplete: "off" });
  const search = searchField(), mapSearch = searchField();
  const listChips = h("div", { class: "chips", role: "group", "aria-label": tr("Tipo di pagina") });
  const mapChips = h("div", { class: "chips", role: "group", "aria-label": tr("Tipo di pagina") });
  const list = h("div", { class: "brain-list" });
  const diaryDay = view === "diario" && /^\d{4}-\d{2}-\d{2}$/.test(slug || "") ? slug : "";
  const diary = brainDiary({ day: diaryDay, onDay: (day) => history.replaceState(null, "", brainHref(`#/brain/diario${day ? `/${day}` : ""}`)) });
  const reviewButton = btn("Rivedi", { icon: "check", cls: "primary", href: "#/brain/revisione" });
  const addButton = btn("Aggiungi pagina", { icon: "plus", cls: "primary", href: "#/brain/nuova" });
  addButton.hidden = true;
  const live = h("div", { class: "brain-live" });
  live.hidden = true;
  let poll = null;
  let snapshot = null;
  const runButton = btn("Aggiorna adesso", { icon: "refresh", cls: "ghost", onclick: async () => {
    runButton.disabled = true;
    const started = await guard(api("/api/brain/run", { method: "POST" }));
    if (started && state) { state.running = true; state.progress = null; snapshot = null; draw(); }
    else drawLive();
  } });
  function drawLive() {
    const busy = Boolean(state?.running);
    runButton.disabled = busy;
    runButton.setAttribute("aria-busy", String(busy));
    runButton.querySelector("span").textContent = tr(busy ? "Al lavoro…" : "Aggiorna adesso");
    live.hidden = !busy;
    if (!busy) { live.replaceChildren(); return; }
    const progress = snapshot?.progress || state.progress;
    const line = progress ? [
      progress.startedAt ? tr("partito alle {time}", { time: fmtTime(progress.startedAt) }) : "",
      progress.batches ? tr("lotto {batch} di {batches}", progress) : tr("legge note e messaggi nuovi"),
      progress.model ? modelLabel(progress.model, { short: true }) : "",
    ].filter(Boolean).join(" · ") : tr("in coda: parte appena può");
    const head = h("div", { class: "brain-live-head", role: "status", "aria-live": "polite" },
      h("span", { class: "subscription-spinner", "aria-hidden": "true" }),
      h("div", { class: "grow" }, h("b", {}, tr("Il bibliotecario è al lavoro")), h("span", { class: "line" }, line)),
      h("span", { class: "brain-live-hint" }, tr("in tempo reale")));
    const keep = [...live.querySelectorAll(".brain-live-scroll")].map((box) => box.scrollHeight - box.scrollTop - box.clientHeight < 40);
    const events = h("ol", { class: "brain-live-events brain-live-scroll" }, (progress?.events || []).map(brainEventEl));
    if (!progress?.events?.length) events.append(h("li", { class: "muted" }, tr("Aspetta il primo passo…")));
    const steps = h("div", { class: "steps-log brain-live-steps brain-live-scroll" });
    const trace = snapshot?.trace;
    let lastHidden = false;
    for (const step of trace?.steps || []) {
      if (step.type === "thinking" && step.hidden && lastHidden) continue;
      lastHidden = step.type === "thinking" && Boolean(step.hidden);
      steps.append(stepEl(step, Date.parse(trace.startedAt)));
    }
    if (!steps.children.length) steps.append(empty("bulb", trace ? "Il modello sta leggendo: il suo ragionamento compare qui appena lo scrive." : "Il ragionamento compare qui quando il bibliotecario chiede al modello."));
    live.replaceChildren(head, h("div", { class: "brain-live-cols" },
      h("section", {}, h("h3", { class: "label" }, tr("Cosa fa")), events),
      h("section", {}, h("h3", { class: "label" }, tr("Ragionamento del modello")), steps)));
    [events, steps].forEach((box, index) => { if (keep[index] ?? true) box.scrollTop = box.scrollHeight; });
  }
  function watch() {
    clearTimeout(poll);
    if (!state?.running) return;
    poll = setTimeout(async () => {
      if (!body.isConnected) return;
      try {
        const next = await api("/api/brain/live");
        if (!body.isConnected) return;
        if (next.running) { state.running = true; state.progress = next.progress || null; snapshot = next; drawLive(); watch(); }
        else { snapshot = null; load(); }
      } catch { watch(); }
    }, snapshot ? 2000 : 300);
  }
  async function drawMap() {
    if (map) { map.filter({ kind, query: mapSearch.value.trim() }); return; }
    if (mapLoading) return;
    mapLoading = true;
    try {
      const graph = await api("/api/brain/graph");
      if (!graph.nodes.length) { mapBox.replaceChildren(empty("bulb", "Ancora nessuna pagina. Aggiungine una o lascia una nota al bibliotecario.")); return; }
      map = brainMap(graph);
      mapBox.replaceChildren(map.element);
      map.filter({ kind, query: mapSearch.value.trim() });
    } catch (error) { mapBox.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr(error.message))))); }
    finally { mapLoading = false; }
  }
  async function pages() {
    const query = search.value.trim();
    listLoaded = true;
    list.replaceChildren(skeleton("rows", 3));
    try {
      const data = await api(`/api/brain/pages?${new URLSearchParams(query ? { q: query } : { kind })}`);
      list.replaceChildren(...(data.pages.length ? data.pages.map((page) => h("a", { class: "brain-row", href: `#/brain/p/${page.slug}` },
        h("div", { class: "grow" }, h("b", {}, raw(page.title)), page.summary ? h("small", {}, raw(page.summary)) : null),
        h("div", { class: "brain-row-meta" }, badge(BRAIN_KINDS_LABEL[page.kind] || raw(page.kind)), page.shared ? badge("Condivisa con te", "", "share") : null, page.pending ? badge("Da rivedere", "warn") : null))) :
        [empty("bulb", query ? "Niente nel brain su questo." : "Ancora nessuna pagina. Aggiungine una o lascia una nota al bibliotecario.")]));
    } catch (error) { list.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr(error.message))))); }
  }
  let timer = null;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(pages, 300); });
  mapSearch.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(drawMap, 120); });
  const drawChips = () => {
    for (const box of [listChips, mapChips]) box.replaceChildren(...[["", "Tutte"], ...Object.entries(BRAIN_KINDS_PLURAL)].map(([key, label]) => h("button", { type: "button", class: `chip${kind === key ? " on" : ""}`, "aria-pressed": String(kind === key), onclick: () => {
      kind = key; search.value = ""; drawChips();
      addButton.href = brainHref(`#/brain/nuova${kind ? `/${kind}` : ""}`);
      addButton.querySelector("span").textContent = tr(BRAIN_ADD_LABEL[kind] || "Aggiungi pagina");
      pages(); if (map) drawMap();
    } }, label)));
  };
  // The librarian's settings, in the rows of Settings: each saved as it changes.
  const settingsPanel = () => {
    const settings = S.data.settings;
    const pickedOf = (picker) => picker.querySelector("input").value.trim() || picker.querySelector("select").value;
    const model = modelPicker("brainModel", settings.brainModel || "", { allowDefault: true });
    const account = h("div", { class: "brain-account" });
    const drawAccount = (modelId) => {
      const select = brainAccountSelect(modelId || settings.defaultModel, { subscriptionId: S.data.settings.brainSubscriptionId, credentialId: S.data.settings.brainCredentialId }, "Account del bibliotecario");
      account.replaceChildren(...(select ? [select] : []));
      select?.addEventListener("change", () => saveSettings(brainAccountChange(modelId || settings.defaultModel, select.value), modelRow));
    };
    drawAccount(settings.brainModel);
    const modelRow = setRow("Modello del bibliotecario", "Legge le chat e scrive le pagine: un modello attento sui fatti e sulle fonti.", h("div", { class: "stack-sm" }, model, account), { stack: true });
    model.addEventListener("change", () => {
      const value = pickedOf(model);
      if (value !== (S.data.settings.brainModel || "")) {
        saveSettings({ brainModel: value, brainSubscriptionId: "", brainCredentialId: "" }, modelRow);
        drawAccount(value);
      }
    });
    const backupsRow = setRow("Modelli di riserva", "Se il modello non risponde (scollegato, crediti finiti), il bibliotecario e il sonno degli agenti provano questi, in ordine.", null, { stack: true });
    const backupsBox = h("div", { class: "brain-backups" });
    backupsRow.append(h("div", { class: "set-control" }, backupsBox));
    const drawBackups = () => {
      const backups = (S.data.settings.brainBackups || []).map((entry) => ({ ...entry }));
      const save = (next) => saveSettings({ brainBackups: next }, backupsRow).then(drawBackups);
      const rows = backups.map((entry, index) => {
        const picker = modelPicker(`brainBackup${index}`, entry.model, {});
        const slot = h("div", { class: "brain-account" });
        const drawSlot = (modelId) => {
          const select = brainAccountSelect(modelId, entry, "Account della riserva");
          slot.replaceChildren(...(select ? [select] : []));
          select?.addEventListener("change", () => save(backups.map((item, at) => at === index ? { ...item, ...brainAccountChange(modelId, select.value, true) } : item)));
        };
        drawSlot(entry.model);
        picker.addEventListener("change", () => {
          const value = pickedOf(picker);
          if (value && value !== entry.model) save(backups.map((item, at) => at === index ? { model: value, subscriptionId: "", credentialId: "" } : item));
        });
        return h("div", { class: "brain-backup" },
          h("span", { class: "brain-backup-n", "aria-hidden": "true" }, String(index + 1)),
          h("div", { class: "grow stack-sm" }, picker, slot),
          btn("", { icon: "trash", cls: "ghost", title: tr("Togli questa riserva"), onclick: () => save(backups.filter((_, at) => at !== index)) }));
      });
      const add = backups.length < 3 ? btn("Aggiungi riserva", { icon: "plus", cls: backups.length ? "ghost" : "", onclick: () => {
        const fallback = (S.data.models || []).find((item) => item.id !== (S.data.settings.brainModel || S.data.settings.defaultModel))?.id || S.data.settings.defaultModel;
        if (fallback) save([...backups, { model: fallback, subscriptionId: "", credentialId: "" }]);
      } }) : null;
      backupsBox.replaceChildren(...rows, ...(rows.length ? [] : [h("p", { class: "muted" }, tr("Nessuna riserva: se il modello non risponde, il brain resta fermo."))]), ...(add ? [add] : []));
    };
    drawBackups();
    const embed = h("input", { type: "text", class: "mono", value: settings.brainEmbedModel || "", autocomplete: "off", spellcheck: "false", "aria-label": tr("Modello per la ricerca") });
    const embedRow = setRow("Modello per la ricerca", "Un modello di embedding dell'Ollama di questa macchina, es. bge-m3. Vuoto: ricerca solo per parole.", embed);
    embed.addEventListener("change", () => saveSettings({ brainEmbedModel: embed.value.trim() }, embedRow));
    const hourRow = (key, label, hint) => {
      const select = h("select", { "aria-label": tr(label) }, Array.from({ length: 24 }, (_, index) => h("option", { value: index, selected: index === settings[key] }, raw(`${String(index).padStart(2, "0")}:00`))));
      const row = setRow(label, hint, select);
      select.addEventListener("change", () => saveSettings({ [key]: Number(select.value) }, row));
      return row;
    };
    return panel({ icon: "sliders", title: "Il bibliotecario", hint: "Consolida subito le nuove memorie. Ogni notte rilegge le chat; la mattina ti dice cosa è cambiato. Le modifiche valgono subito, anche se non le rivedi." },
      setRows(modelRow, backupsRow, embedRow,
        hourRow("librarianHour", "Ora del bibliotecario", "Prima fa il backup, poi aggiorna il brain."),
        hourRow("reviewHour", "Ora della revisione", "Ti arriva il riepilogo: sul telefono e in privato.")));
  };
  function draw() {
    if (!state.enabled) {
      body.replaceChildren(panel({ icon: "bulb", title: "Il brain non è collegato" },
        h("p", { class: "notice warn" }, icon("alert"), h("span", {}, "Questa Cora non ha ancora il suo database del brain: serve un Postgres con pgvector, in hush come CORA_BRAIN_DATABASE_URL."))));
      return;
    }
    const scopeSelect = state.scopes?.length > 1 ? h("select", { "aria-label": tr("Brain aperto"), onchange: event => { location.hash = "#/brain?" + new URLSearchParams({ ownerId: event.target.value }); } },
      state.scopes.map(scope => h("option", { value: scope.id, selected: scope.id === state.ownerId }, scope.id === S.data.currentUser?.id ? tr("Il mio Brain") : raw(scope.name)))) : null;
    const { stats, lastRun } = state;
    addButton.hidden = !state.canManage;
    runButton.hidden = !state.canManage;
    addButton.href = brainHref(`#/brain/nuova${kind ? `/${kind}` : ""}`);
    addButton.querySelector("span").textContent = tr(BRAIN_ADD_LABEL[kind] || "Aggiungi pagina");
    reviewButton.querySelector("span").textContent = stats.pending + stats.flagged ? tr("Rivedi ({count})", { count: stats.pending + stats.flagged }) : tr("Rivedi");
    reviewButton.className = `btn${stats.pending + stats.flagged ? " primary" : " ghost"}`;
    drawChips();
    const failed = lastRun?.errors?.length && !state.running ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr("L'ultimo giro del bibliotecario non è riuscito: {error}", { error: lastRun.errors[0] })))) : null;
    const configure = state.canConfigure ?? state.canManage;
    const entries = [
      ["elenco", "Elenco", "list", tr("{count} pagine", { count: stats.pages }), [h("div", { class: "brain-search" }, search, listChips), list]],
      ["mappa", "Mappa", "graph", tr("Le pagine e i loro legami"), [h("div", { class: "brain-search" }, mapSearch, mapChips), mapBox]],
      ["diario", "Diario", "clock", tr("Cosa è cambiato, giorno per giorno"), [diary.element]],
      ...(configure ? [["bibliotecario", "Il bibliotecario", "sliders", state.running ? tr("al lavoro adesso") : failed ? tr("ultimo giro non riuscito") : lastRun ? tr("ultimo giro {when}", { when: fmtTime(lastRun.at, true) }) : tr("Modello, riserve e orari"), [settingsPanel(), ...(state.running ? [] : [brainLastRun(lastRun)].filter(Boolean))]]] : []),
    ];
    const current = ["elenco", "mappa", "diario", "bibliotecario"].includes(view) && entries.some(([id]) => id === view) ? view : "";
    const workspace = sectionWorkspace({ title: "Brain", base: "#/brain", current, entries, onSelect: (id) => {
      if (id === "mappa") drawMap();
      else if (id === "diario") { if (!diary.loaded) diary.load(); if (diaryDay) history.replaceState(null, "", brainHref(`#/brain/diario/${diaryDay}`)); }
      else if (id === "elenco" && !listLoaded) pages();
    } });
    body.replaceChildren(
      ...(scopeSelect ? [field("Brain aperto", scopeSelect)] : []),
      h("div", { class: "stats" },
        statCard({ icon: "book", value: String(stats.pages), label: "pagine" }),
        statCard({ icon: "check", value: String(stats.pending + stats.flagged), label: "da rivedere", href: stats.pending + stats.flagged ? "#/brain/revisione" : null }),
        statCard({ icon: "search", value: String(stats.chunks), label: "messaggi cercabili" }),
        statCard({ icon: "clock", value: lastRun ? raw(fmtTime(lastRun.at, true)) : "—", label: "ultimo giro", href: configure ? brainHref("#/brain/bibliotecario") : null,
          sub: state.running ? tr("al lavoro adesso") : lastRun ? raw(tr("{created} nuove, {updated} modificate{errors}", { created: lastRun.created, updated: lastRun.updated, errors: lastRun.errors?.length ? tr(", con errori") : "" })) : "il bibliotecario non è ancora passato" })),
      live,
      ...(failed ? [failed] : []),
      workspace);
    drawLive();
    watch();
  }
  async function load() {
    try {
      state = await api("/api/brain");
      if (!body.isConnected) return;
      listLoaded = false; map = null; mapBox.replaceChildren(skeleton("rows", 3));
      draw();
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr(error.message))))); }
  }
  shell([pageHead("Brain", "Quello che sa l'azienda: clienti, progetti, persone, decisioni e procedure, con le fonti.", [reviewButton, runButton, addButton]), body], { title: "Brain" });
  load();
}

const BRAIN_ADD_LABEL = { client: "Aggiungi cliente", project: "Aggiungi progetto", person: "Aggiungi persona", decision: "Aggiungi decisione", procedure: "Aggiungi procedura", topic: "Aggiungi tema" };

async function renderBrainCreate(kind = "topic") {
  const draftForm = app.querySelector(".brain-create-form");
  const draft = S.viewKey === route().join("/") && draftForm ? Object.fromEntries(new FormData(draftForm)) : {};
  const body = h("div", { class: "stack" }, skeleton("rows", 2));
  shell([body], { title: BRAIN_ADD_LABEL[kind] || "Aggiungi pagina", back: "#/brain" });
  const state = await guard(api("/api/brain"));
  if (!body.isConnected || !state) return;
  if (!state.enabled || !state.canManage) { body.replaceChildren(empty("bulb", "Solo l'owner aggiunge pagine al brain.", btn("Torna al brain", { href: "#/brain", icon: "back" }))); return; }
  const selected = draft.kind || (BRAIN_KINDS_LABEL[kind] ? kind : "topic");
  const submit = btn("Aggiungi pagina", { icon: "plus", type: "submit", cls: "primary" });
  const form = h("form", { class: "stack brain-create-form" },
    h("div", { class: "grid2" }, field("Titolo", h("input", { name: "title", type: "text", required: true, maxlength: 120, value: draft.title || "", autocomplete: "off" })),
      field("Tipo", h("select", { name: "kind" }, Object.entries(BRAIN_KINDS_LABEL).map(([key, label]) => h("option", { value: key, selected: selected === key }, label))))),
    field("Riassunto", h("input", { name: "summary", type: "text", maxlength: 400, value: draft.summary || "" }), "una o due frasi: è ciò che gli agenti vedono a ogni turno"),
    field("Testo", h("textarea", { name: "body", class: "tall mono", maxlength: 8000 }, raw(draft.body || "")), "righe che cominciano con - diventano elenchi; [[slug]] collega un'altra pagina"),
    h("div", { class: "row" }, btn("Annulla", { cls: "ghost", href: "#/brain" }), h("span", { class: "spacer" }), submit));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const saved = await guard(api("/api/brain/pages", { method: "POST", body: Object.fromEntries(new FormData(form)) }), "Pagina aggiunta");
    submit.disabled = false;
    if (saved) location.hash = brainHref(`#/brain/p/${saved.slug}`);
  });
  body.replaceChildren(pageHead(BRAIN_ADD_LABEL[selected], "Quello che aggiungi è subito disponibile agli agenti. Il bibliotecario consolida le memorie in attesa."), panel({ icon: "edit", title: "Nuova pagina" }, form));
}

async function renderBrainPage(slug) {
  const body = h("div", { class: "stack" }, skeleton("rows", 3));
  shell([body], { title: "Brain", back: "#/brain" });
  let page;
  let state;
  try { [page, state] = await Promise.all([api(`/api/brain/pages/${encodeURIComponent(slug)}`), api("/api/brain")]); }
  catch (error) { body.replaceChildren(empty("bulb", error.message, btn("Torna al brain", { icon: "back", href: "#/brain" }))); return; }
  if (!body.isConnected) return;
  app.querySelector(".appbar h1")?.replaceChildren(raw(page.title));
  const editing = { on: false };
  const draw = () => {
    const actions = state.canManage && !page.readonly ? [
      btn(editing.on ? "Annulla" : "Modifica", { icon: editing.on ? "close" : "edit", cls: "ghost", onclick: () => { editing.on = !editing.on; draw(); } }),
      page.status === "live" ? btn("Archivia", { icon: "trash", cls: "ghost", onclick: async () => {
        const archived = await guard(api(`/api/brain/pages/${page.slug}`, { method: "DELETE" }), "Pagina archiviata");
        if (archived) { page = archived; draw(); }
      } }) : null,
    ] : [];
    let content;
    if (editing.on) {
      const form = h("form", { class: "stack" },
        h("div", { class: "grid2" }, field("Titolo", h("input", { type: "text", name: "title", value: page.title })),
          field("Tipo", h("select", { name: "kind" }, Object.entries(BRAIN_KINDS_LABEL).map(([key, label]) => h("option", { value: key, selected: page.kind === key }, label))))),
        field("Riassunto", h("input", { type: "text", name: "summary", value: page.summary }), "una o due frasi: è ciò che gli agenti vedono a ogni turno"),
        field("Testo", h("textarea", { name: "body", class: "tall mono" }, raw(page.body)), "righe che cominciano con - diventano elenchi; [[slug]] collega un'altra pagina"),
        h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Salva", { icon: "check", type: "submit", cls: "primary" })));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const saved = await guard(api(`/api/brain/pages/${page.slug}`, { method: "PUT", body: { title: data.get("title"), kind: data.get("kind"), summary: data.get("summary"), body: data.get("body") } }), "Pagina salvata");
        if (saved) { page = saved; editing.on = false; draw(); }
      });
      content = form;
    } else content = [page.summary ? h("p", { class: "lead" }, raw(page.summary)) : null, brainText(page.body)];
    const entries = [["pagina", "Pagina", "book", "Contenuto della pagina", [panel({ cls: "brain-page" }, content)]]];
    if (page.readonly) entries[0][4].push(panel({ icon: "share", title: "Condivisa con te", hint: "Sola lettura: il proprietario gestisce contenuti e accesso." }));
    else {
      if (state.ownerMemory && state.canShare !== false) entries.push(["condivisione", "Condivisione", "share", "Persone e permessi", [brainSharingPane(page)]]);
      entries.push(["storia", "Storia", "clock", "Modifiche e fonti", [panel({ icon: "clock", title: "Storia", hint: "Ogni modifica, chi l'ha fatta e da dove viene." },
        h("ol", { class: "brain-history" }, page.revisions.map((revision) => h("li", {},
          h("div", { class: "row" }, h("b", {}, BRAIN_ACTIONS[revision.action] || raw(revision.action)), badge(BRAIN_REVIEWS[revision.review] || raw(revision.review), revision.review === "approved" ? "on" : revision.review === "reverted" ? "" : "warn"),
            h("small", { class: "grow" }, brainAuthor(revision.author), raw(` · ${fmtTime(revision.createdAt, true)}`))),
          revision.note ? h("p", {}, raw(revision.note)) : null,
          revision.conflict ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(revision.conflict))) : null,
          brainSources(revision.sources)))))]]);
    }
    body.replaceChildren(pageHead(raw(page.title), h("span", { class: "brain-head-meta" }, state.ownerId && state.ownerId !== S.data.currentUser?.id ? badge(tr("Brain di {name}", { name: state.scopes?.find(scope => scope.id === state.ownerId)?.name || state.ownerId })) : null, badge(BRAIN_KINDS_LABEL[page.kind] || raw(page.kind)), page.status === "archived" ? badge("Archiviata") : null, page.pending ? badge("Da rivedere", "warn") : null,
        h("small", {}, tr("aggiornata {when}", { when: fmtTime(page.updatedAt, true) }))), actions), sectionWorkspace({ title: "Brain", base: `#/brain/p/${page.slug}`, current: editing.on ? "pagina" : route()[3], entries }));
  };
  draw();
}

function brainSharingPane(page) {
  const sharing = page.sharing || { visibility: "private", users: [] };
  const visibility = h("select", { "aria-label": tr("Chi può leggere questa pagina") },
    [["private", "Solo io e i miei agenti"], ["team", "Tutto il team"], ["people", "Persone scelte"]].map(([value, label]) => h("option", { value, selected: sharing.visibility === value }, label)));
  const people = h("div", { class: "set-switches" });
  const feedback = h("p", { role: "status", class: "muted" });
  const chosen = new Set(sharing.users);
  const peopleRow = setRow("Persone", null, people, { stack: true });
  peopleRow.hidden = visibility.value !== "people";
  visibility.addEventListener("change", () => { peopleRow.hidden = visibility.value !== "people"; });
  api("/api/brain/sharing").then((data) => {
    people.replaceChildren(...(data.people.length ? data.people.map((person) => {
      const input = h("input", { type: "checkbox", checked: chosen.has(person.id) });
      input.addEventListener("change", () => input.checked ? chosen.add(person.id) : chosen.delete(person.id));
      return h("label", { class: "switch" }, h("span", { class: "switch-label" }, raw(person.name)), input, h("span", { class: "rocker" }));
    }) : [h("p", { class: "muted" }, "Non ci sono altre persone nello spazio.")]));
  }).catch((error) => { feedback.textContent = tr(error.message); });
  const save = btn("Salva condivisione", { icon: "check", cls: "primary", onclick: async () => {
    save.disabled = true;
    try {
      const result = await api("/api/brain/pages/" + page.slug + "/sharing", { method: "PUT", body: { visibility: visibility.value, users: [...chosen] } });
      page.sharing = result;
      feedback.textContent = tr("Condivisione aggiornata");
    } catch (error) { feedback.textContent = tr(error.message); }
    finally { save.disabled = false; }
  } });
  return panel({ icon: "share", title: "Condivisione", hint: "La pagina è privata finché scegli di condividerla. Gli altri owner e i loro agenti ricevono solo accesso in lettura." },
    setRows(setRow("Chi può leggere questa pagina", null, visibility), peopleRow), h("div", { class: "row end" }, save), feedback);
}

async function renderBrainReview() {
  const body = h("div", { class: "stack" }, skeleton("rows", 3));
  const expanded = S.brainExpanded ||= new Set();
  const expandAll = btn("Apri tutte", { icon: "list", cls: "ghost", onclick: () => {
    const cards = [...body.querySelectorAll(".brain-change")];
    const open = cards.some((card) => card.querySelector(".brain-change-toggle").getAttribute("aria-expanded") !== "true");
    for (const card of cards) toggle(card, open);
  } });
  const approveAll = btn("Approva tutto", { icon: "check", cls: "primary", onclick: () => decide({ all: true, decision: "approve" }, "Tutto approvato") });
  shell([pageHead("Revisione del brain", "Cosa ha cambiato il bibliotecario. Vale già: approva quello che va bene, annulla quello che no.", [expandAll, approveAll]), body], { title: "Revisione", back: "#/brain" });
  let state;
  function toggle(card, open) {
    card.querySelector(".brain-change-toggle").setAttribute("aria-expanded", String(open));
    card.querySelector(".brain-change-body").hidden = !open;
    if (open) expanded.add(card.id); else expanded.delete(card.id);
    const allOpen = [...body.querySelectorAll(".brain-change")].every((item) => expanded.has(item.id));
    expandAll.querySelector("span").textContent = tr(allOpen ? "Chiudi tutte" : "Apri tutte");
  }
  async function decide(choice, done) {
    for (const button of body.querySelectorAll("button")) button.disabled = true;
    approveAll.disabled = true;
    expandAll.disabled = true;
    if (await guard(api("/api/brain/review", { method: "POST", body: choice }), done)) await load();
    for (const button of body.querySelectorAll("button")) button.disabled = false;
    approveAll.disabled = false;
    expandAll.disabled = false;
  }
  async function load() {
    try {
      const [{ queue }, brain] = await Promise.all([api("/api/brain/review"), state ? Promise.resolve(state) : api("/api/brain")]);
      state = brain;
      const current = new Set(queue.map((revision) => `change-${revision.id}`));
      for (const id of expanded) if (!current.has(id)) expanded.delete(id);
      approveAll.hidden = !queue.length || !state.canManage;
      expandAll.hidden = !queue.length;
      if (!queue.length) { body.replaceChildren(empty("check", "Niente da rivedere: il brain è come l'hai lasciato.", btn("Torna al brain", { icon: "back", href: "#/brain" }))); return; }
      body.replaceChildren(...queue.map((revision) => h("article", { id: `change-${revision.id}`, class: `brain-change${revision.review === "flagged" ? " flagged" : ""}` },
        h("header", { class: "row" },
          h("button", { type: "button", class: "brain-change-toggle grow", "aria-expanded": String(expanded.has(`change-${revision.id}`)), "aria-controls": `change-body-${revision.id}`, onclick: (event) => {
            const card = event.currentTarget.closest(".brain-change");
            toggle(card, event.currentTarget.getAttribute("aria-expanded") !== "true");
          } }, icon("next", "chev"), h("b", {}, raw(revision.title))),
          h("div", { class: "brain-change-meta" }, badge(BRAIN_ACTIONS[revision.action] || raw(revision.action), revision.action === "create" ? "on" : ""), revision.review === "flagged" ? badge("Da verificare", "warn", "alert") : null),
          state.canManage ? btn("Approva", { icon: "check", cls: "primary", onclick: () => decide({ ids: [revision.id], decision: "approve" }, "Approvata") }) : null),
        h("div", { id: `change-body-${revision.id}`, class: "brain-change-body", hidden: !expanded.has(`change-${revision.id}`) },
        h("small", {}, brainAuthor(revision.author), raw(` · ${fmtTime(revision.createdAt, true)}${revision.note ? ` · ${revision.note}` : ""}`)),
        revision.conflict ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(revision.conflict))) : null,
        revision.previous && revision.previous.summary !== revision.summary ? brainDiff(revision.previous.summary, revision.summary) : null,
        revision.previous ? brainDiff(revision.previous.body, revision.body) : brainText(revision.body),
        brainSources(revision.sources),
        h("div", { class: "row brain-change-actions" }, btn("Apri la pagina", { icon: "book", cls: "ghost", href: `#/brain/p/${revision.slug}` }), h("span", { class: "spacer" }),
          state.canManage ? btn("Annulla", { icon: "close", cls: "ghost", onclick: () => decide({ ids: [revision.id], decision: "revert" }, "Modifica annullata") }) : null)))));
      expandAll.querySelector("span").textContent = tr(queue.every((revision) => expanded.has(`change-${revision.id}`)) ? "Chiudi tutte" : "Apri tutte");
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  }
  load();
}

/* ---------- artifacts ---------- */
const ARTIFACT_STATUS = {
  proposed: ["Da rivedere", "warn"], conflict: ["In conflitto", "err"], published: ["Pubblicato", "on"], rejected: ["Rifiutato", "err"], superseded: ["Sostituito", ""], ignored: ["Ignorato", ""],
};
const ARTIFACT_IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const ARTIFACT_VIDEO = /\.(mp4|webm|mov)$/i;
const ARTIFACT_AUDIO = /\.(mp3|wav|ogg|m4a)$/i;
const ARTIFACT_TEXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|xml|ya?ml|toml|ini|env\.example|py|rb|go|rs|java|kt|swift|php|sh|sql|log|svg|txt|vue|svelte)$/i;

/** Bytes as people read them, in the panel's language. */
function fmtBytes(value) {
  const n = Number(value) || 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toLocaleString(LANG === "en" ? "en-GB" : "it-IT", { maximumFractionDigits: size < 10 && unit ? 1 : 0 })} ${units[unit]}`;
}

const fileCount = (count) => (count === 1 ? tr("1 file") : tr("{count} file", { count }));

/** A file's path inside a commit, as the API takes it: every segment escaped, the slashes kept. */
const artifactPath = (path) => String(path).split("/").map(encodeURIComponent).join("/");

/** Who made a commit: an agent with its picture, a person with their mark. */
function artifactAuthor(author) {
  const agent = author?.kind === "agent" ? S.data.agents.find((item) => item.id === author.id) : null;
  return h("span", { class: "art-author" }, agent ? avatar(agent, "xs") : userMark({ name: author?.name || "?" }, "sm"), raw(author?.name || "?"));
}

/** +added ~changed −deleted, each only when there is some. */
function artifactCounts(changes) {
  const parts = [["add", "+", changes?.added], ["mod", "~", changes?.modified], ["del", "−", changes?.deleted]].filter(([, , count]) => count);
  return h("span", { class: "art-counts", title: tr("{added} aggiunti, {modified} cambiati, {deleted} eliminati", { added: changes?.added || 0, modified: changes?.modified || 0, deleted: changes?.deleted || 0 }) },
    parts.length ? parts.map(([cls, sign, count]) => h("i", { class: cls }, raw(`${sign}${count}`))) : h("i", {}, "—"));
}

/** The count beside Artefatti in the navigation, kept in step with what the page just learned. */
function setArtifactReviews(count) {
  if (!S.data?.artifacts) return;
  S.data.artifacts.reviews = count;
  const links = [...document.querySelectorAll(".side-nav"), ...document.querySelectorAll(".tabbar")].flatMap((nav) => [...nav.querySelectorAll("a")]);
  for (const link of links) {
    if ((link.getAttribute ? link.getAttribute("href") : link.attributes.href) !== "#/artefatti") continue;
    link.querySelector(".nav-count")?.remove();
    if (count) link.append(h("i", { class: "nav-count", title: tr("{count} da rivedere", { count }) }, raw(String(count))));
  }
}

function artifactLed(folder) {
  const [cls, label] = folder.conflicts ? ["err", "In conflitto"] : folder.pending ? ["busy", "Da rivedere"] : folder.head ? ["on", "In onda"] : ["", "Niente in onda"];
  return h("i", { class: `led${cls ? ` ${cls}` : ""}`, title: tr(label), "aria-label": tr(label) });
}

/** The folder's path with its last segment lit: where it sits, then what it is. */
function artifactPathLabel(path) {
  const parts = String(path).split("/");
  return h("span", { class: "art-path" }, parts.length > 1 ? h("span", { class: "art-path-dir" }, raw(`${parts.slice(0, -1).join("/")}/`)) : null, h("b", {}, raw(parts.at(-1))));
}

/** A name as a folder path takes it: lowercase words joined by dashes, accents dropped. */
const pathSlug = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * Where a new folder goes, chosen a level at a time: an existing group or a new one at
 * each level, then the folder's own name. Folders hold files and never other folders,
 * so a level offers only groups, and a name already used there is refused.
 */
function folderPathPicker(folders) {
  const paths = folders.map((folder) => folder.path);
  const groups = [];
  let leaf = "";
  let leafTouched = false;
  let open = null;
  const prefixAt = (level) => groups.slice(0, level).map((group) => `${group}/`).join("");
  const groupsAt = (prefix) => {
    const found = new Map();
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash > 0) found.set(rest.slice(0, slash), (found.get(rest.slice(0, slash)) || 0) + 1);
    }
    return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const foldersAt = (prefix) => new Set(paths.filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/")).map((path) => path.slice(prefix.length)));
  const root = h("div", { class: "path-picker" });
  const input = h("input", { type: "text", class: "mono path-leaf", placeholder: tr("nome-della-cartella"), autocomplete: "off", spellcheck: "false", "aria-label": tr("Nome della cartella") });
  input.addEventListener("input", () => { leafTouched = true; input.value = input.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); leaf = input.value; check(); });
  const status = h("p", { class: "path-status" });
  const problem = () => {
    const prefix = prefixAt(groups.length);
    if (!leaf) return tr("Dai un nome alla cartella");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(leaf)) return tr("Il nome inizia con una lettera o una cifra");
    if (foldersAt(prefix).has(leaf)) return tr("C'è già una cartella {path}", { path: `${prefix}${leaf}` });
    if (groupsAt(prefix).some(([name]) => name === leaf)) return tr("{path} è un gruppo: scegli un altro nome, o entra nel gruppo", { path: `${prefix}${leaf}` });
    if (`${prefix}${leaf}`.length > 120) return tr("Il percorso è troppo lungo");
    return "";
  };
  const check = () => {
    const wrong = problem();
    status.className = `path-status${wrong ? " wrong" : ""}`;
    status.replaceChildren(...[wrong ? icon("alert") : icon("check"), h("code", {}, raw(`${prefixAt(groups.length)}${leaf || "…"}`)), wrong ? h("span", {}, raw(wrong)) : null].filter(Boolean));
  };
  const choose = (level, name) => { groups.splice(level, groups.length - level, name); open = null; draw(); };
  const menu = (level) => {
    const prefix = prefixAt(level);
    const existing = groupsAt(prefix);
    const fresh = h("input", { type: "text", class: "mono", placeholder: tr("nuovo-gruppo"), autocomplete: "off", spellcheck: "false", "aria-label": tr("Nome del nuovo gruppo") });
    fresh.addEventListener("input", () => { fresh.value = fresh.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); });
    const add = () => {
      const name = pathSlug(fresh.value);
      if (!name) return fresh.focus?.();
      if (foldersAt(prefix).has(name)) return toast(tr("{path} è già una cartella: le cartelle non contengono cartelle", { path: `${prefix}${name}` }), true);
      choose(level, name);
    };
    fresh.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } if (event.key === "Escape") { open = null; draw(); } });
    return h("div", { class: "path-menu", role: "menu", "aria-label": tr("Gruppi in {path}", { path: prefix || "/" }) },
      existing.length ? h("div", { class: "path-options" }, existing.map(([name, count]) => h("button", { type: "button", role: "menuitem", class: `path-option${groups[level] === name ? " on" : ""}`, onclick: () => choose(level, name) },
        icon("folder"), h("span", { class: "grow" }, raw(name)), h("small", {}, raw(count === 1 ? tr("1 cartella") : tr("{count} cartelle", { count })))))) : h("p", { class: "path-empty" }, tr("Ancora nessun gruppo qui")),
      h("div", { class: "path-new" }, fresh, btn("Nuovo gruppo", { icon: "plus", cls: "sm ghost", onclick: add })),
      level < groups.length ? btn("Togli questo livello", { icon: "close", cls: "sm ghost", onclick: () => { groups.splice(level); open = null; draw(); } }) : null);
  };
  function draw() {
    const crumbs = [h("span", { class: "path-root" }, icon("archive"), h("span", {}, "Artefatti"))];
    groups.forEach((group, level) => crumbs.push(h("span", { class: "path-sep" }, "/"),
      h("button", { type: "button", class: `path-chip${open === level ? " open" : ""}`, "aria-haspopup": "menu", "aria-expanded": String(open === level), onclick: () => { open = open === level ? null : level; draw(); } }, icon("folder"), h("span", {}, raw(group)), icon("next", "path-caret"))));
    if (groups.length < 5) crumbs.push(h("span", { class: "path-sep" }, "/"),
      h("button", { type: "button", class: `path-chip add${open === groups.length ? " open" : ""}`, "aria-haspopup": "menu", "aria-expanded": String(open === groups.length), onclick: () => { open = open === groups.length ? null : groups.length; draw(); } }, icon("plus"), h("span", {}, groups.length ? tr("dentro un gruppo") : tr("in un gruppo"))));
    crumbs.push(h("span", { class: "path-sep" }, "/"), input);
    root.replaceChildren(...[h("div", { class: "path-crumbs" }, crumbs), open !== null ? menu(open) : null, status].filter(Boolean));
    check();
  }
  draw();
  return {
    node: root,
    value: () => `${prefixAt(groups.length)}${leaf}`,
    problem,
    // The folder's name follows its title until someone writes one of their own.
    fromTitle: (title) => { if (leafTouched) return; leaf = pathSlug(title); input.value = leaf; check(); },
  };
}

function renderArtifacts() {
  const [, id, view, commitId] = route();
  if (id === "segreti") return renderSecrets();
  if (id && view === "c" && commitId) return renderArtifactCommit(id, commitId);
  // A level of the paths (clienti, clienti/acme) opens like a directory: what is inside, a link for all of it.
  const level = id === "in" ? artifactDir(route().slice(2)) : "";
  if (id && id !== "in") return renderArtifactFolder(id, view || "file", view === "file" || !view ? artifactDir(route().slice(3)) : artifactDir(String(new URLSearchParams(location.hash.split("?")[1] || "").get("in") || "").split("/")));
  const body = h("div", { class: "stack" }, skeleton("rows", 4));
  let data = null;
  let creating = false;
  const search = h("input", { type: "search", placeholder: tr("Cerca tra le cartelle…"), "aria-label": tr("Cerca tra le cartelle"), autocomplete: "off" });
  const newButton = btn("Nuova cartella", { icon: "plus", cls: "primary", onclick: () => { creating = !creating; draw(); if (creating) body.querySelector(".art-new input")?.focus(); } });
  search.addEventListener("input", () => drawList());
  const list = h("div", { class: "art-groups" });

  function drawList() {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const prefix = level ? `${level}/` : "";
    const under = data.folders.filter((folder) => folder.path.startsWith(prefix));
    if (!data.folders.length) {
      list.replaceChildren(empty("archive", "Ancora nessuna cartella. Quando un agente deve conservare o mostrare qualcosa ti chiede dove metterlo, oppure creane una tu.", creating ? null : btn("Nuova cartella", { icon: "plus", onclick: () => newButton.click() })));
      return;
    }
    if (level && !under.length) { list.replaceChildren(empty("archive", "Qui non c'è nessuna cartella.", btn("Torna agli artefatti", { icon: "back", href: "#/artefatti" }))); return; }
    const levelRow = (group, full) => artifactLevelRow(group, data.levelShares?.[group.path] || 0, full);
    if (words.length) {
      // Searching looks through every level and folder below this one, never inside the files.
      const matches = (text) => words.every((word) => text.toLowerCase().includes(word));
      const levels = artifactLevels(under, level).filter((group) => matches(group.path.slice(prefix.length)));
      const folders = under.filter((folder) => matches(`${folder.path.slice(prefix.length)} ${folder.title} ${folder.description}`));
      if (!levels.length && !folders.length) { list.replaceChildren(empty("search", "Nessuna cartella con queste parole.")); return; }
      list.replaceChildren(h("section", { class: "art-group" },
        h("h3", { class: "label" }, tr("Risultati"), h("span", {}, raw(String(levels.length + folders.length)))),
        h("div", { class: "art-list" }, [...levels.map((group) => levelRow(group, true)), ...folders.map((folder) => artifactFolderRow(folder, true))])));
      return;
    }
    const { groups, own } = artifactLevel(under, level);
    list.replaceChildren(h("section", { class: "art-group" },
      h("h3", { class: "label" }, level ? raw(level.split("/").at(-1)) : tr("Cartelle"), h("span", {}, raw(String(groups.length + own.length)))),
      h("div", { class: "art-list" }, [...groups.map((group) => levelRow(group, false)), ...own.map((folder) => artifactFolderRow(folder, false))])));
  }

  function newFolderForm() {
    const kind = { value: "files" };
    const kinds = h("div", { class: "segmented", role: "radiogroup", "aria-label": tr("Cosa contiene") },
      [["files", "File", "file"], ["site", "Sito", "globe"]].map(([key, label, name]) => h("button", { type: "button", role: "radio", class: key === kind.value ? "on" : "", "aria-checked": String(key === kind.value), onclick: (event) => {
        kind.value = key;
        for (const button of kinds.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
      } }, icon(name), label)));
    const where = folderPathPicker(data.folders);
    const title = h("input", { type: "text", name: "title", placeholder: tr("Report trimestrali di Acme"), maxlength: 80, required: true });
    title.addEventListener("input", () => where.fromTitle(title.value));
    const direct = data.canManage ? switchInput("direct", "Pubblica subito", false, "Senza revisione: ogni caricamento va in onda appena arriva.") : null;
    const form = h("form", { class: "art-new stack" },
      field("Titolo", title),
      field("Dove va", where.node, "scegli un gruppo per livello, o creane uno; il nome della cartella viene dal titolo"),
      field("Cosa ci va", h("textarea", { name: "description", rows: 2, maxlength: 600, placeholder: tr("Gli agenti lo leggono per capire dove mettere le cose.") })),
      h("div", { class: "row" }, field("Contiene", kinds), direct, h("span", { class: "spacer" }),
        btn("Annulla", { cls: "ghost", onclick: () => { creating = false; draw(); } }),
        btn("Crea la cartella", { icon: "check", cls: "primary", type: "submit" })));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const wrong = where.problem();
      if (wrong) return toast(wrong, true);
      const created = await guard(api("/api/artifacts/folders", { method: "POST", body: { path: where.value(), title: values.get("title"), description: values.get("description"), kind: kind.value, policy: values.get("direct") ? "direct" : "review" } }), "Cartella creata");
      if (created) location.hash = `#/artefatti/${created.id}`;
    });
    return panel({ icon: "folder", title: "Nuova cartella", hint: "Gli agenti la trovano nel brain e con artifact_folders: scrivi bene cosa ci va." }, form);
  }

  function draw() {
    if (level) {
      body.replaceChildren(...[creating ? newFolderForm() : null, data.folders.length > 6 ? h("div", { class: "art-search" }, search) : null, list, levelAccess, levelShares].filter(Boolean));
      drawList();
      return;
    }
    const reviews = data.reviews;
    const onAir = data.folders.filter((folder) => folder.head).length;
    body.replaceChildren(...[
      artifactsSwitch(""),
      h("div", { class: "stats" },
        statCard({ icon: "archive", value: String(data.folders.length), label: "cartelle" }),
        statCard({ icon: "check", value: String(reviews.length), label: "da rivedere", href: reviews.length ? `#/artefatti/${reviews[0].folderId}/c/${reviews[0].id}` : null }),
        statCard({ icon: "radio", value: String(onAir), label: "in onda" }),
        statCard({ icon: "layers", value: raw(fmtBytes(data.quota.used)), label: "spazio", sub: raw(tr("di {limit}", { limit: fmtBytes(data.quota.limit) })), href: data.canManage ? "#/settings/spazio" : null })),
      reviews.length ? h("section", { class: "requests art-reviews", "aria-label": tr("Da rivedere") },
        h("span", { class: "label" }, tr("Aspettano te"), h("i", { class: "count" }, raw(String(reviews.length)))),
        reviews.slice(0, 8).map((commit) => {
          const folder = data.folders.find((item) => item.id === commit.folderId);
          return h("a", { class: "art-review", href: `#/artefatti/${commit.folderId}/c/${commit.id}` },
            artifactAuthor(commit.author),
            h("span", { class: "grow" }, h("b", {}, raw(commit.message)), h("small", {}, folder ? artifactPathLabel(folder.path) : null)),
            artifactCounts(commit.changes),
            commit.status === "conflict" ? badge("Conflitto", "err", "alert") : null,
            h("small", { class: "faint" }, raw(fmtTime(new Date(commit.createdAt).toISOString(), true))),
            icon("next", "chev"));
        })) : null,
      creating ? newFolderForm() : null,
      data.folders.length > 6 ? h("div", { class: "art-search" }, search) : null,
      list].filter(Boolean));
    drawList();
  }

  const levelShares = h("div", { class: "stack art-level-shares" });
  async function loadLevelShares() {
    let info;
    try { info = await api(`/api/artifacts/level?${new URLSearchParams({ path: level })}`); } catch (error) { levelShares.replaceChildren(); return; }
    accessButton.style.display = info.canManage ? "" : "none";
    levelAccess.replaceChildren(...(info.canManage && granting ? [artifactLevelAccess(info, level)] : []));
    if (!info.shareHosting) { shareButton.style.display = "none"; levelShares.replaceChildren(); return; }
    const prefix = `${level}/`;
    const shareData = {
      folder: { id: `ag:${level}`, path: level, title: level.split("/").at(-1), kind: "files", group: true },
      shares: info.shares, canReview: info.canShare, shareHosting: info.shareHosting, shareSuffix: info.shareSuffix, activity: info.activity, people: info.people,
      tree: info.folders.filter((folder) => folder.served).map((folder) => ({ path: `${folder.path.slice(prefix.length)}/*` })),
    };
    const served = info.folders.filter((folder) => folder.served).length;
    shareButton.style.display = info.canShare && info.shareHosting ? "" : "none";
    const [form, links] = artifactShares(shareData, "", {
      createUrl: `/api/artifacts/level/shares?${new URLSearchParams({ path: level })}`,
      reload: () => { sharing = false; return loadLevelShares(); },
      note: info.canShare ? tr(served === info.folders.length ? "Il link serve tutte le {count} cartelle di questo livello, e anche quelle che ci metterai dopo." : "Il link serve le {count} cartelle di questo livello che rivedi tu.", { count: served }) : "",
    });
    levelShares.replaceChildren(...[sharing ? form : null, info.shares.length || sharing ? links : null].filter(Boolean));
  }
  const levelAccess = h("div", { class: "stack art-level-access" });
  let granting = false;
  const accessButton = btn("Permessi", { icon: "shield", onclick: () => { granting = !granting; loadLevelShares(); } });
  accessButton.style.display = "none";
  let sharing = false;
  const shareButton = btn("Condividi", { icon: "link", onclick: () => { sharing = !sharing; loadLevelShares().then(() => { if (sharing) levelShares.querySelector(".share-new input")?.focus(); }); } });
  shareButton.style.display = "none";

  async function load() {
    try {
      data = await api("/api/artifacts");
      setArtifactReviews(data.reviews.length);
      if (body.isConnected) draw();
      if (level && body.isConnected) loadLevelShares();
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  }
  const parts = level ? level.split("/") : [];
  const crumbs = level ? artifactTrail(artifactLevelSteps(`${level}/`)) : null;
  shell(level
    ? [crumbs,
      pageHead(raw(parts.at(-1)), tr("Le cartelle e i livelli dentro {path}. Puoi condividerlo tutto con un solo link.", { path: `${level}/` }), [accessButton, shareButton, newButton]), body]
    : [pageHead("Artefatti", "Quello che gli agenti fanno sui loro computer, con tutte le versioni. Ogni caricamento è un commit e va in onda solo quando lo approvi.", [newButton]), body],
  { title: level ? parts.at(-1) : "Artefatti", back: level ? artifactLevelHref(parts.slice(0, -1).join("/")) : "", mode: level ? "artifacts" : "" });
  load();
}

const artifactLevelHref = (path) => (path ? `#/artefatti/in/${path.split("/").map(encodeURIComponent).join("/")}` : "#/artefatti");

/** The one way up on every artifact page: Artefatti, each level, the folder, its subfolders; every step but the last is a link. */
function artifactTrail(steps) {
  const all = [{ label: "Artefatti", href: "#/artefatti", icon: "archive" }, ...steps];
  return h("nav", { class: "art-crumbs", "aria-label": tr("Percorso") }, all.map((step, index) => {
    const body = [step.icon ? icon(step.icon) : null, h("span", {}, index ? raw(step.label) : step.label)];
    const last = index === all.length - 1;
    return [index ? h("span", { class: "sep", "aria-hidden": "true" }, "/") : null,
      last ? h("b", { "aria-current": "page" }, ...body) : h("a", { href: step.href }, ...body)];
  }).flat().filter(Boolean));
}

/** The levels a folder path sits in, as trail steps. */
const artifactLevelSteps = (path) => {
  const parts = String(path).split("/").slice(0, -1);
  return parts.map((part, index) => ({ label: part, href: artifactLevelHref(parts.slice(0, index + 1).join("/")) }));
};

/** What a level holds, one step down: the levels below it, each with all its folders, and its own folders. */
function artifactLevel(folders, level) {
  const prefix = level ? `${level}/` : "";
  const groups = new Map();
  const own = [];
  for (const folder of folders) {
    if (!folder.path.startsWith(prefix)) continue;
    const rest = folder.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) { own.push(folder); continue; }
    const name = rest.slice(0, slash);
    if (!groups.has(name)) groups.set(name, { name, path: `${prefix}${name}`, folders: [] });
    groups.get(name).folders.push(folder);
  }
  return { groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)), own: own.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Every level below this one, at any depth: what a search goes through beside the folders. */
function artifactLevels(folders, level) {
  const prefix = level ? `${level}/` : "";
  const found = new Map();
  for (const folder of folders) {
    const parts = folder.path.slice(prefix.length).split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const path = `${prefix}${parts.slice(0, depth).join("/")}`;
      if (!found.has(path)) found.set(path, { name: parts[depth - 1], path, folders: [] });
      found.get(path).folders.push(folder);
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function artifactLevelRow(group, shares = 0, full = false) {
  const { folders } = group;
  const pending = folders.reduce((sum, folder) => sum + (folder.pending || 0), 0);
  const last = Math.max(...folders.map((folder) => folder.lastActivity || 0));
  const cls = folders.some((folder) => folder.conflicts) ? " err" : pending ? " busy" : folders.some((folder) => folder.head) ? " on" : "";
  const names = [...new Set(folders.map((folder) => folder.path.slice(group.path.length + 1).split("/")[0]))];
  return h("a", { class: "art-row art-level-row", href: artifactLevelHref(group.path) },
    h("i", { class: `led${cls}`, "aria-hidden": "true" }),
    h("span", { class: "panel-ico art-level-ico" }, icon("folder")),
    h("span", { class: "grow art-row-text" }, full ? artifactPathLabel(group.path) : h("span", { class: "art-path" }, h("b", {}, raw(group.name))),
      h("small", {}, raw(`${folders.length === 1 ? tr("1 cartella") : tr("{count} cartelle", { count: folders.length })} · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`))),
    h("span", { class: "art-row-meta" },
      pending ? badge(tr("{count} da rivedere", { count: pending }), "warn") : null,
      shares ? badge(String(shares), "", "link") : null,
      last ? h("small", {}, raw(fmtTime(new Date(last).toISOString(), true))) : null),
    icon("next", "chev"));
}

function artifactFolderRow(folder, full = false) {
  const name = folder.path.split("/").at(-1);
  return h("a", { class: "art-row", href: `#/artefatti/${folder.id}` },
    artifactLed(folder),
    h("span", { class: "panel-ico" }, icon(folder.kind === "site" ? "globe" : "folder")),
    h("span", { class: "grow art-row-text" }, full ? artifactPathLabel(folder.path) : h("span", { class: "art-path" }, h("b", {}, raw(name))), h("small", {}, raw(folder.title !== name ? folder.title : folder.description || folder.title))),
    h("span", { class: "art-row-meta" },
      folder.pending ? badge(tr("{count} da rivedere", { count: folder.pending }), "warn") : null,
      folder.conflicts ? badge("Conflitto", "err", "alert") : null,
      folder.shares ? badge(String(folder.shares), "", "link") : null,
      h("small", {}, raw(folder.head ? `${fileCount(folder.files)} · ${fmtBytes(folder.bytes)}` : tr("niente in onda")), raw(` · ${fmtTime(new Date(folder.lastActivity).toISOString(), true)}`))),
    icon("next", "chev"));
}

/** What a file is, read from its name: what the preview can do with it. */
function artifactKind(path) {
  if (ARTIFACT_IMAGE.test(path)) return "image";
  if (ARTIFACT_VIDEO.test(path)) return "video";
  if (ARTIFACT_AUDIO.test(path)) return "audio";
  if (ARTIFACT_TEXT.test(path) || !/\.[a-z0-9]+$/i.test(path.split("/").at(-1))) return "text";
  return "other";
}

/**
 * One file, shown the way the panel may show it: pictures and media as they are,
 * text as text with line numbers, anything else to download. Never rendered as a page.
 */
async function artifactPreview(url, path, size, edit = null) {
  const kind = artifactKind(path);
  const download = btn("Scarica", { icon: "download", cls: "sm ghost", href: `${url}?download=1` });
  // Full screen: the browser's own when it has one, otherwise the preview covers the page until Esc.
  const full = btn("", { icon: "maximize", cls: "sm ghost", title: "Schermo intero", onclick: () => {
    const box = full.closest(".art-preview");
    if (!box) return;
    if (document.fullscreenElement) return document.exitFullscreen?.();
    if (box.classList.contains("full")) return box.classList.remove("full");
    if (box.requestFullscreen) box.requestFullscreen().catch(() => box.classList.add("full"));
    else box.classList.add("full");
  } });
  let source = null;
  // A text the panel can write back: opened in its editor, saved as a new commit like an upload.
  const change = edit && ARTIFACT_EDITABLE.test(path) && size <= 1024 * 1024 ? btn(edit.canReview ? "Modifica" : "Proponi una modifica", { icon: "edit", cls: "sm ghost", onclick: async () => {
    const box = change.closest(".art-preview");
    if (!box) return;
    if (source === null) {
      try { source = await (await fetch(url, { credentials: "same-origin" })).text(); } catch (error) { return toast(error.message, true); }
    }
    const restore = [...box.childNodes];
    const onCancel = () => box.replaceChildren(...restore);
    const onSave = async (text, message) => {
      if (text === source) { toast("Nessuna modifica da salvare"); return false; }
      try {
        const done = await saveArtifactText({ folder: edit.folder, head: edit.head, path, text, message });
        toast(done.commit.status === "published" ? tr("Salvato: {message}", { message: done.commit.message }) : "Proposta: aspetta una revisione");
        edit.onSaved(done.commit);
        return true;
      } catch (error) { toast(error.message, true); return false; }
    };
    const editor = /\.(csv|tsv)$/i.test(path) && source.length < 3 * 1024 * 1024 ? csvEditor(source, /\.tsv$/i.test(path) ? "\t" : "", { onSave, onCancel }) : textEditor(source, path, { onSave, onCancel });
    box.replaceChildren(h("header", { class: "art-preview-head" }, h("span", { class: "grow" }, h("b", {}, raw(path.split("/").at(-1))), h("small", {}, raw(tr("Modifica · {path}", { path })))), full), editor);
    box.querySelector("textarea")?.focus?.();
  } }) : null;
  // Taking a file out is a commit too: a reviewer's goes on air, anyone else's waits for a review.
  const drop = edit?.onRemove ? armedButton(edit.canReview ? "Elimina" : "Proponi di eliminare", edit.canReview ? "Elimina davvero" : "Proponi davvero", { cls: "sm ghost", onconfirm: () => edit.onRemove(path) }) : null;
  const title = h("span", { class: "grow" }, h("b", {}, raw(path.split("/").at(-1))), h("small", {}, raw(`${path} · ${fmtBytes(size)}`)));
  const head = h("header", { class: "art-preview-head" }, title, change, full, download, drop);
  if (kind === "image") return [head, h("div", { class: "art-media checker" }, h("img", { src: url, alt: raw(path) }))];
  if (kind === "video") return [head, h("div", { class: "art-media" }, h("video", { src: url, controls: true, preload: "metadata" }))];
  if (kind === "audio") return [head, h("div", { class: "art-media" }, h("audio", { src: url, controls: true, preload: "metadata" }))];
  // A PDF is rendered by the browser itself, so it is framed from an address apart from the panel.
  const commitId = /\/api\/artifacts\/commits\/(ac_[a-f0-9]{12})\/files\//.exec(url)?.[1];
  if (/\.pdf$/i.test(path) && commitId) {
    try {
      const view = await api(`/api/artifacts/commits/${commitId}/view?${new URLSearchParams({ path })}`);
      if (view.url) return [head, h("iframe", { class: "art-pdf", src: view.url, title: raw(path), referrerpolicy: "no-referrer" })];
    } catch {}
  }
  // A web page is shown as the site it belongs to, framed apart from the panel; its source is one switch away.
  if (/\.html?$/i.test(path) && commitId) {
    let view = null;
    try { view = await api(`/api/artifacts/commits/${commitId}/view?${new URLSearchParams({ path })}`); } catch {}
    if (view?.url) {
      const frame = h("iframe", { class: "art-pdf art-site", src: view.url, title: raw(path), referrerpolicy: "no-referrer", sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals" });
      const body = h("div", { class: "art-site-body" }, frame);
      let code = null;
      const show = async (which) => {
        for (const [mode, button] of buttons) {
          button.classList.toggle("on", mode === which);
          button.setAttribute("aria-selected", String(mode === which));
        }
        if (which === "page") return body.replaceChildren(frame);
        if (!code) {
          const text = await artifactText(url);
          if (text === null) return toast("Non riesco a leggere il codice di questa pagina", true);
          source = text;
          code = codeLines(text);
        }
        body.replaceChildren(...code);
      };
      const buttons = [["page", "Anteprima", "eye"], ["code", "Codice sorgente", "code"]].map(([mode, label, name]) => [mode,
        h("button", { type: "button", role: "tab", class: mode === "page" ? "on" : "", "aria-selected": String(mode === "page"), onclick: () => show(mode) }, icon(name), label)]);
      const modes = h("div", { class: "segmented art-modes", role: "tablist", "aria-label": tr("Come vedere la pagina") }, buttons.map(([, button]) => button));
      return [h("header", { class: "art-preview-head" }, title, modes, change, full, download, drop), body];
    }
  }
  if (kind === "text" && size <= 2 * 1024 * 1024) {
    const text = await artifactText(url);
    if (text !== null) {
      source = text;
      if (/\.(csv|tsv)$/i.test(path)) {
        const table = artifactTable(text, /\.tsv$/i.test(path) ? "\t" : "");
        if (table) return [head, table];
      }
      if (/\.(md|markdown)$/i.test(path)) return [head, h("div", { class: "md art-md" }, markdown(text))];
      return [head, ...codeLines(text)];
    }
  }
  return [head, h("div", { class: "art-noview" }, icon("file"), h("p", {}, "Il pannello non mostra questo tipo di file: scaricalo."), download.cloneNode(true))];
}

/** A stored file read as text, as the panel serves it (plain text only), or null. */
async function artifactText(url) {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.ok && /^text\/plain/.test(response.headers.get("content-type") || "")) return await response.text();
  } catch {}
  return null;
}

/** A text with its line numbers, the first 3000 lines of it. */
function codeLines(text) {
  const lines = text.split("\n");
  const shown = lines.slice(0, 3000);
  return [h("pre", { class: "art-code" }, h("code", {}, shown.map((line, index) => h("span", { class: "art-line" }, h("i", { "aria-hidden": "true" }, raw(String(index + 1))), raw(line || " "))))),
    lines.length > shown.length ? h("p", { class: "muted small" }, tr("Mostrate le prime {shown} righe di {total}: scarica il file per il resto.", { shown: shown.length, total: lines.length })) : null].filter(Boolean);
}

/** A CSV or TSV read whole: its separator (guessed from the first line), its records, how many. */
function parseCsv(text, separator = "") {
  const first = text.split("\n", 1)[0];
  const sep = separator || [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  // A quoted cell may hold the separator and line breaks; every record counts, blank lines do not.
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const end = () => { row.push(cell.replace(/\r$/, "")); if (row.length > 1 || row[0]) rows.push(row); row = []; cell = ""; };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === sep) { row.push(cell); cell = ""; }
    else if (char === "\n") end();
    else cell += char;
  }
  if (cell || row.length) end();
  return { sep, rows, crlf: text.includes("\r\n") };
}

/** Records back into CSV text: a cell is quoted when it holds the separator, a quote, a line break or edge spaces. */
function csvText(rows, sep, crlf = false) {
  const cell = (value) => (/["\r\n]/.test(value) || value.includes(sep) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const eol = crlf ? "\r\n" : "\n";
  return rows.map((row) => row.map((value) => cell(String(value ?? ""))).join(sep)).join(eol) + eol;
}

/** Widths to start from: as wide as what a column holds, between 80 and 360 pixels; long text wraps. */
function csvWidths(rows) {
  const columns = Math.max(...rows.map((row) => row.length));
  const sample = rows.slice(0, 200);
  return Array.from({ length: columns }, (_, index) => {
    const lengths = sample.map((row) => String(row[index] ?? "").length).sort((a, b) => a - b);
    const typical = lengths[Math.floor(lengths.length * 0.9)] || 0;
    return Math.round(Math.min(360, Math.max(80, Math.max(String(rows[0]?.[index] ?? "").length, typical) * 7.6 + 26)));
  });
}

/** A table whose columns grow or shrink by dragging the edge of their heading; a double click puts one back. */
function resizableTable(widths, head, body) {
  const cols = widths.map((width) => h("col", { vars: { "--w": `${width}px` } }));
  const table = h("table", { vars: { "--total": `${widths.reduce((sum, width) => sum + width, 0)}px` } }, h("colgroup", {}, cols), head, body);
  const total = () => table.style.setProperty("--total", `${cols.reduce((sum, col) => sum + parseFloat(col.style.getPropertyValue("--w")), 0)}px`);
  for (const [index, th] of [...(head.querySelector?.("tr")?.children || [])].entries()) {
    const grip = h("span", { class: "grip", "aria-hidden": "true" });
    grip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const start = event.clientX;
      const from = parseFloat(cols[index].style.getPropertyValue("--w"));
      grip.setPointerCapture?.(event.pointerId);
      const move = (moved) => { cols[index].style.setProperty("--w", `${Math.min(1200, Math.max(48, from + moved.clientX - start))}px`); total(); };
      const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
    grip.addEventListener("dblclick", () => { cols[index].style.setProperty("--w", `${widths[index]}px`); total(); });
    th.append(grip);
  }
  return table;
}

/** A CSV or TSV as a table: the first 500 rows under a sticky header, contained in its frame, columns to resize. */
function artifactTable(text, separator = "") {
  const { rows } = parseCsv(text, separator);
  if (rows.length < 1 || rows.every((line) => line.length < 2)) return null;
  const [header, ...body] = rows;
  const total = body.length;
  const widths = csvWidths(rows);
  const table = resizableTable(widths,
    h("thead", {}, h("tr", {}, widths.map((_, index) => h("th", {}, h("span", {}, raw(header[index] ?? "")))))),
    h("tbody", {}, body.slice(0, 500).map((line) => h("tr", {}, widths.map((_, index) => {
      const value = String(line[index] ?? "");
      return h("td", { class: /^-?[\d.,]+%?$/.test(value.trim()) ? "num" : "" }, raw(value));
    })))));
  return h("div", { class: "stack-sm art-table-box" },
    h("div", { class: "art-sheet" }, table),
    h("p", { class: "muted small" }, raw(total > 500 ? tr("Le prime 500 righe di {total}: scarica il file per il resto.", { total }) : tr(total === 1 ? "1 riga" : "{count} righe", { count: total }))));
}

/**
 * Editing a CSV as a grid: every cell a field, rows and columns to add or take away.
 * Saving writes the file back with its own separator and line ends.
 */
function csvEditor(text, separator, { onSave, onCancel }) {
  const { sep, rows, crlf } = parseCsv(text, separator);
  const data = rows.length ? rows.map((row) => [...row]) : [["", ""]];
  let width = Math.max(...data.map((row) => row.length));
  for (const row of data) while (row.length < width) row.push("");
  const box = h("div", { class: "art-sheet editing" });
  const draw = () => {
    const widths = csvWidths(data).map((value) => Math.max(value, 120));
    const field = (rowIndex, colIndex) => {
      const input = h("textarea", { rows: 1, class: "cell", spellcheck: "false", value: data[rowIndex][colIndex], "aria-label": tr("Riga {row}, colonna {col}", { row: rowIndex, col: colIndex + 1 }) });
      input.addEventListener("input", () => { data[rowIndex][colIndex] = input.value; });
      return input;
    };
    const remove = (rowIndex) => h("button", { type: "button", class: "row-x", title: tr("Togli la riga"), "aria-label": tr("Togli la riga"), onclick: () => { data.splice(rowIndex, 1); draw(); } }, icon("close"));
    box.replaceChildren(resizableTable([44, ...widths],
      h("thead", {}, h("tr", {}, h("th", { class: "row-n" }, "#"), data[0].map((_, colIndex) => h("th", {}, field(0, colIndex))))),
      h("tbody", {}, data.slice(1).map((row, offset) => h("tr", {}, h("td", { class: "row-n" }, raw(String(offset + 1)), remove(offset + 1)), row.map((_, colIndex) => h("td", {}, field(offset + 1, colIndex))))))));
  };
  draw();
  const message = h("input", { type: "text", maxlength: 300, placeholder: tr("Cosa hai cambiato (facoltativo)"), "aria-label": tr("Cosa hai cambiato") });
  const save = btn("Salva", { icon: "check", cls: "sm primary", onclick: async () => {
    save.disabled = true;
    const ok = await onSave(csvText(data, sep, crlf), message.value.trim());
    save.disabled = false;
    return ok;
  } });
  return h("div", { class: "stack-sm art-editor" },
    h("div", { class: "row art-editor-tools" },
      btn("Aggiungi riga", { icon: "plus", cls: "sm ghost", onclick: () => { data.push(Array.from({ length: width }, () => "")); draw(); box.scrollTop = box.scrollHeight; } }),
      btn("Aggiungi colonna", { icon: "plus", cls: "sm ghost", onclick: () => { width += 1; for (const row of data) row.push(""); draw(); box.scrollLeft = box.scrollWidth; } }),
      width > 1 ? btn("Togli l'ultima colonna", { icon: "minus", cls: "sm ghost", onclick: () => { width -= 1; for (const row of data) row.pop(); draw(); } }) : null),
    box,
    h("div", { class: "row art-editor-save" }, message, btn("Annulla", { cls: "sm ghost", onclick: onCancel }), save));
}

/** Editing a text, a Markdown file with its rendering beside it as it is written. */
function textEditor(text, path, { onSave, onCancel }) {
  const area = h("textarea", { class: "mono art-editor-text", spellcheck: "false", value: text, "aria-label": tr("Testo del file") });
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const rendered = isMarkdown ? h("div", { class: "md art-md art-editor-preview" }, markdown(text)) : null;
  let timer = null;
  if (rendered) area.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => rendered.replaceChildren(...markdown(area.value)), 200); });
  const message = h("input", { type: "text", maxlength: 300, placeholder: tr("Cosa hai cambiato (facoltativo)"), "aria-label": tr("Cosa hai cambiato") });
  const save = btn("Salva", { icon: "check", cls: "sm primary", onclick: async () => {
    save.disabled = true;
    await onSave(area.value.endsWith("\n") || !text.endsWith("\n") ? area.value : `${area.value}\n`, message.value.trim());
    save.disabled = false;
  } });
  return h("div", { class: "stack-sm art-editor" },
    h("div", { class: `art-editor-split${rendered ? " two" : ""}` }, area, rendered),
    h("div", { class: "row art-editor-save" }, message, btn("Annulla", { cls: "sm ghost", onclick: onCancel }), save));
}

/** A file written back from the panel: its bytes as an upload, then one commit over the version that was open. */
async function saveArtifactText({ folder, head, path, text, message }) {
  const response = await fetch(`/api/artifacts/folders/${folder.id}/blobs`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/octet-stream" }, body: text, credentials: "same-origin" });
  const sent = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sent.error || response.statusText);
  return api(`/api/artifacts/folders/${folder.id}/upload`, { method: "POST", body: { base: head.id, files: [{ path, sha: sent.sha }], message: message || tr("Modificato {name}", { name: path.split("/").at(-1) }) } });
}

const ARTIFACT_EDITABLE = /\.(md|markdown|csv|tsv|txt|json|ya?ml|toml|ini)$/i;

document.addEventListener?.("keydown", (event) => { if (event.key === "Escape") document.querySelector(".art-preview.full")?.classList.remove("full"); });

/** The folder a File tab is looking at, from the address: segments as typed, never ".." or empty. */
function artifactDir(parts) {
  const dir = [];
  for (const part of parts) {
    let name;
    try { name = decodeURIComponent(part); } catch { return ""; }
    if (!name || name === "." || name === ".." || name.includes("/")) continue;
    dir.push(name);
  }
  return dir.join("/");
}

const artifactDirHref = (folderId, dir) => `#/artefatti/${folderId}/file${dir ? `/${dir.split("/").map(encodeURIComponent).join("/")}` : ""}`;

// What never leaves a computer with a folder, as on the agents' desktops.
const UPLOAD_SKIP = /(^|\/)(\.git|node_modules|__pycache__)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$/;
const UPLOAD_MAX = 100 * 1024 * 1024;

/** Files dropped on the page, folders walked into, each with the path it had under what was dropped. */
async function droppedFiles(transfer) {
  const entries = [...(transfer.items || [])].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(transfer.files || [])].map((file) => ({ file, path: file.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, path: `${prefix}${file.name}` });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

/**
 * Sends files into a folder at a path: each file's bytes on their own, then one
 * commit that lays them there. Returns the commit, published or proposed.
 */
async function uploadArtifactFiles(folder, { dir, base, items, onProgress = () => {} }) {
  const kept = items.filter((item) => !UPLOAD_SKIP.test(item.path));
  const tooBig = kept.find((item) => item.file.size > UPLOAD_MAX);
  if (tooBig) throw new Error(tr("{name} supera i 100 MB: caricalo a parte, o fallo caricare a un agente", { name: tooBig.path }));
  if (!kept.length) throw new Error(tr("Nessun file da caricare"));
  const placed = [];
  let sent = 0;
  const total = kept.reduce((sum, item) => sum + item.file.size, 0);
  for (const item of kept) {
    onProgress({ done: placed.length, count: kept.length, sent, total, name: item.path });
    const response = await fetch(`/api/artifacts/folders/${folder.id}/blobs`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/octet-stream" }, body: item.file, credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${item.path}: ${data.error || response.statusText}`);
    placed.push({ path: item.path, sha: data.sha });
    sent += item.file.size;
  }
  onProgress({ done: placed.length, count: kept.length, sent, total, name: "" });
  return api(`/api/artifacts/folders/${folder.id}/upload`, { method: "POST", body: { dir, base, files: placed } });
}

async function renderArtifactFolder(id, tab, dir = "") {
  const view = location.hash;
  const slot = h("div", { class: "stack" }, panel({}, skeleton("rows", 4)));
  shell([slot], { title: "Artefatti", back: "#/artefatti", mode: "artifacts" });
  let data;
  try { data = await api(`/api/artifacts/folders/${id}`); }
  catch (error) { slot.replaceChildren(empty("archive", error.message, btn("Torna agli artefatti", { icon: "back", href: "#/artefatti" }))); return; }
  if (location.hash !== view) return;
  const { folder } = data;
  const head = data.commits.find((commit) => commit.id === folder.head) || null;
  const pending = data.commits.filter((commit) => commit.status === "proposed" || commit.status === "conflict");
  const TABS = [["file", "File", "file"], ["commit", "Commit", "commit"], ["condivisione", "Condivisione", "link"], ...(data.canReview ? [["registro", "Registro", "clock"]] : []), ["permessi", "Permessi", "shield"], ["impostazioni", "Impostazioni", "sliders"]];
  const content = h("div", { class: "stack" });
  // Inside a subfolder the page is that subfolder's: its name, its path, the way up one level.
  const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  const levelHref = (key) => (key === "file" ? artifactDirHref(folder.id, dir) : `#/artefatti/${folder.id}/${key}${dir ? `?in=${encodeURIComponent(dir)}` : ""}`);
  shell([
    artifactTrail([...artifactLevelSteps(folder.path),
      { label: folder.path.split("/").at(-1), href: tab === "file" ? artifactDirHref(folder.id, "") : `#/artefatti/${folder.id}/${tab}`, icon: "folder" },
      ...(dir ? dir.split("/") : []).map((part, index, all) => ({ label: part, href: tab === "file" ? artifactDirHref(folder.id, all.slice(0, index + 1).join("/")) : `#/artefatti/${folder.id}/${tab}?in=${encodeURIComponent(all.slice(0, index + 1).join("/"))}` }))]),
    pageHead(raw(dir ? dir.split("/").at(-1) : folder.title), h("span", { class: "art-head-meta" },
      badge(folder.kind === "site" ? "Sito" : "Cartella", "", folder.kind === "site" ? "globe" : "folder"),
      badge(folder.policy === "direct" ? "Pubblica subito" : "Con revisione", folder.policy === "direct" ? "warn" : "", folder.policy === "direct" ? "spark" : "check"))),
    folder.description && !dir ? h("p", { class: "lead art-lead" }, raw(folder.description)) : dir ? h("p", { class: "lead art-lead" }, raw(tr("Una sottocartella di {title}", { title: folder.title }))) : null,
    h("div", { class: `art-onair${head ? " on" : ""}` },
      h("span", { class: `art-lamp${head ? " on" : ""}` }, h("i"), h("span", {}, head ? tr("In onda") : tr("Spento"))),
      head ? h("span", { class: "grow art-onair-text" },
        h("b", {}, raw(head.message)),
        h("small", {}, h("code", {}, raw(head.short)), artifactAuthor(head.author), raw(` · ${fmtTime(new Date(head.publishedAt || head.createdAt).toISOString(), true)} · ${fileCount(head.files)} · ${fmtBytes(head.bytes)}`)))
        : h("span", { class: "grow art-onair-text" }, h("b", {}, "Niente in onda"), h("small", {}, "Il primo commit approvato va in onda qui.")),
      pending.length ? btn(tr("Rivedi ({count})", { count: pending.length }), { icon: "check", cls: "primary sm", href: `#/artefatti/${folder.id}/c/${pending[0].id}` }) : null),
    h("nav", { class: "tabs" }, TABS.map(([key, label, name]) => {
      const count = key === "commit" ? data.commits.length : key === "file" ? data.tree.length : key === "condivisione" ? data.shares.filter((share) => share.status !== "revoked").length : null;
      return h("a", { href: levelHref(key), class: key === tab ? "active" : "" }, icon(name), h("span", {}, label), count ? h("i", { class: "count" }, raw(String(count))) : null);
    })),
    content,
  ], { title: folder.title, back: dir ? artifactDirHref(folder.id, parent) : artifactLevelHref(folder.path.split("/").slice(0, -1).join("/")), mode: "artifacts" });
  document.querySelector(".tabs a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  const shown = tab === "commit" ? artifactTakes(data) : ["permessi", "impostazioni"].includes(tab) ? artifactPermissions(data, { settings: tab === "impostazioni" }) : tab === "condivisione" ? artifactShares(data, dir) : tab === "registro" && data.canReview ? artifactLog(data) : artifactFiles(data, head, dir);
  content.replaceChildren(...[shown].flat().filter(Boolean));
}

/**
 * The served version as folders to walk into, beside a preview of the file chosen,
 * and an upload that lands where the person is standing.
 */
function artifactFiles(data, head, dir = "") {
  const { folder } = data;
  const all = head ? data.tree : [];
  const inside = dir ? `${dir}/` : "";
  // A folder holds files or does not exist, as in git: one made here stays empty until something is uploaded into it.
  const fresh = Boolean(dir) && !all.some((file) => file.path.startsWith(inside));
  const here = dir ? `${dir}/` : "";
  const dirs = new Map();
  const files = [];
  for (const file of all) {
    if (!file.path.startsWith(here)) continue;
    const rest = file.path.slice(here.length);
    const slash = rest.indexOf("/");
    if (slash === -1) files.push({ ...file, name: rest });
    else {
      const name = rest.slice(0, slash);
      const entry = dirs.get(name) || { name, count: 0, size: 0 };
      entry.count += 1;
      entry.size += file.size;
      dirs.set(name, entry);
    }
  }
  const preview = h("div", { class: "art-preview" }, h("div", { class: "art-noview" }, icon("eye"), h("p", {}, "Scegli un file per vederlo.")));
  let chosen = null;
  const open = async (file, row, { scroll = true } = {}) => {
    chosen = file.path;
    for (const item of list.querySelectorAll(".art-file")) item.classList.toggle("on", item === row);
    preview.replaceChildren(skeleton("rows", 2));
    const shown = await artifactPreview(`/api/artifacts/commits/${head.id}/files/${artifactPath(file.path)}`, file.path, file.size, data.canUpload === false ? null : {
      folder, head, canReview: data.canReview,
      onSaved: (commit) => {
        if (commit.status !== "published") { location.hash = `#/artefatti/${folder.id}/c/${commit.id}`; return; }
        S.reopenFile = file.path;
        renderArtifactFolder(folder.id, "file", dir);
      },
      onRemove: (path) => removeArtifactPaths(folder, head, [path], dir),
    });
    if (chosen === file.path) preview.replaceChildren(...shown.flat().filter(Boolean));
    if (scroll && matchMedia("(max-width: 899px)").matches) preview.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const parts = dir ? dir.split("/") : [];
  const rows = [
    parts.length ? h("a", { class: "art-file art-up", href: artifactDirHref(folder.id, parts.slice(0, -1).join("/")) }, icon("back"), h("span", { class: "grow" }, ".."), h("small", {}, tr("su"))) : null,
    ...[...dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => h("a", { class: "art-file art-subdir", href: artifactDirHref(folder.id, `${here}${entry.name}`) },
      icon("folder"), h("span", { class: "grow" }, raw(`${entry.name}/`)), h("small", {}, raw(fileCount(entry.count))))),
    ...files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => {
      const row = h("button", { type: "button", class: "art-file", onclick: () => open(file, row) },
        icon(artifactKind(file.path) === "image" ? "eye" : "file"), h("span", { class: "grow" }, raw(file.name)), h("small", {}, raw(fmtBytes(file.size))));
      return row;
    }),
  ].filter(Boolean);
  const list = h("div", { class: "art-tree" }, rows.length && !fresh ? rows : [...(fresh ? rows.slice(0, 1) : []), h("p", { class: "art-tree-empty" }, fresh ? "Cartella nuova: esiste quando ci carichi i primi file." : "Ancora nessun file qui.")]);

  // The upload: buttons for files and for a whole folder, and the page itself as a drop zone.
  const where = h("code", { class: "art-drop-where" }, raw(`${folder.path}/${here}`));
  const status = h("span", { class: "art-drop-status", role: "status" });
  const pick = h("input", { type: "file", multiple: true, hidden: true });
  const pickDir = h("input", { type: "file", multiple: true, webkitdirectory: true, hidden: true });
  const verb = data.canReview ? "Carica qui" : "Proponi qui";
  const send = async (items) => {
    if (data.canUpload === false || !items.length || drop.classList.contains("busy")) return;
    drop.classList.add("busy");
    try {
      const done = await uploadArtifactFiles(folder, { dir, base: head?.id || "", items, onProgress: ({ done: count, count: all, sent, total }) => {
        status.textContent = tr("{done} di {count} file · {sent} di {total}", { done: count, count: all, sent: fmtBytes(sent), total: fmtBytes(total) });
      } });
      const commit = done.commit;
      toast(commit.status === "published" ? tr("In onda: {message}", { message: commit.message }) : commit.status === "conflict" ? "Caricati, ma in conflitto con la versione in onda: decidi tu nella revisione" : "Proposti: aspettano una revisione");
      if (commit.status === "published") renderArtifactFolder(folder.id, "file", dir);
      else location.hash = `#/artefatti/${folder.id}/c/${commit.id}`;
    } catch (error) {
      toast(error.message, true);
      status.textContent = "";
    } finally {
      drop.classList.remove("busy");
    }
  };
  pick.addEventListener("change", () => send([...pick.files].map((file) => ({ file, path: file.name }))));
  pickDir.addEventListener("change", () => send([...pickDir.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }))));
  const drop = h("div", { class: "art-drop" },
    h("span", { class: "art-drop-ico" }, icon("upload")),
    h("span", { class: "grow art-drop-text" },
      h("b", {}, tr(data.canReview ? "Trascina qui file o cartelle, oppure" : "Trascina qui file o cartelle da proporre, oppure")),
      h("small", {}, tr("finiscono in"), " ", where, " ", status)),
    btn(verb, { icon: "upload", cls: "sm primary", onclick: () => pick.click() }),
    btn("Una cartella", { icon: "folder", cls: "sm ghost", onclick: () => pickDir.click() }),
    dir && data.canReview && data.shareHosting ? btn("Condividi questa cartella", { icon: "link", cls: "sm ghost", href: `#/artefatti/${folder.id}/condivisione?in=${encodeURIComponent(dir)}` }) : null,
    dir && head && !fresh ? armedButton(data.canReview ? "Elimina questa cartella" : "Proponi di eliminarla", data.canReview ? "Elimina tutto quello che contiene" : "Proponi davvero", {
      cls: "sm ghost", onconfirm: () => removeArtifactPaths(folder, head, [dir], parts.slice(0, -1).join("/")),
    }) : null,
    btn("Nuova cartella", { icon: "plus", cls: "sm ghost", onclick: () => {
      if (drop.querySelector(".art-newdir")) return drop.querySelector(".art-newdir input").focus();
      const name = h("input", { type: "text", class: "mono", maxlength: 120, placeholder: tr("nome della cartella"), autocomplete: "off", spellcheck: "false", "aria-label": tr("Nome della nuova cartella") });
      const form = h("form", { class: "art-newdir" }, h("span", { class: "mono faint" }, raw(`${folder.path}/${here}`)), name,
        btn("Entra", { icon: "next", cls: "sm primary", type: "submit" }), btn("Annulla", { cls: "sm ghost", onclick: () => form.remove() }));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = name.value.trim().replace(/^\/+|\/+$/g, "");
        const parts = value.split("/").map((part) => part.trim());
        if (!value || parts.some((part) => !part || part === "." || part === ".." || /[\\\u0000-\u001f]/.test(part))) return toast("Un nome di cartella: lettere, cifre, spazi, trattini; niente . o ..", true);
        location.hash = artifactDirHref(folder.id, `${here}${parts.join("/")}`);
      });
      drop.append(form);
      name.focus?.();
    } }),
    pick, pickDir);
  const zone = h("div", { class: "stack-sm art-zone" }, data.canUpload === false ? h("p", { class: "notice" }, icon("info"), "Hai accesso in lettura: puoi vedere e scaricare i file.") : drop, head || dir ? h("div", { class: "art-files" }, h("div", { class: "stack-sm" }, list), head ? preview : null) : null);
  let depth = 0;
  zone.addEventListener("dragenter", (event) => { if (data.canUpload === false || ![...(event.dataTransfer?.types || [])].includes("Files")) return; event.preventDefault(); depth += 1; zone.classList.add("over"); });
  zone.addEventListener("dragover", (event) => { if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault(); });
  zone.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove("over"); });
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (data.canUpload === false) return;
    depth = 0;
    zone.classList.remove("over");
    send(await droppedFiles(event.dataTransfer));
  });

  if (!head) {
    return panel({ icon: "file", title: "File", hint: data.canUpload === false ? "Nessuna versione è ancora in onda." : data.commits.length ? "Nessuna versione è ancora in onda: approva un commit, o carica i primi file." : "Ancora nessun file: caricali da qui, o chiedi a un agente di farlo." }, zone);
  }
  const total = data.tree.reduce((sum, file) => sum + file.size, 0);
  const again = S.reopenFile ? files.find((file) => file.path === S.reopenFile) : null;
  S.reopenFile = "";
  const first = again || files.find((file) => /^index\.html?$/i.test(file.name)) || files.find((file) => /^readme/i.test(file.name)) || (dir ? null : files[0]);
  if (first) setTimeout(() => { const row = [...list.querySelectorAll("button.art-file")][files.indexOf(first)]; if (row) open(first, row, { scroll: false }); });
  return panel({ icon: "file", title: tr("File in onda"), hint: raw(tr("{count} file · {size} · commit {id}", { count: data.tree.length, size: fmtBytes(total), id: head.short })) }, zone);
}

/** Files or a subfolder taken out from the version on air; then back to where what is left is. */
async function removeArtifactPaths(folder, head, paths, after) {
  try {
    const done = await api(`/api/artifacts/folders/${folder.id}/remove`, { method: "POST", body: { base: head.id, paths } });
    const commit = done.commit;
    if (commit.status !== "published") {
      toast(commit.status === "conflict" ? "In conflitto con la versione in onda: decidi tu nella revisione" : "Proposto: aspetta una revisione");
      location.hash = `#/artefatti/${folder.id}/c/${commit.id}`;
      return;
    }
    toast(tr("Fatto: {message}", { message: commit.message }));
    if (artifactDirHref(folder.id, after) === location.hash) renderArtifactFolder(folder.id, "file", after);
    else location.hash = artifactDirHref(folder.id, after);
  } catch (error) { toast(error.message, true); }
}

/** The folder's history as takes on a tape: the one on air lit, proposals waiting, the rest as they went. */
function artifactTakes(data) {
  const { folder } = data;
  if (!data.commits.length) return panel({ icon: "commit", title: "Commit" }, empty("commit", "Ancora nessun commit."));
  return panel({ icon: "commit", title: "Commit", hint: "Ogni caricamento, dal più recente. Va in onda quello approvato." },
    h("ol", { class: "art-takes" }, data.commits.map((commit) => {
      const [label, cls] = ARTIFACT_STATUS[commit.status] || [commit.status, ""];
      const live = commit.id === folder.head;
      const waiting = commit.status === "proposed" || commit.status === "conflict";
      const restore = data.canReview && commit.status === "published" && !live
        ? armedButton("Ripristina", "Conferma: torna in onda", { icon: "refresh", cls: "sm ghost", onconfirm: async () => {
          if (await guard(api(`/api/artifacts/folders/${folder.id}/restore`, { method: "POST", body: { commit: commit.id } }), "Versione ripristinata")) renderArtifacts();
        } }) : null;
      return h("li", { class: `art-take ${commit.status}${live ? " live" : ""}` },
        h("i", { class: "art-take-mark", "aria-hidden": "true" }),
        h("a", { class: "grow art-take-text", href: `#/artefatti/${folder.id}/c/${commit.id}` },
          h("span", { class: "row tight" }, h("code", {}, raw(commit.short)), h("b", { class: "grow" }, raw(commit.message)),
            live ? h("span", { class: "art-lamp on mini" }, h("i"), h("span", {}, tr("In onda"))) : badge(label, cls)),
          h("small", {}, artifactAuthor(commit.author), raw(` · ${fmtTime(new Date(commit.createdAt).toISOString(), true)}`), artifactCounts(commit.changes),
            commit.review?.note ? h("span", { class: "art-take-note" }, raw(`«${commit.review.note}»`)) : null)),
        waiting ? btn("Rivedi", { icon: "check", cls: "sm primary", href: `#/artefatti/${folder.id}/c/${commit.id}` }) : restore);
    })));
}

const SHARE_STATE = { active: ["Attivo", "on"], proposed: ["Da attivare", "warn"], revoked: ["Revocato", "err"] };

/** Who may open a share, as chips: the addresses, the domains, the people of this space. */
function shareAccessChips(access) {
  if (access.mode === "public") return h("span", { class: "share-access" }, h("span", { class: "chip on public" }, icon("globe"), "Pubblico: chiunque abbia il link"));
  if (access.mode === "password") return h("span", { class: "share-access" }, h("span", { class: "chip on" }, icon("key"), "Con una password"));
  return h("span", { class: "share-access" },
    access.members ? h("span", { class: "chip on" }, icon("users"), "Il team di questo spazio") : null,
    access.domains.map((domain) => h("span", { class: "chip on" }, icon("globe"), raw(`@${domain}`))),
    access.emails.map((email) => h("span", { class: "chip" }, raw(email))));
}

/** Who may open a link: anyone with it, whoever knows its password, or the people it names. */
function shareAccessPicker(access = {}, { modes: offered = ["public", "people", "password"] } = {}) {
  const current = offered.includes(access.mode) ? access.mode : offered.includes("people") ? "people" : offered[0];
  // Addresses and domains are compared lowercase everywhere: they are written that way too.
  const emails = h("textarea", { name: "emails", rows: 2, placeholder: "giulia@cliente.it, mario@cliente.it", autocapitalize: "off", spellcheck: "false" }, (access.emails || []).join(", "));
  const domains = h("input", { type: "text", name: "domains", class: "mono", placeholder: "cliente.it", autocapitalize: "off", spellcheck: "false", value: (access.domains || []).join(", ") });
  for (const input of [emails, domains]) input.addEventListener("input", () => { const at = input.selectionStart; input.value = input.value.toLowerCase(); input.setSelectionRange?.(at, at); });
  const kept = current === "password";
  const password = h("input", { type: "password", name: "password", minlength: 6, autocomplete: "new-password", "aria-label": tr("Password"), placeholder: kept ? tr("lasciala vuota per tenere quella di ora") : "" });
  // The team is in unless someone took it out of this link.
  const team = switchInput("members", "Anche il team", access.mode === "people" ? Boolean(access.members) : true, "chi può già entrare in questo pannello, senza scriverli uno per uno");
  const parts = {
    public: h("p", { class: "notice warn" }, icon("globe"), h("span", {}, "Lo apre chiunque abbia il link, senza entrare da nessuna parte. Non finisce nei motori di ricerca, ma chi lo riceve può inoltrarlo.")),
    people: h("div", { class: "stack-sm" },
      field("Indirizzi", emails, "chi può aprirlo, separati da virgole o a capo: entra con Google o con un link che gli arriva per email"),
      field("Domini aziendali", domains, "chiunque abbia un indirizzo di quel dominio (mai gmail.com e simili)"),
      team),
    password: field("Password", password, kept ? "cambiandola, chi è entrato con quella di prima esce" : "almeno 6 caratteri: dilla a chi deve aprirlo in un messaggio a parte, non insieme al link"),
  };
  const mode = { value: current };
  const show = () => {
    for (const [name, part] of Object.entries(parts)) part.hidden = name !== mode.value;
    password.required = mode.value === "password" && !kept;
  };
  const modes = h("div", { class: "segmented share-modes", role: "radiogroup", "aria-label": tr("Chi può aprirlo") },
    [["public", "Pubblico", "globe"], ["people", "Persone precise", "users"], ["password", "Con password", "key"]].filter(([key]) => offered.includes(key)).map(([key, text, name]) => h("button", { type: "button", role: "radio", class: key === mode.value ? "on" : "", "aria-checked": String(key === mode.value), onclick: (event) => {
      mode.value = key;
      for (const button of modes.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
      show();
    } }, icon(name), text)));
  show();
  return {
    nodes: [field("Chi può aprirlo", modes), parts.public, parts.people, parts.password],
    value: () => mode.value === "public" ? { mode: "public" } : mode.value === "password" ? { mode: "password", password: password.value }
      : { mode: "people", emails: emails.value, domains: domains.value, members: Boolean(team.querySelector("input")?.checked) },
  };
}

/** How much a link was used: visits, views, downloads, the last one; a click opens its log. */
function shareStats(stats, shareId, folderId) {
  if (!stats || !(stats.visits + stats.views + stats.downloads)) return h("small", { class: "share-stats" }, "Ancora nessuna visita");
  return h(String(folderId).startsWith("ag:") ? "span" : "a", { class: "share-stats", ...(String(folderId).startsWith("ag:") ? {} : { href: `#/artefatti/${folderId}/registro?link=${shareId}` }) },
    icon("eye"), raw([
      tr(stats.visits === 1 ? "1 visita" : "{count} visite", { count: stats.visits }),
      tr(stats.views === 1 ? "1 file visto" : "{count} file visti", { count: stats.views }),
      tr(stats.downloads === 1 ? "1 download" : "{count} download", { count: stats.downloads }),
    ].join(" · ")),
    stats.last ? h("span", { class: "faint" }, raw(` · ${tr("ultima {when}", { when: fmtTime(new Date(stats.last).toISOString(), true) })}`)) : null);
}

const LOG_FILTERS = [["all", "Tutto"], ["visits", "Visite"], ["downloads", "Download"], ["access", "Accessi"], ["changes", "Modifiche"]];
const LOG_GROUP = { open: "visits", view: "visits", search: "visits", download: "downloads", enter: "access", refused: "access", share: "changes", commit: "changes" };

/** Who a line of the log is about: the address they proved, or a visitor told apart by network and browser. */
function logWho(who = {}) {
  if (who.email) return h("b", { class: "log-who" }, raw(who.email));
  return h("b", { class: "log-who visitor" }, raw(tr(who.via === "password" ? "Visitatore {tag} con la password" : "Visitatore {tag}", { tag: who.visitor || "?" })));
}

/** One line of the log as a sentence: who did what to which file, through which link. */
function logLine(event, shares) {
  const label = event.label || shares.find((share) => share.id === event.shareId)?.label || "";
  const file = (path) => h("code", { class: "log-path" }, raw(path || "/"));
  const link = label ? h("span", { class: "log-link" }, raw(label)) : null;
  const via = { google: "con Google", email: "con il link via email", password: "con la password" };
  const ACTIONS = { created: "ha creato il link", requested: "ha chiesto il link", activated: "ha attivato il link", revoked: "ha revocato il link", deleted: "ha eliminato il link", access: "ha cambiato chi può aprire il link", expiry: "ha cambiato la scadenza del link", pinned: "ha fissato la versione del link", changed: "ha cambiato il link" };
  switch (event.kind) {
    case "open": return [logWho(event.who), " ", tr("ha aperto"), " ", link];
    case "view": return [logWho(event.who), " ", tr("ha visto"), " ", file(event.path)];
    case "search": return [logWho(event.who), " ", tr("ha cercato"), " ", h("q", {}, raw(event.detail || ""))];
    case "download": return event.detail === "zip" ? [logWho(event.who), " ", tr("ha scaricato tutta la cartella"), " ", file(event.path)] : [logWho(event.who), " ", tr("ha scaricato"), " ", file(event.path)];
    case "enter": return [logWho(event.who), " ", tr("è entrato"), " ", tr(via[event.who?.via] || ""), label ? [" · ", link] : null];
    case "refused": return event.detail === "password" ? [logWho(event.who), " ", tr("ha sbagliato la password")] : [logWho(event.who), " ", tr("non è tra chi può entrare")];
    case "share": return [h("b", { class: "log-who" }, raw(event.by?.name || tr("Qualcuno"))), " ", tr(ACTIONS[event.action] || ACTIONS.changed), " ", link,
      event.action === "access" || event.action === "created" ? h("span", { class: "faint" }, raw(` · ${tr({ public: "pubblico", password: "con password", people: "persone precise" }[event.mode] || "")}`)) : null];
    case "commit": return [h("b", { class: "log-who" }, raw(event.by)), " ", tr(event.verb), " ", h("q", {}, raw(event.message))];
    default: return [logWho(event.who), " ", raw(event.kind)];
  }
}
const LOG_ICON = { open: "link", view: "eye", search: "search", download: "download", enter: "check", refused: "alert", share: "link", commit: "commit" };

/**
 * The folder's log: every visit, view and download through its links, who got in
 * and who was turned away, and every change to its links and its files.
 */
function artifactLog(data) {
  const { folder } = data;
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const state = { filter: "all", link: params.get("link") || "", events: [], done: false };
  const commits = data.commits.flatMap((commit) => [
    { kind: "commit", at: commit.createdAt, by: commit.author?.name || "?", verb: commit.status === "published" && commit.review?.by?.name === commit.author?.name ? "ha caricato e pubblicato" : commit.author?.kind === "agent" ? "ha proposto" : "ha caricato", message: commit.message, shareId: "" },
    ...(commit.review?.by && commit.review.by.name !== commit.author?.name ? [{ kind: "commit", at: commit.review.at, by: commit.review.by.name, verb: commit.review.decision === "reject" ? "ha rifiutato" : "ha pubblicato", message: commit.message, shareId: "" }] : []),
  ]);
  const list = h("ol", { class: "log-list" });
  const more = btn("Carica le precedenti", { cls: "ghost sm", onclick: () => load() });
  const chips = h("div", { class: "segmented log-filters", role: "radiogroup", "aria-label": tr("Mostra") }, LOG_FILTERS.map(([key, label]) => h("button", { type: "button", role: "radio", class: key === state.filter ? "on" : "", "aria-checked": String(key === state.filter), onclick: (event) => {
    state.filter = key;
    for (const button of chips.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
    draw();
  } }, label)));
  const links = h("select", { "aria-label": tr("Link"), onchange: () => { state.link = links.value; state.events = []; state.done = false; load(); } },
    h("option", { value: "" }, "Tutti i link"), data.shares.map((share) => h("option", { value: share.id, selected: share.id === state.link }, raw(share.label))));
  function draw() {
    const rows = [...state.events, ...(state.link ? [] : commits)]
      .filter((event) => state.filter === "all" || LOG_GROUP[event.kind] === state.filter)
      .sort((a, b) => b.at - a.at);
    list.replaceChildren(...(rows.length ? rows.map((event) => h("li", { class: `log-row log-${event.kind}` },
      h("span", { class: "log-ico" }, icon(LOG_ICON[event.kind] || "info")),
      h("span", { class: "grow log-text" }, h("span", {}, ...logLine(event, data.shares).flat().filter(Boolean)),
        event.who?.device || event.who?.via === "public" ? h("small", {}, raw([event.who.device, event.label && event.kind !== "open" ? event.label : ""].filter(Boolean).join(" · "))) : null),
      h("time", { class: "log-time" }, raw(fmtTime(new Date(event.at).toISOString(), true))))) : [empty("clock", "Ancora niente da registrare: qui compare chi apre, guarda e scarica i file dei link.")]));
    more.style.display = state.done ? "none" : "";
  }
  async function load() {
    const before = state.events.at(-1)?.id || 0;
    try {
      const { events } = await api(`/api/artifacts/folders/${folder.id}/events?${new URLSearchParams({ ...(state.link ? { share: state.link } : {}), ...(before ? { before } : {}) })}`);
      state.events.push(...events);
      state.done = events.length < 200;
    } catch (error) { toast(error.message, true); state.done = true; }
    draw();
  }
  load();
  return panel({ icon: "clock", title: "Registro", hint: "Chi ha aperto i link, cosa ha visto e scaricato, chi è entrato e chi no, e ogni modifica ai link e ai file. Chi entra con un indirizzo è indicato con quello; chi apre un link pubblico, con un codice che distingue il suo browser." },
    h("div", { class: "log-tools" }, chips, data.shares.length > 1 || state.link ? links : null), list, h("div", { class: "row" }, h("span", { class: "spacer" }), more));
}

/** The folder's links, each a host of its own, and the form for a new one. */
/**
 * A subfolder of a folder, chosen a level at a time among those that exist: what a link serves.
 * Empty is the whole folder.
 */
function folderLevelPicker(paths, start = "", { whole = "Tutta la cartella", one = "1 file", many = "{count} file" } = {}) {
  const levels = start ? start.split("/") : [];
  let open = null;
  const root = h("div", { class: "path-picker" });
  const dirsAt = (prefix) => {
    const found = new Map();
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash > 0) found.set(rest.slice(0, slash), (found.get(rest.slice(0, slash)) || 0) + 1);
    }
    return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const prefixAt = (level) => levels.slice(0, level).map((part) => `${part}/`).join("");
  function draw() {
    const crumbs = [h("button", { type: "button", class: `path-chip${levels.length ? "" : " open"}`, onclick: () => { levels.splice(0); open = null; draw(); } }, icon("archive"), h("span", {}, tr(whole)))];
    levels.forEach((part, level) => crumbs.push(h("span", { class: "path-sep" }, "/"),
      h("button", { type: "button", class: `path-chip${open === level ? " open" : ""}`, "aria-haspopup": "menu", onclick: () => { open = open === level ? null : level; draw(); } }, icon("folder"), h("span", {}, raw(part)), icon("next", "path-caret"))));
    if (dirsAt(prefixAt(levels.length)).length) crumbs.push(h("span", { class: "path-sep" }, "/"),
      h("button", { type: "button", class: `path-chip add${open === levels.length ? " open" : ""}`, "aria-haspopup": "menu", onclick: () => { open = open === levels.length ? null : levels.length; draw(); } }, icon("plus"), h("span", {}, tr("una sottocartella"))));
    const menu = open === null ? null : h("div", { class: "path-menu", role: "menu" },
      h("div", { class: "path-options" }, dirsAt(prefixAt(open)).map(([name, count]) => h("button", { type: "button", role: "menuitem", class: `path-option${levels[open] === name ? " on" : ""}`, onclick: () => { levels.splice(open, levels.length - open, name); open = null; draw(); } },
        icon("folder"), h("span", { class: "grow" }, raw(name)), h("small", {}, raw(count === 1 ? tr(one) : tr(many, { count })))))));
    const chosen = levels.join("/");
    const inside = paths.filter((path) => !chosen || path.startsWith(`${chosen}/`)).length;
    root.replaceChildren(...[h("div", { class: "path-crumbs" }, crumbs), menu,
      h("p", { class: "path-status" }, icon("check"), h("code", {}, raw(chosen ? `${chosen}/` : "/")), h("span", {}, raw(inside === 1 ? tr(one) : tr(many, { count: inside }))))].filter(Boolean));
  }
  draw();
  return { node: root, value: () => levels.join("/") };
}

function artifactShares(data, dir = "", opts = {}) {
  const { folder } = data;
  if (!data.shareHosting) {
    return panel({ icon: "link", title: "Condivisione" },
      h("p", { class: "notice" }, icon("info"), h("span", {}, "I link di condivisione hanno un indirizzo loro su usecora.space: ci sono quando questo spazio passa da lì.")));
  }
  const reload = opts.reload || (() => renderArtifactFolder(folder.id, "condivisione"));
  const rows = data.shares.map((share) => {
    const [label, cls] = share.expired && share.status === "active" ? ["Scaduto", "err"] : SHARE_STATE[share.status] || [share.status, ""];
    const live = share.status === "active" && !share.expired;
    const copy = btn("", { icon: "copy", cls: "sm ghost", title: "Copia il link", onclick: () => navigator.clipboard?.writeText(share.url).then(() => toast("Link copiato"), () => toast("Non riesco a copiare: selezionalo a mano", true)) });
    const actions = !data.canReview ? null : share.status === "proposed"
      ? [btn("Attiva il link", { icon: "check", cls: "sm primary", onclick: async () => { if (await guard(api(`/api/artifacts/shares/${share.id}`, { method: "PUT", body: { status: "active" } }), "Link attivato")) reload(); } }),
        armedButton("Elimina", "Conferma", { cls: "sm", onconfirm: async () => { if (await guard(api(`/api/artifacts/shares/${share.id}`, { method: "DELETE" }), "Link eliminato")) reload(); } })]
      : share.status === "active"
        ? armedButton("Revoca", "Conferma: chiudi il link", { cls: "sm", onconfirm: async () => { if (await guard(api(`/api/artifacts/shares/${share.id}`, { method: "PUT", body: { status: "revoked" } }), "Link revocato")) reload(); } })
        : armedButton("Elimina", "Conferma", { cls: "sm", onconfirm: async () => { if (await guard(api(`/api/artifacts/shares/${share.id}`, { method: "DELETE" }), "Link eliminato")) reload(); } });
    const edit = data.canReview && share.status !== "revoked" ? btn("Modifica", { icon: "edit", cls: "sm ghost", title: "Chi può aprirlo", onclick: () => {
      const open = item.querySelector(".share-edit");
      if (open) return open.remove();
      const access = shareAccessPicker(share.access);
      const editor = h("form", { class: "share-edit stack" }, ...access.nodes,
        h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Annulla", { cls: "sm ghost", onclick: () => editor.remove() }), btn("Salva", { icon: "check", cls: "sm primary", type: "submit" })));
      editor.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (await guard(api(`/api/artifacts/shares/${share.id}`, { method: "PUT", body: { access: access.value() } }), "Link aggiornato")) reload();
      });
      item.append(editor);
    } }) : null;
    const item = h("li", { class: `share-row ${share.status}` },
      h("i", { class: `led${live ? " on" : share.status === "proposed" ? " busy" : ""}`, "aria-hidden": "true" }),
      h("div", { class: "grow share-text" },
        h("div", { class: "row tight" }, live ? h("a", { class: "share-url", href: share.url, target: "_blank", rel: "noopener" }, raw(share.url.replace(/^https:\/\//, "").replace(/\/$/, ""))) : h("span", { class: "share-url" }, raw(share.url.replace(/^https:\/\//, "").replace(/\/$/, ""))), badge(label, cls), badge(share.view === "files" ? "File" : "Sito", "", share.view === "files" ? "folder" : "globe"), share.root ? badge(raw(`${share.root}/`), "", "folder") : null),
        shareAccessChips(share.access),
        shareStats(data.activity?.[share.id], share.id, folder.id),
        h("small", {}, raw([
          share.createdBy?.name ? tr(share.status === "proposed" ? "chiesto da {name}" : "creato da {name}", { name: share.createdBy.name }) : "",
          share.reason ? `«${share.reason}»` : "",
          share.expiresAt ? tr("scade {when}", { when: fmtTime(new Date(share.expiresAt).toISOString(), true) }) : tr("non scade"),
          share.commit ? tr("fissato alla versione {id}", { id: share.commit.slice(3, 10) }) : tr("segue la versione in onda"),
        ].filter(Boolean).join(" · ")))),
      h("div", { class: "row-actions" }, live ? copy : null, edit, actions));
    return item;
  });
  let form = null;
  if (data.canReview) {
    const suffix = data.shareSuffix || "";
    const what = folderLevelPicker(data.tree.map((file) => file.path), dir, folder.group ? { whole: "Tutto il livello", one: "1 cartella", many: "{count} cartelle" } : {});
    const label = h("input", { type: "text", name: "label", class: "mono", required: true, minlength: 3, maxlength: 40, placeholder: "report-acme", autocomplete: "off", spellcheck: "false", "aria-label": tr("Nome del link") });
    label.addEventListener("input", () => { label.value = label.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-"); });
    const view = { value: folder.kind };
    const views = h("div", { class: "segmented", role: "radiogroup", "aria-label": tr("Come si vede") },
      [["site", "Sito", "globe"], ["files", "Elenco di file", "folder"]].map(([key, text, name]) => h("button", { type: "button", role: "radio", class: key === view.value ? "on" : "", "aria-checked": String(key === view.value), onclick: (event) => {
        view.value = key;
        for (const button of views.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
      } }, icon(name), text)));
    const expiry = h("select", { name: "expiry", "aria-label": tr("Scadenza") }, [["0", "Non scade"], ["7", "Tra 7 giorni"], ["30", "Tra 30 giorni"], ["90", "Tra 90 giorni"]].map(([value, text]) => h("option", { value }, text)));
    const access = shareAccessPicker();
    form = h("form", { class: "share-new stack" },
      h("div", { class: "grid2" },
        field("Nome del link", h("div", { class: "share-host" }, label, suffix ? h("span", { class: "mono" }, raw(suffix)) : null), "lettere minuscole, cifre e trattini"),
        field("Come si vede", views)),
      field("Cosa condividi", what.node, folder.group ? "il link serve tutte le cartelle di questo livello, o solo quelle di un livello più in basso" : "il link serve solo quello che c'è dentro: tutta la cartella o una sua sottocartella"),
      opts.note ? h("p", { class: "notice" }, icon("info"), h("span", {}, raw(opts.note))) : null,
      ...access.nodes,
      h("div", { class: "row" }, field("Scadenza", expiry), h("span", { class: "spacer" }), btn("Crea il link", { icon: "link", cls: "primary", type: "submit" })));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const days = Number(values.get("expiry"));
      const created = await guard(api(opts.createUrl || `/api/artifacts/folders/${folder.id}/shares`, { method: "POST", body: {
        label: values.get("label"), view: view.value, root: what.value(), expiresAt: days ? Date.now() + days * 86400000 : 0,
        access: access.value(),
      } }), "Link creato");
      if (created) reload();
    });
  }
  return [
    form ? panel({ icon: "plus", title: "Nuovo link", hint: "Ogni link ha un indirizzo suo: pubblico, con una password, o solo per persone precise, che entrano con Google o con un link via email." }, form) : null,
    panel({ icon: "link", title: "Link di condivisione" },
      rows.length ? h("ul", { class: "share-list" }, rows) : empty("link", folder.group ? "Ancora nessun link per questo livello." : "Ancora nessun link per questa cartella.")),
  ];
}

/** Team access to a whole level: it reaches every folder of yours under it, the ones there now and the ones to come. */
function artifactLevelAccess(info, level) {
  let access = info.access || { default: "none", users: {} };
  const levels = [["none", "Nessun accesso in più"], ["read", "Lettura"], ["write", "Caricamento e modifica"]];
  const save = async (changes, row) => {
    for (const control of node.querySelectorAll("select")) control.disabled = true;
    try {
      access = await api(`/api/artifacts/level/access?${new URLSearchParams({ path: level })}`, { method: "PUT", body: changes });
    } catch (error) { toast(error.message, true); }
    for (const control of node.querySelectorAll("select")) control.disabled = false;
    draw();
    const mark = node.querySelector(`[data-row="${row}"] .set-saved`);
    if (mark) { mark.textContent = tr("salvato"); mark.classList.add("on"); setTimeout(() => { mark.classList.remove("on"); mark.textContent = ""; }, 1800); }
  };
  const node = h("div", {});
  const people = (info.people || []).filter((person) => person.id !== S.data.currentUser?.id);
  function draw() {
    const defaultAccess = h("select", { "aria-label": tr("Accesso del team a tutto il livello") }, levels.map(([value, label]) => h("option", { value, selected: value === access.default }, label)));
    defaultAccess.addEventListener("change", () => save({ ...access, default: defaultAccess.value }, "default"));
    const defaultRow = setRow("Tutto il team", "Vale anche per chi entrerà nello spazio più avanti.", defaultAccess, { cls: "artifact-default-row" });
    defaultRow.dataset.row = "default";
    const list = people.length ? h("div", { class: "artifact-team-list" }, people.map((person) => {
      const selected = Object.hasOwn(access.users || {}, person.id) ? access.users[person.id] : "inherit";
      const control = h("select", { "aria-label": tr("Accesso di {name}", { name: person.name }) },
        h("option", { value: "inherit", selected: selected === "inherit" }, "Come tutto il team"),
        levels.map(([value, label]) => h("option", { value, selected: value === selected }, label)));
      control.addEventListener("change", () => {
        const users = { ...(access.users || {}) };
        if (control.value === "inherit") delete users[person.id]; else users[person.id] = control.value;
        save({ ...access, users }, "people");
      });
      return h("div", { class: "artifact-team-person" }, userMark(person), h("div", { class: "artifact-team-identity" }, h("b", {}, raw(person.name)), h("small", { class: "muted" }, raw(person.email || ""))), control);
    })) : h("p", { class: "muted small" }, "Nessun altro membro del team è ancora entrato.");
    const peopleRow = setRow("Membri del team", "Chi può vedere, scaricare o modificare i file di questo livello. Si somma all'accesso che ognuno ha già nelle singole cartelle.", list, { stack: true });
    peopleRow.dataset.row = "people";
    node.replaceChildren(panel({ icon: "shield", title: "Permessi del livello", hint: tr(info.managed === info.folders.length ? "Valgono per tutte le {count} cartelle sotto {path}/ e per quelle che ci metterai dopo." : "Valgono per le {count} cartelle tue sotto {path}/ e per quelle che ci metterai dopo.", { count: info.managed, path: level }) }, setRows(defaultRow, peopleRow)));
  }
  draw();
  return node;
}

/** Who pushes, who reviews, whether it waits: rows that save as they change. */
function artifactPermissions(data, { settings = false } = {}) {
  const { folder } = data;
  const save = async (changes, row) => {
    try {
      Object.assign(folder, await api(`/api/artifacts/folders/${folder.id}`, { method: "PUT", body: changes }));
    } catch (error) { toast(error.message, true); return false; }
    const mark = row?.querySelector(".set-saved");
    if (mark) {
      mark.textContent = tr("salvato");
      mark.classList.add("on");
      clearTimeout(mark.timer);
      mark.timer = setTimeout(() => { mark.classList.remove("on"); mark.textContent = ""; }, 1800);
    }
    return true;
  };
  const editable = data.canReview;
  const title = h("input", { type: "text", value: folder.title, maxlength: 80, disabled: !editable, "aria-label": tr("Titolo") });
  const titleRow = setRow("Titolo", "Come la vedete nel pannello.", title);
  title.addEventListener("change", () => save({ title: title.value }, titleRow));
  const description = h("textarea", { rows: 3, maxlength: 600, disabled: !editable, "aria-label": tr("Cosa ci va") }, raw(folder.description || ""));
  const descriptionRow = setRow("Cosa ci va", "Gli agenti lo leggono per decidere dove mettere le cose: finisce anche nel brain.", description, { stack: true });
  description.addEventListener("change", () => save({ description: description.value }, descriptionRow));
  const direct = h("label", { class: "switch" }, h("input", { type: "checkbox", checked: folder.policy === "direct", disabled: !data.canManage }), h("span", { class: "rocker" }));
  const directRow = setRow("Pubblica subito", data.canManage ? "Spento: ogni caricamento aspetta che tu o un revisore lo approviate. Acceso: va in onda appena arriva." : "Lo decide il proprietario.", direct);
  direct.querySelector("input").addEventListener("change", (event) => save({ policy: event.target.checked ? "direct" : "review" }, directRow));
  const everyone = folder.writers.includes("*");
  const writers = h("div", { class: "set-switches" },
    h("label", { class: "switch" }, h("input", { type: "checkbox", value: "*", checked: everyone, disabled: !editable }), h("span", { class: "rocker" }), h("span", { class: "switch-text" }, "Tutti gli agenti", h("small", {}, "anche quelli che arriveranno"))),
    S.data.agents.map((agent) => h("label", { class: "switch" }, h("input", { type: "checkbox", value: agent.id, checked: everyone || folder.writers.includes(agent.id), disabled: !editable || everyone }), h("span", { class: "rocker" }),
      h("span", { class: "switch-text" }, raw(agent.name), agent.tools ? null : h("small", {}, "senza computer: non può caricare")))));
  const writersRow = setRow("Chi può caricare", "Gli agenti che possono fare un commit qui.", writers, { stack: true });
  writers.addEventListener("change", async (event) => {
    const all = writers.querySelector('input[value="*"]');
    const chosen = all.checked ? ["*"] : [...writers.querySelectorAll('input:not([value="*"])')].filter((input) => input.checked).map((input) => input.value);
    if (event.target === all) for (const input of writers.querySelectorAll('input:not([value="*"])')) { input.disabled = all.checked; input.checked = all.checked || folder.writers.includes(input.value); }
    await save({ writers: chosen }, writersRow);
  });
  const people = (data.people || []).filter((person) => person.id !== folder.ownerId && person.id !== S.data.currentUser?.id);
  const memberAccess = h("div", { class: "artifact-team-access stack-sm" });
  const accessLevels = [["none", "Nessun accesso"], ["read", "Lettura"], ["write", "Caricamento e modifica"]];
  const drawMemberAccess = () => {
    const policy = folder.memberAccess || { default: "write", users: {} };
    const choose = async (changes) => {
      for (const control of memberAccess.querySelectorAll("select")) control.disabled = true;
      await save({ memberAccess: changes }, memberAccessRow);
      drawMemberAccess();
    };
    memberAccess.replaceChildren(
      people.length ? h("div", { class: "artifact-team-list" }, people.map((person) => {
        const reviewer = folder.reviewers.includes(person.id);
        const selected = reviewer ? "write" : Object.hasOwn(policy.users, person.id) ? policy.users[person.id] : "inherit";
        const control = h("select", { disabled: reviewer, "aria-label": tr("Accesso di {name}", { name: person.name }) },
          h("option", { value: "inherit", selected: selected === "inherit" }, "Eredita accesso predefinito"),
          accessLevels.map(([value, label]) => h("option", { value, selected: value === selected }, label)));
        control.addEventListener("change", () => {
          const users = { ...policy.users };
          if (control.value === "inherit") delete users[person.id]; else users[person.id] = control.value;
          choose({ ...policy, users });
        });
        return h("div", { class: "artifact-team-person" }, userMark(person), h("div", { class: "artifact-team-identity" }, h("b", {}, raw(person.name)), h("small", { class: "muted" }, raw(person.email || "")), reviewer ? h("small", { class: "artifact-team-reviewer" }, "Revisore: può anche approvare i commit.") : null,
          data.inherited?.[person.id] && !reviewer ? h("small", { class: "artifact-team-inherited" }, tr("Dal livello {level}: {access}", { level: `${data.inherited[person.id].level}/`, access: tr(data.inherited[person.id].permission === "write" ? "caricamento e modifica" : "lettura") })) : null), control);
      })) : h("p", { class: "muted small" }, "Nessun altro membro del team è ancora entrato."));
  };
  const memberAccessRow = data.canManage && folder.memberAccess ? setRow("Membri del team", "Scegli chi può vedere, scaricare o modificare i file. Tu e i revisori avete sempre accesso completo.", memberAccess, { stack: true }) : null;
  if (memberAccessRow) drawMemberAccess();
  const defaultAccess = h("select", { disabled: !data.canManage, "aria-label": tr("Accesso predefinito del team") }, accessLevels.map(([value, label]) => h("option", { value, selected: value === folder.memberAccess?.default }, label)));
  const defaultRow = data.canManage && folder.memberAccess ? setRow("Accesso predefinito", "Vale anche per i nuovi membri del team. Le eccezioni si gestiscono in Permessi.", defaultAccess, { cls: "artifact-default-row" }) : null;
  defaultAccess.addEventListener("change", async () => {
    defaultAccess.disabled = true;
    await save({ memberAccess: { ...folder.memberAccess, default: defaultAccess.value } }, defaultRow);
    defaultAccess.value = folder.memberAccess.default;
    defaultAccess.disabled = !data.canManage;
  });
  const reviewers = !data.canManage ? null : people.length ? h("div", { class: "set-switches" }, people.map((person) => h("label", { class: "switch" },
    h("input", { type: "checkbox", value: person.id, checked: folder.reviewers.includes(person.id) }), h("span", { class: "rocker" }),
    h("span", { class: "switch-text" }, raw(person.name), h("small", { class: "mono" }, raw(person.email || "")))))) : h("p", { class: "muted small" }, "Nessun altro entra in questo spazio: per ora rivedi solo tu.");
  const reviewersRow = data.canManage ? setRow("Revisori", "Oltre a te, chi può approvare o rifiutare i commit di questa cartella.", reviewers, { stack: true }) : null;
  if (people.length) reviewers?.addEventListener("change", async () => {
    if (await save({ reviewers: [...reviewers.querySelectorAll("input")].filter((input) => input.checked).map((input) => input.value) }, reviewersRow)) drawMemberAccess();
  });
  const removeRow = data.canManage ? setRow("Elimina la cartella", "Con tutte le versioni e i link. I file restano solo nei backup della notte.", armedButton("Elimina", "Conferma: elimina tutto", { onconfirm: async () => {
    if (await guard(api(`/api/artifacts/folders/${folder.id}`, { method: "DELETE" }), "Cartella eliminata")) location.hash = "#/artefatti";
  } })) : null;
  return settings
    ? panel({ icon: "sliders", title: "Impostazioni" }, setRows(titleRow, descriptionRow, defaultRow, directRow, removeRow))
    : panel({ icon: "shield", title: "Permessi", hint: editable ? null : "Li cambiano il proprietario e i revisori della cartella." }, setRows(writersRow, memberAccessRow, reviewersRow));
}

/** One changed file, opened: the lines it lost and gained, or the two pictures side by side. */
async function artifactChange(commit, change) {
  const after = change.after ? `/api/artifacts/commits/${commit.id}/files/${artifactPath(change.path)}` : null;
  const before = change.before ? `/api/artifacts/commits/${commit.id}/objects/${change.before.sha}?name=${encodeURIComponent(change.path.split("/").at(-1))}` : null;
  const kind = artifactKind(change.path);
  if (kind === "image") {
    return h("div", { class: "art-compare" },
      before ? h("figure", {}, h("figcaption", { class: "label" }, "Prima"), h("div", { class: "art-media checker" }, h("img", { src: before, alt: "" }))) : null,
      after ? h("figure", {}, h("figcaption", { class: "label" }, change.before ? "Dopo" : "Nuovo"), h("div", { class: "art-media checker" }, h("img", { src: after, alt: "" }))) : null);
  }
  const small = (file) => !file || file.size <= 400 * 1024;
  if (kind === "text" && small(change.before) && small(change.after)) {
    const read = async (url) => {
      if (!url) return "";
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok || !/^text\/plain/.test(response.headers.get("content-type") || "")) throw new Error("binary");
      return response.text();
    };
    try {
      const [a, b] = await Promise.all([read(before), read(after)]);
      if (a.split("\n").length + b.split("\n").length <= 4000) return brainDiff(a, b);
    } catch {}
  }
  return h("div", { class: "art-noview row" }, icon("file"),
    h("p", { class: "grow" }, raw([change.before ? tr("prima {size}", { size: fmtBytes(change.before.size) }) : "", change.after ? tr("dopo {size}", { size: fmtBytes(change.after.size) }) : ""].filter(Boolean).join(" · "))),
    before ? btn("Prima", { icon: "download", cls: "sm ghost", href: `${before}&download=1` }) : null,
    after ? btn(change.before ? "Dopo" : "Scarica", { icon: "download", cls: "sm ghost", href: `${after}?download=1` }) : null);
}

/** A commit page's head: its message stays on top on a phone too, where page titles give way to the app bar. */
function artifactCommitHead(head) {
  head.classList.add("art-commit-head");
  return head;
}

async function renderArtifactCommit(folderId, commitId) {
  const view = location.hash;
  const slot = h("div", { class: "stack" }, panel({}, skeleton("rows", 4)));
  shell([slot], { title: "Commit", back: `#/artefatti/${folderId}/commit` });
  let commit;
  try { commit = await api(`/api/artifacts/commits/${commitId}`); }
  catch (error) { slot.replaceChildren(empty("commit", error.message, btn("Torna alla cartella", { icon: "back", href: `#/artefatti/${folderId}` }))); return; }
  if (location.hash !== view) return;
  const [label, cls] = ARTIFACT_STATUS[commit.status] || [commit.status, ""];
  const waiting = commit.status === "proposed" || commit.status === "conflict";
  const merge = commit.mergeability;
  const note = h("textarea", { rows: 2, maxlength: 500, placeholder: tr("Una nota per chi l'ha fatto (facoltativa): la legge nella chat da cui l'ha caricato.") , "aria-label": tr("Nota") });
  const decide = async (decision, done) => {
    for (const button of slot.querySelectorAll(".art-decide button")) button.disabled = true;
    const result = await guard(api(`/api/artifacts/commits/${commit.id}/review`, { method: "POST", body: { decision, note: note.value } }));
    if (result?.conflict) toast("Non è andato in onda: gli stessi file sono cambiati nel frattempo", true);
    else if (result) toast(done);
    const left = await api("/api/artifacts").catch(() => null);
    if (left) setArtifactReviews(left.reviews.length);
    renderArtifactCommit(folderId, commitId);
  };
  const decideBar = waiting && commit.canReview ? panel({ icon: "check", title: "La tua decisione", hint: commit.status === "conflict" ? "Rifiutalo, forzalo (per i file in conflitto vince questo commit) o ignoralo se non serve più." : "Approvato, va in onda subito. Rifiutato, resta nella storia con la tua nota. Ignorato, esce dalle revisioni senza dire niente a nessuno." },
    h("div", { class: "art-decide stack" }, note,
      h("div", { class: "row" }, h("span", { class: "spacer" }),
        btn("Ignora", { icon: "eye", cls: "ghost", title: "Esce dalle revisioni e resta nella storia, senza avvisi", onclick: () => decide("ignore", "Commit ignorato") }),
        btn("Rifiuta", { icon: "close", cls: "ghost", onclick: () => decide("reject", "Commit rifiutato") }),
        commit.status === "conflict" ? armedButton("Forza", "Conferma: vince questo", { icon: "alert", onconfirm: () => decide("force", "In onda") }) : null,
        commit.status === "proposed" ? btn("Approva e metti in onda", { icon: "radio", cls: "primary", onclick: () => decide("approve", "In onda") }) : null))) : null;
  const mergeNotice = !merge ? null : merge.state === "fast-forward"
    ? h("p", { class: "notice" }, icon("check"), h("span", {}, "Fatto sulla versione in onda: se lo approvi va in onda così com'è."))
    : merge.state === "rebase"
      ? h("p", { class: "notice" }, icon("layers"), h("span", {}, "Nel frattempo è andata in onda un'altra versione, ma ha toccato file diversi: le modifiche di questo commit si aggiungono sopra."))
      : h("div", { class: "notice warn" }, icon("alert"), h("span", {}, "Gli stessi file sono cambiati anche nella versione in onda:", h("span", { class: "art-conflicts" }, merge.conflicts.map((path) => h("code", {}, raw(path))))));
  const changes = commit.changed.map((change) => {
    const details = h("details", { class: `art-change ${change.kind}` },
      h("summary", {}, h("i", { class: "art-change-kind", "aria-hidden": "true" }, change.kind === "added" ? "A" : change.kind === "deleted" ? "D" : "M"),
        h("code", { class: "grow" }, raw(change.path)),
        h("small", {}, raw(change.kind === "added" ? tr("nuovo · {size}", { size: fmtBytes(change.after.size) }) : change.kind === "deleted" ? tr("eliminato") : `${fmtBytes(change.before.size)} → ${fmtBytes(change.after.size)}`))),
      h("div", { class: "art-change-body" }, skeleton("rows", 1)));
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      details.lastChild.replaceChildren(await artifactChange(commit, change));
    });
    return details;
  });
  const deleted = commit.changed.filter((change) => change.kind === "deleted").length;
  slot.replaceChildren(...[
    commit.folder ? artifactTrail([...artifactLevelSteps(commit.folder.path), { label: commit.folder.path.split("/").at(-1), href: `#/artefatti/${commit.folder.id}/commit`, icon: "folder" }, { label: commit.short }]) : null,
    artifactCommitHead(pageHead(raw(commit.message), h("span", { class: "art-head-meta" }, h("code", {}, raw(commit.short)), badge(label, cls)),
      commit.previewUrl ? [btn("Apri anteprima", { icon: "external", cls: "ghost", href: commit.previewUrl, target: "_blank" })] : null)),
    h("div", { class: "art-byline" }, artifactAuthor(commit.author),
      commit.requestedBy?.name ? h("small", {}, tr("chiesto da {name}", { name: commit.requestedBy.name })) : null,
      h("small", {}, raw(fmtTime(new Date(commit.createdAt).toISOString(), true))), artifactCounts(commit.changes),
      commit.supersedes ? h("small", {}, tr("sostituisce una proposta precedente")) : null),
    commit.review ? h("p", { class: `notice${commit.status === "rejected" ? " warn" : ""}` }, icon(commit.status === "rejected" ? "close" : commit.status === "ignored" ? "eye" : "check"),
      h("span", {}, tr(commit.review.decision === "reject" ? "Rifiutato da {name}" : commit.review.decision === "force" ? "Forzato in onda da {name}" : commit.review.decision === "ignore" ? "Ignorato da {name}" : "Approvato da {name}", { name: commit.review.by?.name || "?" }),
        raw(` · ${fmtTime(new Date(commit.review.at).toISOString(), true)}`), commit.review.note ? h("q", { class: "art-review-note" }, raw(commit.review.note)) : null)) : null,
    mergeNotice,
    decideBar,
    panel({ icon: "layers", title: tr("Cosa cambia"), hint: commit.comparedWith ? tr("Rispetto alla versione {id}.", { id: commit.comparedWith.replace(/^ac_/, "").slice(0, 7) }) : tr("È il primo commit della cartella."),
      actions: deleted ? badge(tr("{count} eliminati", { count: deleted }), "err", "trash") : null },
      changes.length ? h("div", { class: "art-changes" }, changes) : empty("check", "Nessun file cambiato.")),
    panel({ icon: "file", title: tr("Tutti i file ({count})", { count: commit.tree.length }) },
      h("details", { class: "art-alltree" }, h("summary", {}, tr("Mostra l'elenco")), h("ul", {}, commit.tree.map((file) => h("li", {}, h("code", {}, raw(file.path)), h("small", {}, raw(fmtBytes(file.size))))))))].filter(Boolean));
}

/* ---------- vault ---------- */
/** Cartelle · Segreti: the two halves of Artefatti. */
function artifactsSwitch(on) {
  return h("div", { class: "segmented art-switch", role: "tablist", "aria-label": tr("Artefatti") },
    [["", "Cartelle", "archive"], ["segreti", "Segreti", "key"]].map(([key, label, name]) => h("button", { type: "button", role: "tab", class: key === on ? "on" : "", "aria-selected": String(key === on),
      onclick: () => { location.hash = key ? `#/artefatti/${key}` : "#/artefatti"; } }, icon(name), label)));
}

/** A link shown once, to copy and pass on: the vault keeps only its hash. */
function vaultLink(url, note) {
  const copy = btn("Copia", { icon: "copy", cls: "sm primary", onclick: () => navigator.clipboard?.writeText(url).then(() => toast("Link copiato"), () => toast("Non riesco a copiare: selezionalo a mano", true)) });
  return h("div", { class: "vault-link", role: "status" }, h("code", {}, raw(url)), copy, h("small", {}, note));
}

/** Who may use a secret, as rockers: all agents, or the ones chosen. */
function vaultAgents(chosen = []) {
  const all = chosen.includes("*");
  const list = h("div", { class: "set-switches" },
    h("label", { class: "switch" }, h("input", { type: "checkbox", value: "*", checked: all }), h("span", { class: "rocker" }), h("span", { class: "switch-text" }, "Tutti gli agenti")),
    S.data.agents.map((agent) => h("label", { class: "switch" }, h("input", { type: "checkbox", value: agent.id, checked: all || chosen.includes(agent.id), disabled: all }), h("span", { class: "rocker" }),
      h("span", { class: "switch-text" }, raw(agent.name), agent.tools ? null : h("small", {}, "senza computer: non ha un hush")))));
  list.addEventListener("change", (event) => {
    if (event.target.value !== "*") return;
    for (const input of list.querySelectorAll("input")) if (input.value !== "*") { input.disabled = event.target.checked; if (event.target.checked) input.checked = true; }
  });
  list.value = () => {
    const inputs = [...list.querySelectorAll("input")];
    return inputs.find((input) => input.value === "*")?.checked ? ["*"] : inputs.filter((input) => input.value !== "*" && input.checked).map((input) => input.value);
  };
  return list;
}

const secretName = () => {
  const input = h("input", { type: "text", name: "name", class: "mono", required: true, maxlength: 64, placeholder: "ACME_STRIPE_KEY", autocomplete: "off", spellcheck: "false", "aria-label": tr("Nome") });
  input.addEventListener("input", () => { input.value = input.value.toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, ""); });
  return input;
};

const VAULT_LOG_FILTERS = [["all", "Tutto"], ["opens", "Aperture"], ["requests", "Richieste"], ["agents", "Agenti"], ["changes", "Modifiche"]];
const VAULT_LOG_GROUP = {
  "send-page": "opens", "send-opened": "opens", "send-enter": "opens", "send-refused": "opens",
  "request-page": "requests", "request-filled": "requests", "request-created": "requests", "request-cancelled": "requests",
  "secret-imported": "agents", "send-proposed": "agents",
};
const VAULT_LOG_ICON = { "send-page": "link", "send-opened": "eye", "send-enter": "check", "send-refused": "alert", "request-page": "link", "request-filled": "key", "secret-imported": "terminal", "send-proposed": "send" };

/** One line of the vault's log as a sentence: who did what with which secret. */
function vaultLine(event) {
  const name = h("code", { class: "log-path" }, raw(event.name || ""));
  const by = h("b", { class: "log-who" }, raw(event.by?.name || tr("Qualcuno")));
  const who = logWho(event.who || {});
  const mode = event.mode ? h("span", { class: "faint" }, raw(` · ${tr({ public: "pubblico", password: "con password", people: "persone precise" }[event.mode] || "")}`)) : null;
  const via = { google: "con Google", email: "con il link via email", password: "con la password" };
  switch (event.kind) {
    case "secret-created": return [by, " ", tr("ha messo"), " ", name, " ", tr("nella cassaforte")];
    case "secret-replaced": return [by, " ", tr("ha sostituito il valore di"), " ", name];
    case "secret-agents": return [by, " ", tr("ha cambiato chi può usare"), " ", name];
    case "secret-changed": return [by, " ", tr("ha modificato"), " ", name];
    case "secret-deleted": return [by, " ", tr("ha eliminato"), " ", name];
    case "secret-imported": return [by, " ", tr("ha messo"), " ", name, " ", tr("nel suo hush")];
    case "request-created": return [by, " ", tr("ha chiesto"), " ", name, " ", tr("con un link")];
    case "request-page": return [who, " ", tr("ha aperto la richiesta di"), " ", name];
    case "request-filled": return [who, " ", tr("ha consegnato"), " ", name];
    case "request-cancelled": return [by, " ", tr("ha annullato la richiesta di"), " ", name];
    case "send-proposed": return [by, " ", tr("chiede di mandare"), " ", name];
    case "send-approved": return [by, " ", tr("ha approvato l'invio di"), " ", name, mode];
    case "send-created": return [by, " ", tr("ha creato un link per"), " ", name, mode];
    case "send-rejected": return [by, " ", tr("ha rifiutato l'invio di"), " ", name];
    case "send-revoked": return [by, " ", tr("ha revocato il link di"), " ", name];
    case "send-page": return [who, " ", tr("ha aperto il link di"), " ", name];
    case "send-enter": return [who, " ", tr("è entrato"), " ", tr(via[event.who?.via] || ""), " ", tr("per"), " ", name];
    case "send-refused": return event.detail === "password" ? [who, " ", tr("ha sbagliato la password di"), " ", name] : [who, " ", tr("non può aprire"), " ", name];
    case "send-opened": return [who, " ", tr("ha visto"), " ", name, h("span", { class: "faint" }, raw(` · ${tr("{count} di {views}", { count: event.opened, views: event.views })}`))];
    default: return [raw(event.kind), " ", name];
  }
}

/** The vault's log for its owner: every opening of what was sent, every request, every use, every change. */
function vaultLog(data) {
  const state = { filter: "all", name: "", events: [], done: false };
  const list = h("ol", { class: "log-list" });
  const more = btn("Carica le precedenti", { cls: "ghost sm", onclick: () => load() });
  const chips = h("div", { class: "segmented log-filters", role: "radiogroup", "aria-label": tr("Mostra") }, VAULT_LOG_FILTERS.map(([key, label]) => h("button", { type: "button", role: "radio", class: key === state.filter ? "on" : "", "aria-checked": String(key === state.filter), onclick: (event) => {
    state.filter = key;
    for (const button of chips.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
    draw();
  } }, label)));
  const names = h("select", { "aria-label": tr("Segreto"), onchange: () => { state.name = names.value; state.events = []; state.done = false; load(); } },
    h("option", { value: "" }, "Tutti i segreti"), data.secrets.map((secret) => h("option", { value: secret.name }, raw(secret.name))));
  function draw() {
    const rows = state.events.filter((event) => state.filter === "all" || (VAULT_LOG_GROUP[event.kind] || "changes") === state.filter);
    list.replaceChildren(...(rows.length ? rows.map((event) => h("li", { class: `log-row log-${event.kind === "send-opened" ? "view" : event.kind === "send-refused" ? "refused" : event.kind === "secret-imported" ? "download" : "other"}` },
      h("span", { class: "log-ico" }, icon(VAULT_LOG_ICON[event.kind] || "key")),
      h("span", { class: "grow log-text" }, h("span", {}, ...vaultLine(event).flat().filter(Boolean)), event.who?.device ? h("small", {}, raw([event.who.device, event.note].filter(Boolean).join(" · "))) : event.note ? h("small", {}, raw(`«${event.note}»`)) : null),
      h("time", { class: "log-time" }, raw(fmtTime(new Date(event.at).toISOString(), true))))) : [empty("clock", "Ancora niente: qui compare chi apre un link, chi consegna un segreto, quale agente lo usa e ogni modifica.")]));
    more.style.display = state.done ? "none" : "";
  }
  async function load() {
    const before = state.events.at(-1)?.id || 0;
    try {
      const { events } = await api(`/api/secrets/events?${new URLSearchParams({ ...(state.name ? { name: state.name } : {}), ...(before ? { before } : {}) })}`);
      state.events.push(...events);
      state.done = events.length < 200;
    } catch (error) { toast(error.message, true); state.done = true; }
    draw();
  }
  load();
  return panel({ icon: "clock", title: "Registro della cassaforte", hint: "Chi ha aperto i link di invio e quando, chi ha consegnato un segreto, quale agente l'ha usato, e ogni modifica. I valori non compaiono mai." },
    h("div", { class: "log-tools" }, chips, data.secrets.length > 1 ? names : null), list, h("div", { class: "row" }, h("span", { class: "spacer" }), more));
}

function renderSecrets() {
  const body = h("div", { class: "stack" }, skeleton("rows", 3));
  let data = null;
  let form = "";
  let shown = null;
  const reload = async () => {
    try {
      data = await api("/api/secrets");
      if (body.isConnected) draw();
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  };
  const toggle = (name) => () => { form = form === name ? "" : name; shown = null; draw(); window.scrollTo?.({ top: 0, behavior: "smooth" }); };
  const newButton = btn("Nuovo segreto", { icon: "plus", cls: "primary", onclick: toggle("new") });

  /**
   * A link that sends a secret, made with the same form as a folder's link: who may open it,
   * how many times, until when, for whom. It also lets an agent's request go, with what it asked.
   */
  function sendForm(name, proposal = null) {
    const access = shareAccessPicker(proposal?.access?.mode && proposal.access.mode !== "public" ? proposal.access : data.peopleSends ? { mode: "people", members: false } : { mode: "public" },
      { modes: data.peopleSends ? ["public", "people", "password"] : ["public", "password"] });
    const times = proposal?.views || 1;
    const views = h("select", { name: "views", "aria-label": tr("Quante volte si apre") }, [1, 2, 3, 5, 10].map((n) => h("option", { value: n, selected: n === times }, n === 1 ? tr("Una volta") : tr("{count} volte", { count: n }))));
    const lasts = proposal?.days || 7;
    const days = h("select", { name: "days", "aria-label": tr("Scadenza") }, [[1, "Un giorno"], [7, "Una settimana"], [30, "Un mese"]].map(([n, label]) => h("option", { value: n, selected: n === lasts }, label)));
    const note = h("input", { type: "text", name: "note", maxlength: 300, value: proposal?.note || "", placeholder: tr("Giulia, per il deploy di venerdì"), "aria-label": tr("Per chi è") });
    const el = h("form", { class: "share-new stack" },
      ...access.nodes,
      h("div", { class: "grid2" }, field("Quante volte si apre", views, "poi il link sparisce"), field("Scadenza", days)),
      field("Per chi è", note, "resta nel registro: il link non lo mostra"),
      h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Annulla", { cls: "ghost", onclick: () => { form = ""; draw(); } }),
        btn(proposal ? "Approva e crea il link" : "Crea il link", { icon: "link", cls: "primary", type: "submit" })));
    el.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = { access: access.value(), views: Number(views.value), days: Number(days.value), note: note.value };
      const made = await guard(proposal ? api(`/api/secrets/sends/${proposal.id}/approve`, { method: "POST", body }) : api(`/api/secrets/${name}/sends`, { method: "POST", body }));
      if (!made) return;
      form = "";
      shown = { title: tr("Il link per {name}", { name: made.name }), link: vaultLink(made.url, proposal ? tr("Mandalo tu a chi deve riceverlo: l'agente non lo vede.") : tr("Chi lo apre vede il segreto; poi il link sparisce. La chiave è nel link: la cassaforte non la conosce.")) };
      reload();
    });
    return panel({ icon: "send", title: proposal ? tr("Approva l'invio di {name}", { name }) : tr("Nuovo link per {name}", { name }),
      hint: proposal ? tr("Lo chiede {who}: scegli tu chi può aprirlo.", { who: proposal.by?.name || tr("un agente") }) : "Un link da mandare a chi deve riceverlo: lo apre il numero di volte che scegli, poi sparisce." }, el);
  }
  const askButton = btn("Chiedi un segreto", { icon: "link", cls: "ghost", onclick: toggle("ask") });

  function newForm() {
    const value = h("input", { type: "password", name: "value", required: true, autocomplete: "new-password", spellcheck: "false", "aria-label": tr("Valore") });
    const multi = h("textarea", { name: "multi", rows: 4, class: "mono vault-multi", hidden: true, spellcheck: "false", "aria-label": tr("Valore") });
    const lines = h("button", { type: "button", class: "btn sm ghost", onclick: () => { const wide = multi.hidden; multi.hidden = !wide; value.hidden = wide; value.required = !wide; multi.required = wide; lines.lastChild.textContent = tr(wide ? "Una riga" : "Più righe"); } }, icon("list"), h("span", {}, "Più righe"));
    const agents = vaultAgents(["*"]);
    const el = h("form", { class: "stack" },
      h("div", { class: "grid2" }, field("Nome", secretName(), "maiuscole, cifre e trattini bassi: è il nome in hush"), field("Cosa è", h("input", { type: "text", name: "description", maxlength: 300, placeholder: tr("Chiave API di Stripe per Acme") }))),
      field("Valore", h("div", { class: "vault-value" }, value, multi, lines), "lo vedi solo mentre lo scrivi: poi nessuno lo rilegge dal pannello"),
      setRows(setRow("Chi può usarlo", "Gli agenti che possono metterlo nel loro hush.", agents, { stack: true })),
      h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Annulla", { cls: "ghost", onclick: toggle("new") }), btn("Metti nella cassaforte", { icon: "check", cls: "primary", type: "submit" })));
    el.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(el);
      const saved = await guard(api("/api/secrets", { method: "POST", body: { name: values.get("name"), description: values.get("description"), value: multi.hidden ? values.get("value") : values.get("multi"), agents: agents.value() } }), "Segreto nella cassaforte");
      if (saved) { form = ""; reload(); }
    });
    return panel({ icon: "key", title: "Nuovo segreto" }, el);
  }

  function askForm() {
    const agents = vaultAgents([]);
    const hours = h("select", { name: "hours", "aria-label": tr("Scadenza") }, [["24", "Un giorno"], ["72", "Tre giorni"], ["168", "Una settimana"]].map(([key, label]) => h("option", { value: key, selected: key === "72" }, label)));
    const el = h("form", { class: "stack" },
      h("div", { class: "grid2" }, field("Nome", secretName()), field("Cosa è", h("input", { type: "text", name: "description", maxlength: 300, placeholder: tr("La password del pannello di Acme") }), "chi lo inserisce lo legge sulla pagina")),
      setRows(setRow("Chi potrà usarlo", "Gli agenti che potranno metterlo nel loro hush quando arriva.", agents, { stack: true }), setRow("Il link scade", "", hours)),
      h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Annulla", { cls: "ghost", onclick: toggle("ask") }), btn("Crea il link", { icon: "link", cls: "primary", type: "submit" })));
    el.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(el);
      const made = await guard(api("/api/secrets/requests", { method: "POST", body: { name: values.get("name"), description: values.get("description"), agents: agents.value(), hours: Number(values.get("hours")) } }), "Link creato");
      if (made) { form = ""; shown = { title: tr("Mandalo a chi ha {name}", { name: made.name }), link: vaultLink(made.url, tr("Lo scrive lì una volta, e arriva cifrato nella cassaforte. Il link lo vedi solo adesso.")) }; reload(); }
    });
    return panel({ icon: "link", title: "Chiedi un segreto", hint: "Un link da mandare a chi ha la chiave o la password: la scrive su una pagina sua, mai in chat." }, el);
  }

  function secretRow(secret) {
    const allowed = secret.agents.includes("*") ? [tr("Tutti gli agenti")] : secret.agents.map((id) => S.data.agents.find((agent) => agent.id === id)?.name).filter(Boolean);
    const extra = h("div", { class: "vault-extra" });
    const open = (what) => {
      if (extra.dataset.open === what) { extra.dataset.open = ""; extra.replaceChildren(); return; }
      extra.dataset.open = what;
      if (what === "replace") {
        const value = h("input", { type: "password", autocomplete: "new-password", spellcheck: "false", placeholder: tr("Il nuovo valore"), "aria-label": tr("Il nuovo valore") });
        extra.replaceChildren(h("div", { class: "vault-inline" }, value, btn("Sostituisci", { icon: "check", cls: "sm primary", onclick: async () => {
          if (await guard(api(`/api/secrets/${secret.name}`, { method: "PUT", body: { value: value.value } }), "Valore sostituito")) reload();
        } })));
      } else if (what === "agents") {
        const agents = vaultAgents(secret.agents);
        extra.replaceChildren(agents, h("div", { class: "row" }, h("span", { class: "spacer" }), btn("Salva", { icon: "check", cls: "sm primary", onclick: async () => {
          if (await guard(api(`/api/secrets/${secret.name}`, { method: "PUT", body: { agents: agents.value() } }), "Salvato")) reload();
        } })));
      }
    };
    return h("li", { class: "vault-row" },
      h("span", { class: "panel-ico" }, icon("key")),
      h("div", { class: "grow vault-text" },
        h("div", { class: "row tight" }, h("b", { class: "vault-name" }, raw(secret.name)), secret.source === "request" ? badge("Arrivato da un link", "", "link") : null),
        secret.description ? h("small", {}, raw(secret.description)) : null,
        h("span", { class: "share-access" }, allowed.length ? allowed.map((name) => h("span", { class: "chip on" }, raw(name))) : h("span", { class: "chip" }, "Nessun agente")),
        h("small", { class: "faint mono" }, secret.uses
          ? raw(tr("usato {count} volte · l'ultima {name}, {when}", { count: secret.uses, name: secret.lastUse?.name || "?", when: fmtTime(new Date(secret.lastUse?.at || secret.updatedAt).toISOString(), true) }))
          : tr("mai usato"), raw(` · ${fmtBytes(secret.size)} · ${tr("aggiornato {when}", { when: fmtTime(new Date(secret.updatedAt).toISOString(), true) })}`)),
        extra),
      data.canManage ? h("div", { class: "row-actions vault-actions" },
        btn("Manda", { icon: "send", cls: "sm ghost", onclick: toggle(`send:${secret.name}`) }),
        btn("Sostituisci", { icon: "refresh", cls: "sm ghost", onclick: () => open("replace") }),
        btn("", { icon: "users", cls: "sm ghost", title: "Chi può usarlo", onclick: () => open("agents") }),
        armedButton("Elimina", "Conferma", { cls: "sm", onconfirm: async () => { if (await guard(api(`/api/secrets/${secret.name}`, { method: "DELETE" }), "Segreto eliminato")) reload(); } })) : null);
  }

  function draw() {
    newButton.hidden = askButton.hidden = !data.canManage;
    if (!data.enabled) {
      body.replaceChildren(artifactsSwitch("segreti"), panel({ icon: "key", title: "Cassaforte" }, h("p", { class: "notice warn" }, icon("alert"), h("span", {}, "Questa Cora non ha una chiave per la cassaforte: serve CORA_SESSION_KEY."))));
      return;
    }
    const proposed = data.sends.filter((item) => item.status === "proposed");
    const live = data.sends.filter((item) => item.status === "active");
    body.replaceChildren(...[
      artifactsSwitch("segreti"),
      proposed.length ? h("section", { class: "requests art-reviews", "aria-label": tr("Invii da approvare") },
        h("span", { class: "label" }, tr("Invii da approvare"), h("i", { class: "count" }, raw(String(proposed.length)))),
        proposed.map((item) => h("div", { class: "art-review" },
          h("span", { class: "panel-ico" }, icon("send")),
          h("span", { class: "grow" }, h("b", {}, raw(`${item.name}`)), h("small", {}, raw(`${item.by?.name || "?"} · ${item.note || ""}`))),
          btn("Rifiuta", { icon: "close", cls: "sm ghost", onclick: async () => { if (await guard(api(`/api/secrets/sends/${item.id}`, { method: "DELETE" }), "Invio rifiutato")) reload(); } }),
          btn("Rivedi e approva", { icon: "check", cls: "sm primary", onclick: toggle(`approve:${item.id}`) })))) : null,
      shown ? panel({ icon: "link", title: shown.title }, shown.link) : null,
      form === "new" ? newForm() : form === "ask" ? askForm()
        : form.startsWith("send:") ? sendForm(form.slice(5))
        : form.startsWith("approve:") && proposed.find((item) => item.id === form.slice(8)) ? sendForm(proposed.find((item) => item.id === form.slice(8)).name, proposed.find((item) => item.id === form.slice(8))) : null,
      panel({ icon: "key", title: "Cassaforte", hint: "Si usano per nome: un agente li mette nel suo hush e lancia i comandi con hush run, senza vederli." },
        data.secrets.length ? h("ul", { class: "vault-list" }, data.secrets.map(secretRow)) : empty("key", "Ancora nessun segreto. Mettine uno, oppure chiedilo con un link a chi lo ha.")),
      data.requests.length ? panel({ icon: "clock", title: "Aspettano di arrivare" },
        h("ul", { class: "vault-list" }, data.requests.map((request) => h("li", { class: "vault-row" },
          h("span", { class: "panel-ico" }, icon("link")),
          h("div", { class: "grow vault-text" }, h("b", { class: "vault-name" }, raw(request.name)), h("small", {}, raw([request.by?.name ? tr("chiesto da {name}", { name: request.by.name }) : "", tr("scade {when}", { when: fmtTime(new Date(request.expiresAt).toISOString(), true) })].filter(Boolean).join(" · ")))),
          data.canManage ? armedButton("Annulla", "Conferma", { icon: "close", cls: "sm", onconfirm: async () => { if (await guard(api(`/api/secrets/requests/${request.id}`, { method: "DELETE" }), "Richiesta annullata")) reload(); } }) : null)))) : null,
      live.length ? panel({ icon: "send", title: "Link di invio" },
        h("ul", { class: "share-list" }, live.map((item) => h("li", { class: "share-row active" },
          h("i", { class: "led on", "aria-hidden": "true" }),
          h("div", { class: "grow share-text" },
            h("div", { class: "row tight" }, h("b", { class: "vault-name" }, raw(item.name)), badge(item.left === 1 ? tr("si apre ancora una volta") : tr("si apre ancora {count} volte", { count: item.left }), "on")),
            shareAccessChips(item.access || { mode: "public" }),
            h("small", {}, raw([item.approvedBy?.name ? tr("chiesto da {name}", { name: item.by?.name || "?" }) : item.by?.name ? tr("creato da {name}", { name: item.by.name }) : "",
              item.note ? `«${item.note}»` : "", item.opened ? tr("aperto {count} di {views}", { count: item.opened, views: item.views }) : tr("non ancora aperto"),
              tr("scade {when}", { when: fmtTime(new Date(item.expiresAt).toISOString(), true) })].filter(Boolean).join(" · ")))),
          data.canManage ? h("div", { class: "row-actions" }, armedButton("Revoca", "Conferma: chiudi il link", { cls: "sm", onconfirm: async () => { if (await guard(api(`/api/secrets/sends/${item.id}`, { method: "DELETE" }), "Link revocato")) reload(); } })) : null)))) : null,
      data.canManage ? vaultLog(data) : null,
    ].filter(Boolean));
  }
  shell([pageHead("Segreti", "Chiavi, password e token usati per nome, come con hush: nessuno li rilegge dal pannello.", [askButton, newButton]), body], { title: "Segreti" });
  reload();
}

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
  // A file on the server keeps its name and place: only its text changes, and a missing one is created where Cora looks for it.
  const beginFile = (source) => {
    if (editor || busy) return;
    editor = { fileId: source.id, name: source.title, path: source.path, content: source.available ? source.content : "", expectedRevision: source.revision || "", create: !source.available };
    errorText = "";
    draw();
    body.querySelector("textarea")?.focus();
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
    const drafting = editor && !editor.id && !editor.fileId;
    const editingHere = (source) => !editor || editor.id || editor.fileId === source.id;
    if (drafting) list.append(h("span", { class: "context-draft" }, icon("edit"), "Nuovo file"));
    if (stored.length) list.append(h("span", { class: "context-group label" }, "File dello spazio"));
    for (const [index, source] of [...stored, ...data.sources.filter((source) => source.storage !== "database")].entries()) {
      if (stored.length && index === stored.length) list.append(h("span", { class: "context-group label" }, "Istruzioni e memoria"));
      list.append(h("button", { type: "button", class: `context-file${source.id === selectedId && editingHere(source) ? " active" : ""}`, "aria-pressed": String(source.id === selectedId && Boolean(editingHere(source))), disabled: busy, onclick: () => choose(source.id) },
        icon(source.storage === "database" ? "file" : source.provider === "cora" ? "book" : "file"),
        h("span", { class: "grow" }, h("b", {}, raw(source.title)),
          h("small", {}, source.storage === "database" ? labels[source.status] : raw(source.provider === "codex" ? "ChatGPT / Codex" : source.provider === "claude" ? "Claude" : "Cora"), raw(" · "), scopes[source.scope])),
        h("i", { class: `context-file-dot ${source.status}`, "aria-label": labels[source.status] })));
    }
    const error = errorText ? h("p", { class: "context-error", role: "alert" }, icon("alert"), tr(errorText)) : null;
    let document;
    if (editor?.fileId) {
      const limit = data.limits.serverFileChars;
      const counter = () => tr("{count} / {limit} caratteri", { count: editor.content.length.toLocaleString(LOCALE), limit: limit.toLocaleString(LOCALE) });
      const count = h("small", { class: "context-count" }, counter());
      const text = h("textarea", { name: "contextContent", class: "context-editor-text", spellcheck: "false", placeholder: "Scrivi le istruzioni in Markdown…", oninput: (event) => { editor.content = event.target.value; count.textContent = counter(); } }, raw(editor.content));
      const form = h("form", { class: "context-editor" }, error, field("Contenuto", text), count,
        h("div", { class: "context-editor-actions" }, btn("Annulla", { cls: "ghost", onclick: () => { editor = null; errorText = ""; draw(); } }), btn(busy ? "Salvataggio…" : editor.create ? "Crea il file" : "Salva file", { icon: "check", type: "submit", cls: "primary" })));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorText = !editor.content.trim() ? "inserisci un file di testo non vuoto" : editor.content.length > limit ? "il file supera il limite di 60.000 caratteri" : "";
        if (errorText) { draw(); return; }
        const draft = { ...editor };
        mutate(() => api(`/api/context/files/${encodeURIComponent(draft.fileId)}`, { method: "PUT", body: { content: draft.content, expectedRevision: draft.expectedRevision } }), draft.create ? "File creato" : "File salvato");
      });
      document = h("section", { class: "context-document" }, h("header", {}, h("div", { class: "grow" }, h("h2", {}, raw(editor.name)), h("p", { class: "context-path" }, raw(editor.path)))),
        h("p", { class: "context-explanation" }, editor.create ? "Il file non c'è: salvando lo crei sul server, dove lo cerca chi lo legge." : "Salvando riscrivi il file sul server. Se è un collegamento, cambia il file a cui punta."), form);
      for (const control of form.querySelectorAll("textarea, button")) control.disabled = busy;
    } else if (editor) {
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
        : "File disponibile a Claude. Il caricamento dipende dal profilo e dal runtime del turno.";
      const copy = selected.content ? btn("Copia testo", { icon: "copy", cls: "ghost", onclick: async () => {
        try { await navigator.clipboard.writeText(selected.content); toast("Copiato"); } catch { toast("Non riesco a copiare: selezionalo a mano", true); }
      } }) : null;
      document = h("section", { class: "context-document" },
        h("header", {}, h("div", { class: "grow" }, h("h2", {}, raw(selected.title)),
          selected.path || custom ? h("p", { class: "context-path" }, custom ? "Salvato nel database di questa istanza" : raw(selected.path)) : null), copy), error,
        h("div", { class: "context-provenance" }, badge(labels[selected.status], selected.status === "applied" ? "on" : ""), selected.updatedAt ? h("time", { datetime: selected.updatedAt }, raw(new Date(selected.updatedAt).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" }))) : null),
        h("p", { class: "context-explanation" }, explanation), selected.accountLabel ? h("p", { class: "context-explanation" }, raw(selected.accountLabel)) : null,
        !custom && data.canWriteFiles && selected.editable ? h("div", { class: "context-tools" }, btn(selected.available ? "Modifica" : "Crea il file", { icon: selected.available ? "edit" : "plus", onclick: () => beginFile(selected) })) : null,
        !custom && data.canWriteFiles && selected.available && !selected.editable ? h("p", { class: "context-explanation" }, "È più lungo di 60.000 caratteri: si modifica solo sul server.") : null,
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
  shell([btn("Impostazioni", { icon: "back", href: "#/settings", cls: "ghost sm back-link art-back" }),
    pageHead("Contesto", "Le istruzioni del server e i file che tutti gli agenti leggono.", [upload, newButton, refresh]),
    h("small", { class: "context-upload-hint" }, "File .md e .txt · 30.000 caratteri per file · 60.000 caratteri attivi in totale"), fileInput, body], { title: "Contesto", back: "#/settings" });
  newButton.disabled = upload.disabled = true;
  load();
}

/* ---------- settings ---------- */
function subscriptionPlanLabel(plan) {
  // Meta names its tiers itself ("Muse Code High Usage"): those are shown as they come.
  return ({ free: "Free", pro: "Pro", plus: "Plus", max: "Max", team: "Team", enterprise: "Enterprise", business: "Business", self_serve_business_prolite: "Business" })[plan] || (/\s/.test(plan) ? plan : tr("Abbonamento attivo"));
}

/** Each agent's owner grants operational access independently of private panel access. */
function agentPermissionsPane(agent) {
  const body = h("div", { class: "stack" }, h("p", { class: "muted", role: "status" }, "Caricamento…"));
  let data, busy = false;
  const draw = () => {
    body.replaceChildren(...[
      h("p", { class: "lead agent-permission-note" }, "Le persone autorizzate possono conversare con questo agente, usare la sua memoria nelle risposte e affidargli lavori. Gli accessi privati al pannello restano al proprietario."),
      data.people.length ? h("div", { class: "agent-permissions" }, data.people.map((person) => {
        const control = h("input", { type: "checkbox", checked: person.inherent || person.allowed, disabled: busy || !data.canManage || person.inherent, "aria-label": tr("Autorizza {name}", { name: person.name }) });
        control.addEventListener("change", async () => {
          if (busy) return;
          const allowed = control.checked;
          busy = true;
          draw();
          try {
            data = await api(`/api/agents/${agent.id}/permissions`, { method: "PUT", body: { id: person.id, allowed } });
            toast("Permessi aggiornati");
          } catch (error) { toast(error.message, true); }
          busy = false;
          draw();
        });
        return h("label", { class: "agent-permission" }, h("span", { class: "access-user-mark" }, icon(TRANSPORTS[person.transport]?.icon || "user")),
          h("span", { class: "grow" }, h("b", {}, raw(person.name)), h("small", {}, raw(TRANSPORTS[person.transport]?.label || person.transport), person.inherent ? tr(" · referente dell'agente") : person.last ? raw(` · ${tr("ultimo messaggio")} ${new Date(person.last).toLocaleDateString(LOCALE)}`) : null)),
          h("span", { class: "switch" }, control, h("span", { class: "rocker" })));
      })) : h("p", { class: "access-no-rules" }, "Le persone compaiono dopo aver scritto in un canale dell'agente o al suo bot."),
      data.canManage ? null : h("p", { class: "access-note" }, icon("info"), "Solo il proprietario dell'agente cambia le autorizzazioni.")].filter(Boolean));
  };
  api(`/api/agents/${agent.id}/permissions`).then((value) => { data = value; draw(); })
    .catch((error) => body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), raw(error.message))));
  return panel({ icon: "shield", title: "Autorizzazioni", hint: tr("Chi può parlare e affidare lavori a {name}.", { name: agent.name }) }, body);
}

function instanceAccessPanel() {
  const current = S.data.currentUser;
  const identity = h("div", { class: "access-identity" }, icon("user"),
    h("div", { class: "grow" }, h("b", {}, raw(current?.name || current?.email || "Owner")), current?.email ? h("small", {}, raw(current.email)) : null),
    badge(current?.role === "member" ? "Utente" : "Owner", "on"));
  if (!S.data.access?.canManage) return panel({ icon: "shield", title: "Accesso all'istanza", hint: "Il tuo account e i permessi di questa Cora." }, identity,
    h("p", { class: "lead" }, "Puoi usare le tue risorse e quelle condivise con te. L'owner gestisce chi può entrare."));
  const body = h("div", { class: "stack" }, h("p", { class: "muted", role: "status" }, "Caricamento…"));
  const feedback = h("p", { class: "access-progress", role: "status", "aria-live": "polite", hidden: true });
  const invitationStates = { not_sent: "Invito non ancora inviato", sending: "Invio dell'invito…", sent: "Invito inviato", failed: "Invito non inviato. Puoi riprovare.", uncertain: "Invio non confermato. Controlla prima di reinviare.", unavailable: "Inviti e-mail non disponibili su questa istanza.", blocked: "Accesso revocato: riabilitalo per inviare l'invito." };
  let data;
  let busy = false;
  const update = async (fn, email = "") => {
    if (busy) return;
    busy = true;
    feedback.hidden = false;
    feedback.replaceChildren(icon(email ? "mail" : "refresh"), h("span", {}, email ? "Invio dell'invito…" : "Aggiornamento accessi…"));
    for (const button of body.querySelectorAll("button")) button.disabled = true;
    try {
      await fn(); data = await api("/api/access"); draw();
      const invitation = email && data.invitations?.find((item) => item.email === email.toLowerCase());
      toast(invitation ? invitationStates[invitation.status] || invitationStates.uncertain : "Accessi aggiornati", Boolean(invitation && invitation.status !== "sent"));
    }
    catch (error) { toast(error.message, true); }
    finally { busy = false; feedback.hidden = true; for (const button of body.querySelectorAll("button")) button.disabled = false; }
  };
  const rules = (kind, title, hint, placeholder) => {
    const input = h("input", { type: kind === "emails" ? "email" : "text", "aria-label": kind === "emails" ? "Email da autorizzare" : "Dominio da autorizzare", placeholder, autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
    const add = btn(kind === "emails" ? data.canInvite ? "Autorizza e invita" : "Autorizza" : "Aggiungi", { icon: "plus", onclick: () => {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      update(() => api("/api/access", { method: "PUT", body: { [kind]: [...data[kind], value] } }), kind === "emails" ? value : "");
    } });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add.click(); } });
    return h("section", { class: "set-section access-rules" }, h("span", { class: "label" }, title), h("p", { class: "muted" }, hint),
      h("div", { class: "access-add" }, input, add),
      h("ul", {}, data[kind].length ? data[kind].map((value) => {
        const invitation = kind === "emails" ? data.invitations?.find((item) => item.email === value) : null;
        return h("li", { class: `access-rule${kind === "emails" ? " access-invitation" : ""}` }, icon(kind === "domains" ? "globe" : "user"),
          h("span", { class: "grow" }, h("span", {}, raw((kind === "domains" ? "@" : "") + value)), kind === "emails" ? h("small", { class: invitation?.status === "sent" ? "ok-text" : "muted" }, invitationStates[invitation?.status || "not_sent"], invitation?.sentAt ? raw(` · ${fmtTime(invitation.sentAt, true)}`) : null) : null),
          kind === "emails" && data.canInvite && invitation?.status !== "blocked" ? btn(invitation?.status === "sent" ? "Reinvia invito" : "Invia invito", { icon: "mail", cls: "sm ghost access-invite-send", onclick: () => update(() => api("/api/access/invitations", { method: "POST", body: { email: value } }), value) }) : null,
          btn("", { icon: "close", cls: "ghost access-rule-remove", title: tr("Rimuovi {value}", { value }), onclick: () => update(() => api("/api/access", { method: "PUT", body: { [kind]: data[kind].filter((entry) => entry !== value) } })) }));
      })
        : h("li", { class: "access-no-rules" }, kind === "domains" ? "Nessun dominio autorizzato." : "Nessun indirizzo aggiunto.")));
  };
  const actions = { "sign-in": "Accesso effettuato", settings: "Impostazioni aggiornate", agent: "Agente modificato", message: "Messaggio inviato", connections: "Collegamenti aggiornati", "access-policy": "Accessi aggiornati", context: "Contesto aggiornato", artifacts: "Artefatti aggiornati" };
  function draw() {
    const users = h("div", { class: "access-users" }, data.users.map((user) => h("div", { class: "access-user" },
      h("span", { class: "access-user-mark", "aria-hidden": "true" }, icon(user.role === "owner" ? "shield" : "user")),
      h("div", { class: "grow" }, h("b", {}, raw(user.name || user.email || "Owner")), user.email ? h("span", { class: "access-user-email" }, raw(user.email)) : null,
        h("small", {}, tr("Prima visita: {date}", { date: new Date(user.createdAt).toLocaleDateString(LOCALE) }), raw(" · "),
          tr("Ultima attività: {date}", { date: new Date(user.lastSeenAt).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }) }))),
      badge(user.role === "owner" ? "Owner" : user.blocked ? "Revocato" : user.allowed ? "Utente" : "Non autorizzato", user.allowed ? "on" : ""),
      user.role === "owner" ? null : btn(user.blocked ? "Riabilita" : "Revoca accesso", { cls: user.blocked ? "ghost" : "ghost danger", onclick: () => update(() => api(`/api/access/users/${user.id}`, { method: "PUT", body: { blocked: !user.blocked } })) }))));
    body.replaceChildren(
      h("p", { class: "lead" }, "L'owner autorizza e revoca l'accesso allo spazio. Agenti, Brain e file seguono i rispettivi permessi."),
      rules("domains", "Domini autorizzati", "Ammetti tutti gli account con un indirizzo verificato di questi domini.", "es. azienda.it"),
      rules("emails", "Singole persone", data.canInvite ? "Ogni nuova persona riceve un invito con link dello spazio e istruzioni di accesso." : "Autorizza una persona senza aprire l'accesso a tutto il suo dominio.", "nome@azienda.it"),
      h("p", { class: "access-note" }, icon("info"), "Quando un utente perde l'autorizzazione, si chiudono anche le sue sessioni aperte. L'owner conserva sempre l'accesso."),
      h("section", { class: "set-section access-people" }, h("span", { class: "label" }, "Utenti di questa istanza"),
        h("p", { class: "muted" }, "Ogni persona mantiene la propria identità, anche nei messaggi agli agenti."), users),
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
  return panel({ icon: "shield", title: "Accesso all'istanza", hint: "Scegli chi può entrare nella tua Cora.", actions: refresh }, feedback, body);
}

/** The connections, by name: what each account or key is for, and whether it works here. */
const CONNECTION_KEYS = [
  ["ollama", "Ollama", "globe"],
  ["orcarouter", "OrcaRouter", "share"],
  ["deepseek", "DeepSeek", "search"],
  ["typesafe", "TypeSafe", "shield"],
  ["soniox", "Soniox", "mic"],
];

/**
 * Settings → Collegamenti: one entry per account and per key on the left, like
 * the channel list of a desk, each with its LED; on the right only the chosen
 * one. On phones the list comes first and an entry opens its own page.
 * Every page stays mounted, so a sign-in half done survives a switch.
 */
// doc's built-in Jev checks, in the panel's words; a check doc adds later shows its own reason.
const DOC_CHECKS = {
  "reply:effort": ["Stime di tempo e di lavoro", "Ferma una stima di quanto ci vorrà, o di quanto c'è voluto."],
  "reply:secret_request": ["Segreti chiesti in chat", "Ferma la richiesta di incollare chiavi, token o password nella chat."],
  "comment:local_state": ["Lavoro rimasto in locale", "Ferma un commento che dice che qualcosa non è ancora pushato."],
  "comment:effort": ["Stime nei commenti", "Ferma le stime di tempo o di lavoro nei commenti."],
  "comment:process_log": ["Racconto del lavoro", "Ferma tentativi, comandi e setup al posto dei risultati."],
  "comment:billing": ["Ore e fatturazione", "Ferma le ore fatturabili e il tempo tracciato."],
};
const DOC_TARGETS = [["reply", "Messaggi in chat", "Quello che gli agenti scrivono alle persone: say, domande, notifiche e risposte."], ["comment", "Commenti pubblicati", "Quello che pubblicano su GitHub o Linear dal loro computer."]];

/** The checks doc runs for the agents: doc's own, switched on or off, and the owner's, tried on every harness before they are saved. */
function docChecksPane() {
  const root = h("div", { class: "stack" });
  let data = null;
  const save = async (off, added, okText = "Controlli aggiornati") => {
    const result = await guard(api("/api/doc/rules", { method: "PUT", body: { off, add: added } }), okText);
    if (result) data = result;
    return result;
  };
  const offList = () => data.builtins.filter((rule) => !rule.enabled).map((rule) => `${rule.on}:${rule.key}`);
  const points = (value) => Number(value ?? 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const quiet = (input) => input.addEventListener("keydown", (event) => { if (event.key === "Enter" && input.tagName !== "TEXTAREA") event.preventDefault(); });

  const editor = (existing = null) => {
    const name = h("input", { type: "text", maxlength: 60, autocomplete: "off", placeholder: "Clienti per nome", value: existing?.name || "" });
    const question = h("textarea", { maxlength: 500, rows: 3, placeholder: "Il testo nomina un cliente o un suo referente?" }, existing?.question || "");
    const fix = h("input", { type: "text", maxlength: 300, autocomplete: "off", placeholder: "Togli il nome del cliente.", value: existing?.fix || "" });
    const keywords = h("input", { type: "text", autocomplete: "off", placeholder: "acme, rossi", value: (existing?.keywords || []).join(", ") });
    const targets = DOC_TARGETS.map(([target, label]) => {
      const input = h("input", { type: "checkbox", checked: existing ? existing.on.includes(target) : target === "reply" });
      return { target, input, node: h("label", { class: "switch" }, input, h("span", { class: "rocker" }), h("span", { class: "switch-text" }, label)) };
    });
    [name, fix, keywords].forEach(quiet);
    const draft = () => ({ ...(existing ? { key: existing.key, enabled: existing.enabled } : {}), name: name.value.trim(), question: question.value.trim(), fix: fix.value.trim(), keywords: keywords.value, on: targets.filter((item) => item.input.checked).map((item) => item.target) });
    let tested = "";
    const results = h("div", { class: "doc-trials", "aria-live": "polite" });
    const summary = h("p", { class: "muted", role: "status" });
    const saveButton = btn(existing ? "Salva le modifiche" : "Salva controllo", { icon: "check", cls: "primary", disabled: true, onclick: async () => {
      const rule = draft();
      const others = data.added.filter((item) => item.key !== existing?.key);
      if (await save(offList(), [...others, rule], existing ? "Controllo aggiornato" : "Controllo aggiunto")) draw();
    } });
    const invalidate = () => {
      if (!tested || tested === JSON.stringify(draft())) return;
      tested = "";
      saveButton.disabled = true;
      summary.textContent = tr("Hai cambiato il controllo: provalo di nuovo prima di salvarlo.");
    };
    for (const control of [name, question, fix, keywords, ...targets.map((item) => item.input)]) control.addEventListener("input", invalidate);
    const trialRow = (result) => {
      const verdict = result.status === "error" ? [badge("Errore", "warn", "alert"), h("span", {}, raw(result.error || ""))]
        : !result.caught ? [badge("Non fermato", "warn", "alert"), h("span", {}, tr("Jev non l'ha fermato ({score}).", { score: points(result.exampleScore) }))]
          : !result.fixed ? [badge("Riscrittura fermata", "warn", "alert"), h("span", {}, tr("Fermato ({score}), ma anche la riscrittura non passa ({again}).", { score: points(result.exampleScore), again: points(result.rewriteScore) }))]
            : [badge("Funziona", "on", "check"), h("span", {}, tr("Fermato ({score}), poi riscritto e passato ({again}).", { score: points(result.exampleScore), again: points(result.rewriteScore) }))];
      return h("div", { class: "doc-trial" },
        h("div", { class: "doc-trial-head" }, h("b", {}, raw(result.label)), h("small", {}, raw(result.agents.join(", ")))),
        h("div", { class: "doc-trial-verdict" }, verdict, result.retried ? h("small", {}, "esempio al secondo tentativo") : null),
        result.example ? h("details", {}, h("summary", {}, "Cosa ha scritto"),
          h("p", {}, h("span", { class: "label" }, "Esempio"), raw(result.example)),
          result.rewrite ? h("p", {}, h("span", { class: "label" }, "Riscritto"), raw(result.rewrite)) : null) : null);
    };
    const tryButton = btn("Prova con tutti gli harness", { icon: "shield", onclick: async () => {
      const rule = draft();
      const started = await guard(api("/api/doc/rules/test", { method: "POST", body: { rule } }));
      if (!started) return;
      tryButton.disabled = true;
      saveButton.disabled = true;
      results.replaceChildren();
      summary.textContent = tr("Ogni harness scrive un esempio che viola il controllo, poi lo riscrive dopo lo stop: {done} di {total}.", { done: 0, total: started.total });
      const timer = setInterval(async () => {
        const job = await api(`/api/doc/rules/test/${started.id}`).catch(() => null);
        if (!job || !results.isConnected) { if (!results.isConnected) clearInterval(timer); return; }
        results.replaceChildren(...job.results.map(trialRow));
        if (job.status !== "done") { summary.textContent = tr("Ogni harness scrive un esempio che viola il controllo, poi lo riscrive dopo lo stop: {done} di {total}.", { done: job.results.length, total: job.total }); return; }
        clearInterval(timer);
        tryButton.disabled = false;
        const good = job.results.filter((result) => result.caught && result.fixed).length;
        tested = JSON.stringify(rule) === JSON.stringify(draft()) ? JSON.stringify(rule) : "";
        saveButton.disabled = !tested;
        summary.textContent = tr(good === job.total ? "Funziona con tutti gli harness: puoi salvarlo." : "Funziona con {good} harness su {total}: controlla i dettagli prima di salvarlo.", { good, total: job.total });
      }, 1500);
      S.timers.push(timer);
    } });
    if (!data.keySet) tryButton.disabled = true;
    return h("div", { class: "doc-editor stack-sm" },
      h("div", { class: "grid2" }, field("Nome", name), field("Solo se il testo contiene", keywords, "parole separate da virgole; vuoto: Jev legge ogni testo")),
      field("Cosa deve riconoscere Jev", question, "una domanda a cui si risponde sì o no"),
      field("Cosa dire all'agente quando scatta", fix),
      h("div", { class: "doc-targets" }, targets.map((item) => item.node)),
      data.keySet ? null : h("p", { class: "notice warn" }, icon("alert"), h("span", {}, "Per provare un controllo serve la chiave TypeSafe, in Impostazioni → TypeSafe.")),
      h("div", { class: "row" }, tryButton, btn("Annulla", { cls: "ghost", onclick: () => draw() }), saveButton),
      summary, results);
  };

  const draw = (editing = undefined) => {
    const builtinRow = (rule) => {
      const [label, about] = DOC_CHECKS[`${rule.on}:${rule.key}`] || [rule.key, rule.reason];
      const input = h("input", { type: "checkbox", checked: rule.enabled, onchange: async () => {
        rule.enabled = input.checked;
        if (!(await save(offList(), data.added))) { rule.enabled = !input.checked; input.checked = rule.enabled; }
      } });
      return h("div", { class: "doc-check" }, h("label", { class: "switch" }, input, h("span", { class: "rocker" }), h("span", { class: "switch-text" }, label, h("small", {}, about))), badge("doc", "", "shield"));
    };
    const ownRow = (rule) => {
      const input = h("input", { type: "checkbox", checked: rule.enabled, onchange: async () => {
        const updated = data.added.map((item) => item.key === rule.key ? { ...item, enabled: input.checked } : item);
        if (!(await save(offList(), updated))) input.checked = !input.checked;
      } });
      return h("div", { class: "doc-check own" },
        h("label", { class: "switch" }, input, h("span", { class: "rocker" }), h("span", { class: "switch-text" }, raw(rule.name), h("small", {}, raw(rule.question)), rule.keywords.length ? h("small", { class: "mono" }, raw(rule.keywords.join(", "))) : null)),
        h("div", { class: "doc-check-actions" },
          btn("", { icon: "edit", cls: "sm ghost", title: "Modifica", onclick: () => draw(rule.key) }),
          btn("", { icon: "trash", cls: "sm ghost", title: "Elimina", onclick: async () => { if (await save(offList(), data.added.filter((item) => item.key !== rule.key), "Controllo eliminato")) draw(); } })));
    };
    const groups = DOC_TARGETS.map(([target, label, about]) => h("div", { class: "doc-group" },
      h("div", { class: "doc-group-head" }, h("h3", {}, label), h("p", {}, about)),
      data.builtins.filter((rule) => rule.on === target).map(builtinRow),
      data.added.filter((rule) => rule.on.includes(target)).map(ownRow)));
    const adding = editing === null || typeof editing === "string";
    root.replaceChildren(panel({ icon: "shield", title: "Controlli di doc", hint: "Jev di TypeSafe legge quello che gli agenti scrivono alle persone e i commenti che pubblicano, e ferma quello che un controllo vieta. L'agente riceve il motivo e riscrive." },
      data.keySet ? null : h("p", { class: "notice warn" }, icon("alert"), h("span", {}, "Senza la chiave TypeSafe Jev non giudica: restano solo le regole esatte. Aggiungila in Impostazioni → TypeSafe.")),
      adding ? editor(typeof editing === "string" ? data.added.find((rule) => rule.key === editing) : null)
        : h("div", { class: "doc-add" }, btn("Aggiungi un controllo", { icon: "plus", onclick: () => draw(null) })),
      groups,
      h("p", { class: "muted" }, "Percorsi locali e righe di attribuzione nei commenti sono bloccati sempre: sono regole esatte, non controlli di Jev.")));
  };

  root.append(skeleton("rows", 4));
  api("/api/doc/rules").then((result) => { data = result; draw(); }, (error) => {
    root.replaceChildren(panel({ icon: "shield", title: "Controlli di doc" }, h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))));
  });
  return root;
}

/* ---------- settings ---------- */

/** One setting: what it is and what it does on the left, its control on the right (under it with `stack`, and on phones). */
function setRow(label, hint, control, { stack = false, cls = "" } = {}) {
  return h("div", { class: `set-row${stack ? " stack" : ""}${cls ? ` ${cls}` : ""}` },
    h("div", { class: "set-text" }, h("b", {}, label, h("span", { class: "set-saved", "aria-live": "polite" })), hint ? h("small", {}, hint) : null),
    control ? h("div", { class: "set-control" }, control) : null);
}

/** A run of setting rows, between hairlines. */
function setRows(...rows) {
  return h("div", { class: "set-rows" }, rows);
}

/**
 * Settings save as they change, one field at a time: the row says "salvato" for a
 * moment, a refusal comes back as a toast. There is no Save button anywhere in Settings.
 */
/** How much room the artifacts may take: half the disk unless the owner sets a number. */
function artifactSpacePanel() {
  const gb = 1024 ** 3;
  const first = S.data.artifacts.space;
  const half = first.disk ? Math.floor(first.disk.total / 2) : 0;
  const box = h("div", { class: "stack-sm space-box" });
  const paint = () => {
    const space = S.data.artifacts.space;
    box.replaceChildren(
      h("div", { class: "space-summary" },
        h("div", {}, h("b", {}, raw(fmtBytes(space.used))), h("small", {}, raw(tr("occupati dagli artefatti, di {limit}", { limit: fmtBytes(space.limit) })))),
        space.disk ? h("div", {}, h("b", {}, raw(fmtBytes(space.disk.free))), h("small", {}, raw(tr("liberi sul disco, di {total}", { total: fmtBytes(space.disk.total) })))) : null),
      h("div", { class: "space-meter", role: "img", "aria-label": tr("{used} di {limit}", { used: fmtBytes(space.used), limit: fmtBytes(space.limit) }) },
        h("i", { vars: { "--fill": `${Math.min(100, Math.max(space.used ? 0.6 : 0, (space.used / Math.max(1, space.limit)) * 100)).toFixed(2)}%` } })));
  };
  paint();
  const amount = h("input", { type: "number", min: 1, step: 1, class: "mono", value: first.custom ? Math.round(first.limit / gb) : Math.max(1, Math.round(half / gb)), "aria-label": tr("Gigabyte") });
  const custom = h("div", { class: "space-custom", hidden: !first.custom }, amount, h("span", { class: "mono" }, "GB"));
  const choice = { value: first.custom ? "custom" : "half" };
  const save = async (gbValue) => {
    await saveSettings({ artifactQuotaGb: gbValue }, row);
    try { S.data.artifacts.space = (await api("/api/artifacts")).quota; } catch {}
    paint();
    const line = document.querySelector('.rail-item[data-page="spazio"] .rail-name small');
    const space = S.data.artifacts.space;
    if (line) line.textContent = tr("{used} di {limit} per gli artefatti", { used: fmtBytes(space.used), limit: fmtBytes(space.limit) });
  };
  const modes = h("div", { class: "segmented", role: "radiogroup", "aria-label": tr("Tetto") },
    [["half", half ? tr("Metà del disco · {size}", { size: fmtBytes(half) }) : tr("Metà del disco")], ["custom", tr("Un tetto mio")]].map(([key, label]) => h("button", { type: "button", role: "radio", class: key === choice.value ? "on" : "", "aria-checked": String(key === choice.value), onclick: (event) => {
      choice.value = key;
      for (const button of modes.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
      custom.hidden = key !== "custom";
      if (key === "half") save(0);
      else amount.focus?.();
    } }, raw(label))));
  amount.addEventListener("change", () => { const value = Math.round(Number(amount.value)); if (value >= 1) save(value); });
  const row = setRow("Tetto per gli artefatti", "Quanto possono occupare i file caricati dagli agenti e dal pannello. Di base è metà del disco; in ogni caso un caricamento si ferma se lascerebbe meno di 5 GB liberi.", h("div", { class: "stack-sm" }, modes, custom), { stack: true });
  return panel({ icon: "layers", title: "Spazio", hint: "Lo spazio che usano gli artefatti su questa macchina." }, box, setRows(row));
}

async function saveSettings(changes, row = null) {
  try {
    S.data.settings = await api("/api/settings", { method: "PUT", body: changes });
  } catch (error) {
    toast(error.message, true);
    return false;
  }
  const mark = row?.querySelector(".set-saved");
  if (mark) {
    mark.textContent = tr("salvato");
    mark.classList.add("on");
    clearTimeout(mark.timer);
    mark.timer = setTimeout(() => { mark.classList.remove("on"); mark.textContent = ""; }, 1800);
  }
  return true;
}

const idList = (text) => String(text || "").split(/[\s,]+/).filter(Boolean);

/** A list of switches that saves the ids of the ones on, as a whole, at every change. */
function switchList(items, chosen, key, row) {
  const list = h("div", { class: "set-switches" }, items.map((item) => h("label", { class: "switch" },
    h("input", { type: "checkbox", value: item.id, checked: chosen.includes(item.id) }),
    h("span", { class: "rocker" }),
    h("span", { class: "switch-text" }, raw(item.name), item.sub ? h("small", { class: item.mono ? "mono" : "" }, item.sub) : null))));
  list.addEventListener("change", async () => {
    const inputs = [...list.querySelectorAll("input")];
    const ids = inputs.filter((input) => input.checked).map((input) => input.value);
    if (!(await saveSettings({ [key]: ids }, row()))) {
      await loadState();
      renderSettings();
    }
  });
  return list;
}

/** A text field of ids (the owners); the page saves it when it is left. */
function idsInput(key, label) {
  return h("input", { type: "text", class: "mono", value: (S.data.settings[key] || []).join(", "), autocomplete: "off", spellcheck: "false", "aria-label": label });
}

/** Which transport a channel page is about, said the way the list says it. */
function channelState(kind) {
  const info = transportInfo(kind);
  const inUse = platformsOn().includes(kind);
  // Telegram can live on the agents' own bots alone.
  if (inUse && kind === "telegram" && info.state === "missing-token" && S.data.agents.some((agent) => agent.telegramBot?.user)) return ["on", tr("acceso · bot degli agenti")];
  if (info.state === "missing-token") return ["off", tr("senza token")];
  if (info.state === "error") return ["err", tr("errore")];
  if (inUse) return [info.state === "ready" ? "on" : "busy", tr("in uso · {state}", { state: tr(STATE_LABEL[info.state] || info.state) })];
  return ["off", tr("pronto, non in uso")];
}

/** Switches platforms on and off together: the primary stays, or passes to the first one left. */
async function savePlatforms(transports, transport, ok) {
  const primary = transports.includes(transport) ? transport : transports[0];
  if (await guard(api("/api/settings", { method: "PUT", body: { transports, transport: primary } }), ok)) {
    await loadState();
    renderSettings();
    return true;
  }
  return false;
}

/** Whether Cora is on a platform, next to the others, and whether it is the primary one. */
function platformControls(kind) {
  const on = platformsOn();
  const label = TRANSPORTS[kind].label;
  if (!on.includes(kind)) {
    const add = btn(tr("Accendi {transport}", { transport: label }), { icon: TRANSPORTS[kind].icon, cls: "primary", onclick: async () => {
      add.disabled = true;
      if (!await savePlatforms([...on, kind], S.data.transport, tr("{transport} acceso", { transport: label }))) add.disabled = false;
    } });
    return setRow("Spento", tr("Acceso resta insieme a {others}. Gli agenti ci arrivano spenti: ognuno lo accendi dalla sua pagina.", { others: on.map((item) => TRANSPORTS[item].label).join(", ") }), add);
  }
  if (on.length === 1) return setRow(tr("Cora vive su {transport}", { transport: label }), "Puoi accendere anche le altre piattaforme, insieme. Il salotto del pannello c'è sempre.");
  const primary = S.data.transport === kind;
  const off = armedButton("Spegni", "Conferma", { icon: "power", cls: "sm", onconfirm: () => savePlatforms(on.filter((item) => item !== kind), S.data.transport, tr("{transport} spento", { transport: label })) });
  const lead = primary ? null : btn("Rendi principale", { icon: "pin", cls: "sm ghost", onclick: () => savePlatforms(on, kind, tr("{transport} è la principale", { transport: label })) });
  return setRow(primary ? "Acceso · principale" : "Acceso",
    primary ? "I messaggi privati di Cora per te arrivano qui." : tr("I messaggi privati di Cora per te arrivano su {transport}.", { transport: TRANSPORTS[S.data.transport].label }),
    h("div", { class: "row" }, lead, off));
}

/** A provider's subscription accounts, as the list says them. */
function providerState(provider) {
  const records = (S.data.subscriptions || []).filter((item) => item.provider === provider);
  const ready = records.filter((item) => item.status === "ready").length;
  if (ready) return ["on", ready === 1 ? tr("1 account") : tr("{count} account", { count: ready })];
  if (records.some((item) => item.status === "connecting")) return ["busy", tr("Accesso in corso")];
  if (!S.data.providers?.[provider]) return ["off", tr("{cli} non installato", { cli: CLI_NAMES[provider] })];
  return ["off", tr("Da collegare")];
}

/** An API key, and for Ollama what else counts: a local Ollama, or this machine paired with Ollama Cloud. */
function keyState(provider) {
  if (S.data.keys?.[provider]) return provider === "deepseek" && !S.data.providers?.deepseekInstalled ? ["warn", tr("dsh non installato")] : ["on", tr("Chiave salvata")];
  if (provider === "ollama" && S.data.ollamaCloud?.signedIn) return ["on", tr("Collegato a Ollama Cloud")];
  if (provider === "ollama" && S.data.providers?.ollamaLocal) return ["on", tr("Ollama locale")];
  return ["off", tr("Da configurare")];
}

/**
 * Settings: one list of everything on the left, grouped like a desk's sections, and
 * the page of the entry in the address on the right (#/settings/<entry>). Every page
 * is panels of rows, and every change saves itself. On phones the list comes first
 * and an entry opens its page alone, with a way back.
 */
function renderSettings() {
  if (route()[1] === "permessi") { location.hash = "#/agenti"; return; }
  const settings = S.data.settings;
  const manage = S.data.access?.canManage !== false;
  let current = "";
  // The list is drawn as soon as a page asks (an account list redraws it while it is built), so it starts empty.
  let entries = [];
  const fallback = () => S.data.transport || "discord";
  // The box keeps its margin while the list scrolls inside it.
  const list = h("div", { class: "rail-list" });
  const nav = h("nav", { class: "rail-nav", "aria-label": tr("Impostazioni") }, list);
  const pages = new Map();
  const back = () => btn("Impostazioni", { icon: "back", cls: "sm ghost rail-back", onclick: () => show("") });
  const page = (id, ...content) => pages.set(id, h("div", { class: "stack" }, back(), content));

  page("email", emailChannelPane());
  page("connettori", connectorsPane());
  page("mcp", panelMcpPane());

  /* ---------- Canali ---------- */
  const listenRow = (kind) => platformControls(kind);
  const ownersRow = (key, hint) => {
    const input = idsInput(key, tr("Proprietari"));
    const row = setRow("Proprietari", hint, input, { stack: true });
    input.addEventListener("change", async () => {
      if (await saveSettings({ [key]: idList(input.value) }, row)) input.value = S.data.settings[key].join(", ");
    });
    return row;
  };
  const channelBadge = (kind) => {
    const [led, line] = channelState(kind);
    return badge(raw(line), led === "on" ? "on" : led === "err" ? "err" : led === "busy" ? "warn" : "", led === "on" ? "radio" : led === "err" ? "alert" : TRANSPORTS[kind].icon);
  };

  const discord = S.data.discord;
  const guilds = discord.guilds;
  const listening = S.data.agents.find((agent) => agent.bot?.user && agent.bot.user.id === discord.user?.id);
  let guildRow;
  page("discord",
    panel({ icon: "hash", title: "Discord", hint: "Un bot ascolta i server accesi; ogni agente scrive col suo.", actions: channelBadge("discord") },
      setRows(listenRow("discord"),
        discord.user
          ? setRow("Bot che ascolta", h("span", {}, h("b", {}, raw(discord.user.username)), listening ? tr(" (il bot dell'agente)") : "", raw(` · ${tr(STATE_LABEL[discord.state] || discord.state)}`)))
          : discord.state === "missing-token"
            ? setRow("Bot che ascolta", "Nessun bot ascolta. Cora usa il bot di un agente che può leggere i messaggi:",
              steps(h("span", {}, "apri ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "discord.com/developers"), " e scegli l'app di un agente (es. Primo);"), "sezione Bot → Privileged Gateway Intents → accendi «Message Content Intent» → Save;", "entro un minuto Cora lo usa per ascoltare."), { stack: true })
            : setRow("Bot che ascolta", h("span", {}, tr("Stato: {state}", { state: tr(STATE_LABEL[discord.state] || discord.state) }), discord.error ? raw(` (${discord.error})`) : "")))),
    panel({ icon: "radio", title: "Ascolto", hint: "I server accesi, e chi può far usare il computer agli agenti." },
      setRows(
        guildRow = setRow("Server", guilds.length ? "Gli altri server vengono ignorati." : "Discord non è collegato adesso: i server compaiono quando lo è.",
          guilds.length ? switchList(guilds.map((guild) => ({ id: guild.id, name: guild.name, sub: guild.id, mono: true })), settings.guildIds, "guildIds", () => guildRow) : null, { stack: true }),
        ownersRow("ownerIds", "ID utente Discord, separati da virgole. Solo loro possono far usare il computer agli agenti; vuoto = tutti."))));

  const telegram = S.data.telegram;
  let chatRow;
  page("telegram",
    panel({ icon: "send", title: "Telegram", hint: "Un bot principale ascolta le chat accese; ogni agente può avere anche un bot suo.", actions: channelBadge("telegram") },
      setRows(listenRow("telegram"),
        setRow("Bot",
          telegram.user ? h("span", {}, h("b", {}, raw(`@${telegram.user.username}`)), raw(` · ${tr(STATE_LABEL[telegram.state] || telegram.state)}${telegram.error ? ` (${telegram.error})` : ""}`))
            : telegram.state === "idle" || telegram.state === "stopped" ? "Il token c'è: il bot si collega quando accendi Telegram."
              : telegram.state === "error" ? tr("Il token non funziona: {error}.", { error: telegram.error })
                : S.data.agents.some((agent) => agent.telegramBot?.user) ? "Facoltativo: senza, ascoltano i bot degli agenti, nelle loro chat private e nei gruppi in cui sono." : "Serve un bot che ascolti.",
          h("div", { class: "stack-sm" },
            telegram.user || telegram.state === "idle" || telegram.state === "stopped" ? null : steps(
              h("span", {}, "apri ", h("a", { href: "https://t.me/BotFather", target: "_blank", rel: "noopener" }, "@BotFather"), " e scrivi /newbot (es. «Cora»);"),
              "sempre in BotFather: /setprivacy → il bot → Disable, così sente tutto il gruppo;",
              "incolla qui il token: lo controllo e lo salvo in hush;",
              "aggiungi il bot al gruppo e accendi la chat qui sotto."),
            tokenForm({ placeholder: telegram.user ? "Nuovo token (solo per cambiarlo)" : "Token di BotFather (123456:ABC…)", path: "/api/telegram/token", ok: "Bot Telegram collegato" })), { stack: true }))),
    panel({ icon: "radio", title: "Ascolto", hint: "Le chat accese, e chi può far usare il computer agli agenti." },
      setRows(
        chatRow = setRow("Chat", telegram.chats.length ? "Le chat spente vengono ignorate." : "Aggiungi il bot a un gruppo (o scrivigli in privato): la chat compare qui e la accendi.",
          telegram.chats.length ? switchList(telegram.chats.map((chat) => ({ id: chat.id, name: chat.title, sub: `${tr(chat.type === "private" ? "chat privata" : chat.type === "channel" ? "canale" : "gruppo")}${chat.member === false ? tr(" · il bot non c'è più") : ""}` })), settings.telegramChatIds, "telegramChatIds", () => chatRow) : null, { stack: true }),
        ownersRow("telegramOwnerIds", "ID utente Telegram. Se è vuoto diventa proprietario chi ha creato il gruppo, o chi scrive al bot in privato."))));

  const slack = S.data.slack || { state: "missing-token", channels: [], error: "" };
  const refreshChannels = btn("Aggiorna canali", { icon: "refresh", cls: "sm ghost", onclick: async () => {
    refreshChannels.disabled = true;
    const fresh = await guard(api("/api/slack/channels"), "Canali aggiornati");
    refreshChannels.disabled = false;
    if (!fresh) return;
    if (S.data?.slack) S.data.slack.channels = fresh;
    await loadState();
    renderSettings();
  } });
  let slackRow;
  page("slack",
    panel({ icon: "slack", title: "Slack", hint: "Un'app per ogni agente, così è un utente vero: la menzioni e le scrivi in privato.", actions: channelBadge("slack") },
      setRows(listenRow("slack"),
        setRow("App principale",
          slack.user ? h("span", {}, h("b", {}, raw(`@${slack.user.username}`)), raw(`${slack.team ? ` · ${slack.team.name}` : ""} · ${tr(STATE_LABEL[slack.state] || slack.state)}${slack.error ? ` (${slack.error})` : ""}`))
            : slack.state === "idle" || slack.state === "stopped" ? "I token ci sono: l'app si collega quando accendi Slack."
              : slack.state === "error" ? tr("I token non funzionano: {error}.", { error: slack.error }) : "Serve l'app principale: tiene l'elenco dei canali e scrive gli avvisi.",
          h("div", { class: "stack-sm" },
            slack.user || slack.state === "idle" || slack.state === "stopped" ? null : steps(
              h("span", {}, "apri ", h("a", { href: "https://api.slack.com/apps?new_app=1", target: "_blank", rel: "noopener" }, "api.slack.com/apps"), " → From a manifest, e scegli il workspace;"),
              h("span", {}, "Install to Workspace, poi copia il ", h("b", {}, "Bot User OAuth Token"), " (xoxb-);"),
              h("span", {}, "in Basic Information → App-Level Tokens crea un token con ", h("code", {}, "connections:write"), " e copia l'xapp-;"),
              "incolla qui i due token: li controllo e li salvo in hush."),
            slackTokenForm({ path: "/api/slack/token", ok: "App Slack collegata" })), { stack: true }))),
    panel({ icon: "radio", title: "Ascolto", hint: "I canali accesi, e chi può far usare il computer agli agenti.", actions: refreshChannels },
      setRows(
        slackRow = setRow("Canali", slack.channels?.length ? "Un canale in cui entra un'app parte acceso; resta spento solo quello che spegni." : "Invita un'app in un canale: compare qui, già acceso.",
          slack.channels?.length ? switchList(slack.channels.map((channel) => ({ id: channel.id, name: `#${channel.name}`, sub: tr(channel.private ? "canale privato" : "canale pubblico") })), settings.slackChannelIds, "slackChannelIds", () => slackRow) : null, { stack: true }),
        ownersRow("slackOwnerIds", "ID utente Slack. Se è vuoto diventa proprietario chi possiede il workspace, appena scrive."))),
    panel({ icon: "user", title: "Aspetto delle app", hint: "Nome, descrizione e immagine di ogni app seguono il pannello." }, slackAppsField()));

  /* ---------- Abbonamenti e chiavi ---------- */
  const providers = SUBSCRIPTION_HARNESSES.filter((provider) => ["claude", "codex", "gemini"].includes(provider) || S.data.providers?.[provider] || S.data.subscriptions?.some((item) => item.provider === provider));
  const residentToggle = switchInput("useResidentSubscriptions", "", S.data.settings.useResidentSubscriptions);
  const toggle = residentToggle.querySelector("input");
  const residentToggleRow = setRow("Usa gli account del server", "Gli agenti che non scelgono un account usano quelli già presenti sulla macchina che ospita Cora.", residentToggle);
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    if (await saveSettings({ useResidentSubscriptions: toggle.checked }, residentToggleRow)) {
      await loadState();
      renderSettings();
    } else { toggle.checked = !toggle.checked; toggle.disabled = false; }
  });
  const residentRow = (provider, onclick = null) => {
    const record = S.data.subscriptions?.find((item) => item.resident && item.provider === provider);
    const connected = record?.status === "ready";
    return h(onclick ? "button" : "div", { class: `resident-account${onclick ? " link" : ""}`, type: onclick ? "button" : null, onclick },
      h("span", { class: "subscription-mark", "aria-hidden": "true" }, icon(SUBSCRIPTION_ICONS[provider])),
      h("div", { class: "grow" }, h("b", {}, raw(SUBSCRIPTION_NAMES[provider])),
        h("span", { class: "resident-email" }, connected ? raw(record.email || tr("Account rilevato"))
          : !S.data.providers?.[provider] ? tr("{cli} non installato su questa macchina", { cli: CLI_NAMES[provider] })
            : record?.status === "error" ? "Verifica non riuscita" : "Nessun account rilevato"),
        connected && record.plan ? h("small", {}, raw(subscriptionPlanLabel(record.plan))) : null),
      h("span", { class: `subscription-status ${connected ? "ready" : "disconnected"}` }, h("i", { "aria-hidden": "true" }), connected ? "Disponibile" : "Da collegare"));
  };
  const residentList = h("div", { class: "resident-accounts" });
  const residentSlots = new Map(providers.map((provider) => [provider, h("div", {})]));
  const drawResidents = () => {
    residentList.replaceChildren(...providers.filter((provider) => provider !== "gemini").map((provider) => residentRow(provider, () => show(provider))));
    for (const [provider, slot] of residentSlots) if (provider !== "gemini") slot.replaceChildren(residentRow(provider));
    drawNav();
  };
  const scan = btn("Rileva account", { icon: "refresh", cls: "ghost", onclick: async () => {
    scan.disabled = true;
    const result = await guard(api("/api/subscriptions/resident/check", { method: "POST" }));
    if (result) {
      S.data.subscriptions = await api("/api/subscriptions");
      drawResidents();
    }
    scan.disabled = false;
  } });
  page("server",
    panel({ icon: "monitor", title: "Account del server", hint: "Gli account trovati sulla macchina che ospita Cora. Tocca un account per collegarne altri.", actions: scan },
      setRows(residentToggleRow), residentList),
    h("p", { class: "set-note" }, icon("info"), h("span", {}, "Le chiavi vengono salvate in hush e non sono più mostrate dopo il salvataggio. Valgono per tutti gli agenti di questa istanza.")));
  for (const provider of providers) {
    const accountStatus = h("span", {});
    const drawAccountStatus = () => {
      const [led, line] = providerState(provider);
      accountStatus.replaceChildren(badge(raw(line), led === "on" ? "on" : led === "busy" ? "warn" : "", led === "on" ? "check" : "user"));
      drawNav();
    };
    page(provider,
      panel({ icon: SUBSCRIPTION_ICONS[provider], title: SUBSCRIPTION_NAMES[provider], hint: tr("Lo usa {cli}, per gli agenti che lo scelgono nel loro Cervello.", { cli: CLI_NAMES[provider] }), actions: accountStatus },
        provider === "gemini" ? h("p", { class: "muted" }, "Collega il tuo account Google AI Pro o Ultra. Gli agenti usano l'abbonamento, con le sue quote, senza una chiave API.")
          : h("div", { class: "set-section" }, h("span", { class: "label" }, "Su questo server"), residentSlots.get(provider)),
        h("div", { class: "set-section" }, h("span", { class: "label" }, provider === "gemini" ? "Account" : "Altri account"),
          h("p", { class: "muted" }, "Collegane quanti vuoi, dal browser: nel Cervello di ogni agente scegli quale usa."),
          subscriptionAccounts(provider, { onChange: drawAccountStatus }))));
  }
  // doc runs on this machine or it does not: the page says which, and proves it on demand.
  const docStatus = () => {
    const doc = S.data.doc || {};
    const intro = h("p", {}, "La usa doc per controllare quello che gli agenti scrivono in chat e pubblicano, con Jev di TypeSafe. Senza chiave restano solo le regole esatte.");
    if (!doc.installed) return h("div", { class: "stack-sm" }, intro, h("p", { class: "muted" }, "doc non è installato su questa macchina: per ora non controlla niente."));
    const result = h("p", { class: "muted", role: "status" });
    const probe = btn("Verifica adesso", { icon: "shield", onclick: async () => {
      probe.disabled = true;
      result.textContent = tr("Verifico…");
      const outcome = await guard(api("/api/doc/probe", { method: "POST" }));
      probe.disabled = false;
      if (!outcome) { result.textContent = ""; return; }
      result.textContent = tr(outcome.runs && outcome.jev ? "doc risponde e Jev di TypeSafe giudica: è operativo."
        : outcome.runs ? S.data.keys?.typesafe ? "doc risponde, ma Jev non ha giudicato: controlla la chiave." : "doc risponde con le regole esatte. Per i giudizi di Jev serve la chiave."
          : "doc non ha risposto su questa macchina.");
    } });
    return h("div", { class: "stack-sm" }, intro,
      h("p", { class: "muted" }, tr("doc è attivo: {checks} controlli nelle ultime 24 ore, {stopped} fermati.", { checks: doc.checks || 0, stopped: doc.stopped || 0 })),
      h("div", { class: "row" }, probe), result);
  };
  const keyPage = (provider, name, mark) => {
    const configured = Boolean(S.data.keys?.[provider]);
    const key = h("input", { type: "password", autocomplete: "new-password", autocapitalize: "off", spellcheck: "false", "aria-label": tr("Chiave API {provider}", { provider: name }), placeholder: configured ? "Incolla una nuova chiave per sostituirla" : "Incolla la chiave API" });
    // The page says what the list says: a key, a local Ollama or a missing program, not only "is there a key".
    const badgeFor = ([led, line]) => [raw(line), led === "on" ? "on" : led === "warn" ? "warn" : "", led === "on" ? "check" : led === "warn" ? "alert" : "key"];
    const status = badge(...badgeFor(keyState(provider)));
    const save = btn(configured ? "Aggiorna chiave" : "Salva chiave", { icon: "check", cls: "primary", onclick: async () => {
      if (!key.value.trim()) { key.focus(); return; }
      save.disabled = true;
      const value = key.value;
      key.value = "";
      const result = await guard(api(`/api/providers/${provider}/key`, { method: "PUT", body: { key: value } }), "Chiave salvata");
      if (result) {
        if (provider === "deepseek") S.data.providers.deepseek = Boolean(S.data.providers.deepseekInstalled);
        else if (provider !== "typesafe" && provider !== "soniox") S.data.providers[provider] = true;
        S.data.keys = { ...S.data.keys, [provider]: true };
        drawNav();
        const [text, cls, icon_] = badgeFor(keyState(provider));
        status.replaceChildren(icon(icon_), text);
        status.className = `badge${cls ? ` ${cls}` : ""}`;
        key.placeholder = tr("Incolla una nuova chiave per sostituirla");
        save.lastChild.textContent = tr("Aggiorna chiave");
      }
      save.disabled = false;
    } });
    key.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); save.click(); } });
    const cloud = S.data.ollamaCloud || {};
    const about = provider === "typesafe" ? docStatus()
      : provider === "soniox" ? h("p", {}, "Gli agenti ascoltano i messaggi vocali e rispondono con una voce loro. La voce si sceglie in Impostazioni → Voce dell'agente.")
        : provider === "deepseek" ? h("p", {}, S.data.providers?.deepseekInstalled ? "La usa DeepSeek Harness, per gli agenti che scelgono quell'harness nel loro Cervello." : "La usa DeepSeek Harness, che su questa macchina non è ancora installato.")
          : provider !== "ollama" ? h("p", {}, "La chiave vale per tutti gli agenti di questa istanza.")
            : h("div", { class: "stack-sm" },
              h("p", {}, "Serve solo per i modelli di Ollama Cloud. L'Ollama di questa macchina non ne ha bisogno."),
              configured ? null
                : cloud.signedIn ? h("p", { class: "muted" }, "Non serve: questa macchina è già collegata a Ollama Cloud.")
                  : h("p", { class: "muted" }, "In alternativa alla chiave, collega questa macchina al tuo account Ollama.",
                    cloud.signinUrl ? [" ", h("a", { href: cloud.signinUrl, target: "_blank", rel: "noopener" }, tr("Collega questa macchina"))] : null));
    page(provider, panel({ icon: mark, title: name, actions: status }, h("div", { class: "provider-key" }, about),
      setRows(setRow("Chiave API", "Salvata in hush, non si rivede più.", h("div", { class: "input-row" }, key, save), { stack: true }))));
  };
  for (const [provider, name, mark] of CONNECTION_KEYS) keyPage(provider, name, mark);

  /* ---------- Agenti ---------- */
  const numberRow = (key, label, hint, min, max) => {
    const input = h("input", { type: "number", class: "num", min, max, value: settings[key], inputmode: "numeric", "aria-label": tr(label) });
    const row = setRow(label, hint, input);
    input.addEventListener("change", async () => {
      if (await saveSettings({ [key]: Number(input.value) }, row)) input.value = S.data.settings[key];
      drawNav();
    });
    return row;
  };
  const goal = switchInput("goalMode", "", settings.goalMode);
  const goalRow = setRow("Obiettivi", "Ogni compito riceve un obiettivo, cioè cosa deve essere vero perché sia finito, e un altro modello controlla che lo sia davvero. Nel Ragionamento i turni si raggruppano per obiettivo.", goal);
  goal.querySelector("input").addEventListener("change", async (event) => {
    if (!(await saveSettings({ goalMode: event.target.checked }, goalRow))) event.target.checked = !event.target.checked;
    drawNav();
  });
  page("regia", panel({ icon: "sliders", title: "Regia", hint: "Quanto possono parlarsi tra loro prima di fermarsi ad aspettare un umano." },
    setRows(
      numberRow("maxAgentTurns", "Messaggi tra agenti", "Quanti messaggi si scambiano dopo ogni messaggio umano, prima di fermarsi.", 0, 40),
      numberRow("maxRepliesPerRound", "Risposte per giro", "Quanti agenti parlano insieme.", 1, 6),
      numberRow("historySize", "Messaggi di contesto", "Quanta chat rileggono prima di rispondere.", 5, 100),
      goalRow)));

  const model = modelPicker("defaultModel", settings.defaultModel, { allowDefault: false });
  const modelNote = () => {
    const known = S.data.models.find((item) => item.id === S.data.settings.defaultModel);
    const reason = !S.data.settings.defaultModel ? "" : !known ? tr(MISSING_MODEL) : known.usable === false ? tr(known.reason || "non disponibile") : "";
    return reason ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(tr("{model} non risponde su questa macchina ({reason}). Gli agenti senza un modello loro, gli obiettivi e le verifiche lo usano: scegline uno che gira qui.", { model: known?.label || S.data.settings.defaultModel, reason })))) : null;
  };
  const modelWarning = h("div", {}, modelNote());
  const modelRow = setRow("Modello predefinito", "Lo usano gli agenti senza un modello loro, e il lavoro di fondo: obiettivi, verifiche, sonno.", h("div", { class: "stack-sm" }, model, modelWarning), { stack: true });
  const saveModel = async () => {
    const value = model.querySelector("input").value.trim() || model.querySelector("select").value;
    if (!value || value === S.data.settings.defaultModel) return;
    await saveSettings({ defaultModel: value }, modelRow);
    modelWarning.replaceChildren(...[modelNote()].filter(Boolean));
    drawNav();
  };
  model.addEventListener("change", saveModel);
  const hour = h("select", { "aria-label": tr("Ora del sonno") }, Array.from({ length: 24 }, (_, index) => h("option", { value: index, selected: index === settings.sleepHour }, raw(`${String(index).padStart(2, "0")}:00`))));
  const hourRow = setRow("Ora del sonno", "Ogni notte a quest'ora riordinano la memoria.", hour);
  hour.addEventListener("change", () => saveSettings({ sleepHour: Number(hour.value) }, hourRow));
  const providerBadges = h("div", { class: "badges" }, CONNECTIONS.map(([key, label]) => {
    const on = S.data.providers?.[key];
    return h("span", { class: `badge${on ? " on" : ""}`, title: on ? "" : PROVIDER_HINTS[key] }, icon(on ? "check" : "close"), tr(label));
  }));
  page("modelli", panel({ icon: "chip", title: "Modelli e sonno", hint: "Il modello di chi non ne sceglie uno, e l'ora in cui riordinano la memoria." },
    setRows(modelRow, hourRow, setRow("Cosa gira qui", "Gli harness e i provider che questa macchina può usare adesso.", providerBadges, { stack: true }))));

  // Where the agents' own GitHub Apps are made.
  const githubOrg = h("input", { type: "text", class: "mono", value: settings.githubOrg || "", placeholder: tr("nome-organizzazione"), autocomplete: "off", spellcheck: "false", "aria-label": tr("Organizzazione GitHub"), disabled: !manage });
  const githubRow = setRow("Organizzazione", "Il nome dell'organizzazione GitHub dove nascono le app degli agenti, come appare in github.com/nome. Vuoto: nel tuo account. Si salva quando esci dal campo.", githubOrg);
  githubOrg.addEventListener("change", () => saveSettings({ githubOrg: githubOrg.value.trim() }, githubRow).then(() => { githubOrg.value = S.data.settings.githubOrg || ""; drawNav(); }));
  page("github", panel({ icon: "github", title: "GitHub", hint: "Ogni agente può avere la sua app GitHub: si crea dalla sua pagina, Impostazioni → GitHub, con due clic su GitHub." }, setRows(githubRow)));
  page("domini", mailDomainsPane());

  /* ---------- Persone ---------- */
  page("accesso", instanceAccessPanel());
  const keys = h("textarea", { class: "mono", placeholder: "ssh-ed25519 AAAA… telefono", "aria-label": tr("Chiavi SSH"), disabled: !manage }, settings.sshKeys.join("\n"));
  const keysRow = setRow("Altre chiavi", "Una per riga. Valgono già le chiavi che entrano nella macchina host: qui aggiungi le altre. Si salvano quando esci dal campo.", keys, { stack: true });
  keys.addEventListener("change", () => saveSettings({ sshKeys: keys.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }, keysRow).then(drawNav));
  page("ssh", panel({ icon: "key", title: "Chiavi SSH", hint: "Chi entra nei desktop degli agenti via SSH, passando dalla macchina host." }, setRows(keysRow)));

  /* ---------- Generale ---------- */
  if (S.data.artifacts?.space) page("spazio", artifactSpacePanel());
  page("controlli", docChecksPane());
  page("preferenze", languagePanel(), notificationsPanel());

  /* ---------- the list ---------- */
  const doc = S.data.doc || {};
  const keyCount = settings.sshKeys.length;
  entries = [
    { id: "contesto", group: "Contesto", label: "Contesto degli agenti", mark: "book", href: "#/contesto", state: () => [null, tr("istruzioni e file che tutti leggono")] },
    ...["discord", "telegram", "slack"].map((kind) => ({ id: kind, group: "Canali", label: TRANSPORTS[kind].label, mark: TRANSPORTS[kind].icon, state: () => channelState(kind) })),
    { id: "email", group: "Canali", label: "E-mail", mark: "mail", state: () => [null, tr("Ricezione e regole")] },
    { id: "connettori", group: "Connettori", label: "Connettori", mark: "link", state: () => [null, tr("Google e account esterni")] },
    { id: "mcp", group: "Connettori", label: "Agenti esterni (MCP)", mark: "terminal", state: () => [null, tr("Configura Cora da un altro agente")] },
    { id: "server", group: "Abbonamenti", label: "Account del server", mark: "monitor", state: () => [null, settings.useResidentSubscriptions ? tr("in uso per chi non sceglie") : tr("non usati")] },
    ...providers.map((provider) => ({ id: provider, group: "Abbonamenti", label: SUBSCRIPTION_NAMES[provider], mark: SUBSCRIPTION_ICONS[provider], state: () => providerState(provider) })),
    ...CONNECTION_KEYS.map(([provider, name, mark]) => ({ id: provider, group: "Chiavi API", label: name, mark, state: () => keyState(provider) })),
    { id: "regia", group: "Agenti", label: "Regia", mark: "sliders", state: () => [null, tr("{turns} messaggi · obiettivi {goals}", { turns: S.data.settings.maxAgentTurns, goals: tr(S.data.settings.goalMode ? "accesi" : "spenti") })] },
    { id: "modelli", group: "Agenti", label: "Modelli e sonno", mark: "chip", state: () => {
      const known = S.data.models.find((item) => item.id === S.data.settings.defaultModel);
      return [known && known.usable !== false ? null : "warn", S.data.settings.defaultModel || tr("nessun modello")];
    } },
    { id: "github", group: "Agenti", label: "GitHub", mark: "github", state: () => [null, S.data.settings.githubOrg || tr("le app nel tuo account")] },
    { id: "domini", group: "Agenti", label: "Domini", mark: "globe", state: () => [null, tr("Account Resend e domini email")] },
    { id: "accesso", group: "Persone", label: "Accesso", mark: "shield", state: () => [null, tr("chi entra nella tua Cora")] },
    { id: "ssh", group: "Persone", label: "Chiavi SSH", mark: "key", state: () => [null, keyCount ? (keyCount === 1 ? tr("1 chiave in più") : tr("{count} chiavi in più", { count: keyCount })) : tr("solo quelle dell'host")] },
    ...(S.data.artifacts?.space ? [{ id: "spazio", group: "Generale", label: "Spazio", mark: "layers", state: () => {
      const space = S.data.artifacts.space;
      return [space.used > space.limit * 0.9 ? "warn" : null, tr("{used} di {limit} per gli artefatti", { used: fmtBytes(space.used), limit: fmtBytes(space.limit) })];
    } }] : []),
    { id: "controlli", group: "Generale", label: "Controlli di doc", mark: "shield", state: () => [doc.installed ? "on" : "off", doc.installed ? tr("doc attivo") : tr("doc non installato")] },
    { id: "preferenze", group: "Generale", label: "Lingua e notifiche", mark: "globe", state: () => [null, LANGS[LANG]] },
  ];
  function drawNav() {
    const items = [];
    let group = null;
    for (const entry of entries) {
      if (entry.group !== group) {
        group = entry.group;
        items.push(h("span", { class: "rail-group" }, group));
      }
      const [led, line] = entry.state();
      const active = entry.id === (current || fallback());
      items.push(h("button", { type: "button", class: `rail-item${active ? " active" : ""}`, "aria-current": active ? "page" : null, "data-page": entry.id, onclick: () => (entry.href ? (location.hash = entry.href) : show(entry.id)) },
        h("span", { class: "rail-mark", "aria-hidden": "true" }, icon(entry.mark)),
        h("span", { class: "rail-name" }, h("b", {}, raw(tr(entry.label))), h("small", {}, raw(line))),
        led ? h("i", { class: `led ${led}`, "aria-hidden": "true" }) : h("i", { class: "led none", "aria-hidden": "true" }), icon("next", "rail-go")));
    }
    list.replaceChildren(...items);
    requestAnimationFrame(() => list.querySelector(".rail-item.active")?.scrollIntoView?.({ block: "nearest" }));
  }
  const slots = new Map([...pages].map(([id, content]) => [id, h("div", { class: "rail-page", "data-page": id, hidden: true }, content)]));
  const detail = h("div", { class: "rail-detail" }, [...slots.values()]);
  const root = h("div", { class: "rail" }, nav, detail);
  // An empty id is the list alone (phones); on a desktop the list always has a page next to it.
  function show(id, { updateRoute = true } = {}) {
    current = pages.has(id) ? id : "";
    for (const [entry, slot] of slots) slot.hidden = entry !== (current || fallback());
    detail.scrollTop = 0;
    root.classList.toggle("open", Boolean(current));
    drawNav();
    if (updateRoute) history.replaceState(null, "", current ? `#/settings/${current}` : "#/settings");
    if (updateRoute && current === "connettori") pages.get(current).querySelector(".connectors-pane")?.openCatalog?.();
  }
  // The addresses before the list: a tab, or Collegamenti and one of its entries.
  const [, first = "", second = ""] = route();
  const legacy = { collegamenti: second && second !== "panoramica" ? second : "server", canali: S.data.transport, agenti: "regia" };
  drawResidents();
  show(legacy[first] || first, { updateRoute: false });
  shell([pageHead("Impostazioni", "Canali, account e preferenze della tua Cora."), root], { title: "Impostazioni", mode: "rail" });
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
  S.quotaPanel = null;
  S.quotaAccount = null;
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

const THREAD_STATUS = {
  active: "In corso",
  done: "Conclusa",
  error: "Errore",
  stopped: "Fermata",
  killed: "Chiusa al riavvio",
  interrupted: "Interrotta",
};

function threadWhen(iso) {
  if (!iso) return "";
  return fmtTime(iso, true);
}

function threadFlow(flow) {
  const live = flow.status === "active";
  const reasoning = flow.reasoning || "";
  return h("article", { class: "thread-flow" },
    avatar({ id: flow.agentId, name: flow.agentName, color: flow.color }, "xs"),
    h("div", { class: "thread-flow-body" },
      h("div", { class: "thread-flow-line" },
        h("b", {}, raw(flow.agentName)),
        h("i", { class: `led${live ? " on" : flow.status === "error" ? " warn" : ""}`, title: tr(THREAD_STATUS[flow.status] || flow.status) }),
        h("span", { class: "thread-meta" }, tr(THREAD_STATUS[flow.status] || flow.status)),
        (Number(flow.tokensIn || 0) || Number(flow.tokensOut || 0)) ? h("span", { class: "thread-meta" }, raw(`${Number(flow.tokensIn || 0).toLocaleString(LOCALE)} → ${Number(flow.tokensOut || 0).toLocaleString(LOCALE)}`)) : null),
      reasoning ? h("p", { class: "thread-reason" }, raw(reasoning)) : null,
      flow.error && flow.status === "error" ? h("p", { class: "thread-error" }, raw(flow.error)) : null,
      h("p", { class: "thread-meta" }, raw([threadWhen(flow.startedAt), flow.endedAt ? threadWhen(flow.endedAt) : ""].filter(Boolean).join(" · ")))),
    h("div", { class: "thread-flow-actions" },
      flow.traceId ? btn("", { icon: "bulb", cls: "sm", title: "Ragionamento", href: `#/agent/${flow.agentId}/ragionamento/${flow.traceId}` }) : null,
      live && (flow.canStop || S.data?.currentUser?.role === "owner") ? btn("Ferma", { icon: "stop", cls: "sm danger", onclick: () => guard(api("/api/threads/stop", { method: "POST", body: { id: flow.channelId, agentId: flow.agentId } }), "Sessione fermata").then(threadsRefresh) }) : null));
}

function threadHref(id) {
  return `#/thread/t/${encodeURIComponent(id)}`;
}

function threadPlace(thread) {
  const where = thread.kind === "slack" ? "Slack" : thread.kind === "web" ? tr("Pannello") : thread.kind === "telegram" ? "Telegram" : "Discord";
  if (!thread.thread) return `${where} · ${tr("canale")}`;
  return thread.parentName ? `${where} · #${thread.parentName}` : where;
}

/** The open Thread view refreshes in place; only when it is gone is the page drawn again. */
function threadsRefresh() {
  if (S.threadsRefresh?.()) return;
  renderThreads();
}

/** A signature of what a thread shows: the heartbeat changes every few seconds and shows nothing. */
function threadSig(value) {
  return JSON.stringify(value, (key, item) => key === "heartbeatAt" ? undefined : item);
}

/** A node someone is using: typing in it, a name edited and not saved, a control with the focus. */
function threadBusy(node) {
  if (node.contains(document.activeElement) && document.activeElement !== document.body) return true;
  return [...node.querySelectorAll("input.thread-name")].some((input) => input.value !== input.dataset.name);
}

/** Puts the keyed nodes in order and builds again only those whose data changed and nobody is using. */
function keyedChildren(container, items, keep = threadBusy) {
  const old = new Map([...container.children].filter((node) => node.dataset.key).map((node) => [node.dataset.key, node]));
  const nodes = items.map(({ key, sig, build }) => {
    const node = old.get(key);
    if (node && (node.dataset.sig === sig || keep(node))) return node;
    const fresh = build(node);
    fresh.dataset.key = key;
    fresh.dataset.sig = sig;
    return fresh;
  });
  const wanted = new Set(nodes);
  for (const node of [...container.children]) if (!wanted.has(node)) node.remove();
  nodes.forEach((node, index) => { if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); });
}

function threadCard(thread, { history = false } = {}) {
  const flows = history ? thread.flows.filter((flow) => flow.status !== "active") : thread.flows.filter((flow) => flow.status === "active");
  if (!flows.length && history) return null;
  if (!flows.length && !history && !(thread.thread && thread.open)) return null;
  const manage = S.data?.currentUser?.role === "owner" || S.data?.access?.canManage;
  const name = h("input", { type: "text", class: "thread-name", value: thread.name, "data-name": thread.name, "aria-label": tr("Nome del thread"), disabled: !manage });
  return h("article", { class: `thread-card${thread.closed ? " closed" : ""}` },
    h("header", {},
      h("span", { class: "panel-ico" }, icon(thread.kind === "slack" ? "slack" : "hash")),
      h("a", { class: "grow thread-open", href: threadHref(thread.id) },
        h("b", { class: /^\d{8,}$/.test(thread.name) ? "thread-id" : "" }, raw(thread.name)),
        h("p", { class: "thread-meta" }, raw(threadPlace(thread)))),
      thread.link ? btn("", { icon: "external", cls: "sm ghost", href: thread.link, target: "_blank", title: thread.kind === "slack" ? "Apri su Slack" : "Apri su Discord" }) : null,
      btn("", { icon: "next", cls: "sm ghost", href: threadHref(thread.id), title: "Tutto il ragionamento" })),
    flows.length
      ? h("div", { class: "thread-flows" }, flows.map((flow) => threadFlow({ ...flow, channelId: thread.id })))
      : h("p", { class: "thread-meta" }, tr("Nessuna sessione attiva")),
    manage && thread.thread ? h("div", { class: "thread-manage" },
      name,
      btn("Rinomina", { cls: "sm", onclick: () => guard(api("/api/threads/rename", { method: "POST", body: { id: thread.id, name: name.value } }), "Nome aggiornato").then((done) => { if (done) name.dataset.name = name.value; threadsRefresh(); }) }),
      !history && thread.thread ? btn("Chiudi", { icon: "stop", cls: "sm", onclick: () => guard(api("/api/threads/close", { method: "POST", body: { id: thread.id } }), "Thread chiuso").then(threadsRefresh) }) : null) : null);
}

async function renderThreads() {
  const view = route()[1] || "";
  if (view === "t" && route()[2]) return renderThreadPage(decodeURIComponent(route()[2]));
  const section = view === "storico" || view === "attivi" ? view : "";
  const ticket = S.threadsTicket = (S.threadsTicket || 0) + 1;
  const listing = () => route()[0] === "thread" && route()[1] !== "t" && S.threadsTicket === ticket;
  let board = { threads: [], parents: [] };
  let failed = "";
  try { board = await api("/api/threads"); }
  catch (error) { failed = error.message; }
  // A click elsewhere while the list was loading wins: an old answer never covers the page just opened.
  if (!listing()) return;
  const manage = S.data?.currentUser?.role === "owner" || S.data?.access?.canManage;
  const parentSelect = h("select", { "aria-label": tr("Canale") });
  const nameInput = h("input", { type: "text", placeholder: tr("Nome del thread"), "aria-label": tr("Nome del thread"), maxlength: "100" });
  const createForm = h("form", { class: "thread-create", onsubmit: (event) => {
    event.preventDefault();
    const parentId = parentSelect.value;
    const name = nameInput.value.trim();
    if (!parentId || !name) return;
    guard(api("/api/threads", { method: "POST", body: { parentId, name } }), "Thread aperto").then((made) => { if (made) nameInput.value = ""; threadsRefresh(); });
  } },
  field("Canale", parentSelect),
  field("Nome", nameInput),
  btn("Crea", { icon: "plus", cls: "primary", type: "submit" }));
  const noParents = h("p", { class: "thread-meta" }, "Nessun canale Discord o Slack acceso.");
  const createBody = h("div", {});
  const create = manage ? panel({ icon: "plus", title: "Nuovo thread", hint: "Si apre sul canale e resta abbinato 1:1." }, createBody) : null;
  const liveList = h("div", { class: "thread-list" });
  const pastList = h("div", { class: "thread-list" });
  const liveEmpty = empty("hash", "Nessun thread attivo.");
  const pastEmpty = empty("clock", "Nessuna sessione passata.");
  const banner = h("div", {});
  let parentsSig = "";
  let boardSig = "";
  const draw = (next, error) => {
    banner.replaceChildren(...(error ? [h("p", { class: "banner err" }, raw(error))] : []));
    if (error) return;
    const parents = next.parents || [];
    const nextParents = JSON.stringify(parents);
    if (nextParents !== parentsSig && document.activeElement !== parentSelect) {
      const chosen = parentSelect.value;
      parentSelect.replaceChildren(...parents.map((parent) => h("option", { value: parent.id, selected: parent.id === chosen }, raw(`${parent.kind === "slack" ? "Slack" : "Discord"} · ${parent.name}`))));
      createBody.replaceChildren(parents.length ? createForm : noParents);
      parentsSig = nextParents;
    }
    const nextBoard = threadSig(next.threads || []);
    if (nextBoard === boardSig) return;
    boardSig = nextBoard;
    const cards = (history) => (next.threads || []).map((thread) => {
      const card = threadCard(thread, { history });
      return card ? { key: thread.id, sig: threadSig([thread, history, manage]), build: () => threadCard(thread, { history }) } : null;
    }).filter(Boolean);
    const live = cards(false);
    const past = cards(true);
    keyedChildren(liveList, live);
    keyedChildren(pastList, past);
    liveList.hidden = !live.length;
    pastList.hidden = !past.length;
    liveEmpty.hidden = Boolean(live.length);
    pastEmpty.hidden = Boolean(past.length);
  };
  const entries = [
    ["attivi", "Attivi", "hash", "Chi sta lavorando adesso", [create, liveList, liveEmpty].filter(Boolean)],
    ["storico", "Storico", "clock", "Sessioni già chiuse", [pastList, pastEmpty]],
  ];
  const workspace = sectionWorkspace({ title: "Thread", base: "#/thread", current: section, entries });
  draw(board, failed);
  shell([
    pageHead("Thread", "Una sessione per agente, legata al thread Discord o Slack."),
    banner,
    workspace,
  ], { title: "Thread" });
  let loading = false;
  const refresh = async () => {
    if (loading || !liveList.isConnected || !listing()) return;
    loading = true;
    try { draw(await api("/api/threads"), ""); }
    catch (error) { if (liveList.isConnected) draw(null, error.message); }
    finally { loading = false; }
  };
  S.threadsRefresh = () => {
    if (!liveList.isConnected || !listing()) return false;
    void refresh();
    return true;
  };
  S.timers.push(setInterval(() => { if (!document.hidden) void refresh(); }, 4000));
}

function threadTurn(trace, open) {
  const startedAt = Date.parse(trace.startedAt);
  const steps = h("div", { class: "steps-log" });
  let lastHidden = false;
  const addStep = (step) => {
    if (step.type === "thinking" && step.hidden && lastHidden) return;
    lastHidden = step.type === "thinking" && Boolean(step.hidden);
    steps.querySelector(".empty")?.remove();
    steps.prepend(stepEl(step, startedAt));
  };
  (trace.steps || []).forEach(addStep);
  if (!(trace.steps || []).length) steps.append(empty("info", trace.status === "running" ? "In attesa del primo passo…" : "Nessun passo intermedio: ha risposto direttamente."));
  const [label, cls] = TRACE_STATUS[trace.status] || [trace.status, ""];
  const answer = trace.status === "error"
    ? h("p", { class: "err-text" }, raw(trace.error || ""))
    : h("div", { class: "answer" }, trace.output ? raw(trace.output) : trace.status === "running" ? "…" : "(niente)");
  const tokens = Number(trace.tokensIn || 0) || Number(trace.tokensOut || 0)
    ? raw(tr("{in} in · {out} out", { in: shortTokens(trace.tokensIn || 0), out: shortTokens(trace.tokensOut || 0) })) : null;
  const card = h("details", { class: `thread-turn${trace.status === "running" ? " live" : ""}`, open: open || trace.status === "running", "data-agent": trace.agentId, "data-trace": trace.id },
    h("summary", {},
      avatar({ id: trace.agentId, name: trace.agentName, color: trace.color }, "xs"),
      h("span", { class: "thread-turn-who" },
        h("b", {}, raw(trace.agentName)),
        h("span", { class: "thread-meta" }, raw([tr(TRACE_KIND[trace.kind] || trace.kind), fmtTime(trace.startedAt, true), duration(trace), (trace.steps || []).length === 1 ? tr("1 passo") : tr("{count} passi", { count: (trace.steps || []).length })].join(" · ")))),
      h("span", { class: "badges" }, tag(label, cls), tokens ? h("span", { class: "thread-meta" }, tokens) : null),
      icon("next", "thread-turn-chev")),
    h("div", { class: "thread-turn-body" },
      h("h3", { class: "label" }, trace.status === "pass" ? "Risposta (ha deciso di passare)" : "Risposta"),
      answer,
      h("h3", { class: "label" }, "Passi, dal più recente"),
      steps,
      h("div", { class: "thread-turn-foot" },
        trace.model ? tag(modelLabel(trace.model, { short: true })) : null,
        btn("Contesto e istruzioni", { icon: "eye", cls: "sm ghost", href: `#/agent/${trace.agentId}/ragionamento/${trace.id}` }))));
  card.addStep = addStep;
  return card;
}

/** What a turn shows once it is over; while it runs its steps arrive live and do not redraw it. */
function turnSig(trace) {
  return JSON.stringify([trace.status, trace.output || "", trace.error || "", trace.tokensIn || 0, trace.tokensOut || 0, trace.endedAt || "", trace.status === "running" ? 0 : (trace.steps || []).length, trace.agentName, trace.model || ""]);
}

async function renderThreadPage(id) {
  const key = location.hash;
  let detail = null;
  let failed = "";
  try { detail = await api(`/api/threads/${encodeURIComponent(id)}`); }
  catch (error) { failed = error.message; }
  if (location.hash !== key) return;
  if (!detail) {
    shell([
      btn("Thread", { icon: "back", href: "#/thread", cls: "ghost sm back-link" }),
      panel({ icon: "alert", title: "Thread non trovato", hint: failed || "" }),
    ], { title: "Thread", back: "#/thread" });
    return;
  }
  const manage = S.data?.currentUser?.role === "owner" || S.data?.access?.canManage;
  let only = "";
  let traces = [];
  let thread = detail.thread;
  const list = h("div", { class: "thread-turns" });
  const listEmpty = empty("bulb", "Nessun turno in questo thread, per ora.");
  const chipsSlot = h("div", {});
  const sum = h("div", { class: "thread-sum" });
  const flowsSlot = h("div", {});
  const manageSlot = h("div", {});
  const title = h("h1", {});
  const place = h("p", {});
  const linkSlot = h("div", { class: "page-actions" });
  const toggleAll = btn("Apri tutti", { icon: "layers", cls: "sm ghost", onclick: (event) => {
    const cards = [...list.children].filter((card) => !card.hidden);
    const opening = cards.some((card) => !card.open);
    for (const card of cards) card.open = opening;
    event.currentTarget.querySelector("span").textContent = tr(opening ? "Chiudi tutti" : "Apri tutti");
  } });
  const reasoning = panel({ icon: "bulb", title: "Ragionamento", hint: "Ogni turno, dal più recente.", actions: toggleAll }, chipsSlot, list, listEmpty);
  const hint = reasoning.querySelector(".panel-title p");
  const sigs = { agents: "", flows: "", manage: "", head: "" };
  const draw = (next) => {
    thread = next.thread;
    traces = next.traces;
    const agents = [...new Map(traces.map((trace) => [trace.agentId, { id: trace.agentId, name: trace.agentName, color: trace.color }])).values()];
    const head = JSON.stringify([thread.name, threadPlace(thread), thread.link, thread.kind]);
    if (head !== sigs.head) {
      sigs.head = head;
      title.textContent = thread.name;
      place.textContent = threadPlace(thread);
      linkSlot.replaceChildren(...(thread.link ? [btn(thread.kind === "slack" ? "Apri su Slack" : "Apri su Discord", { icon: "external", cls: "ghost", href: thread.link, target: "_blank" })] : []));
      linkSlot.hidden = !thread.link;
      const appTitle = app.querySelector(".appbar h1, .appbar .title");
      if (appTitle) appTitle.textContent = thread.name;
    }
    const live = thread.flows.filter((flow) => flow.status === "active");
    const tokensIn = traces.reduce((total, trace) => total + Number(trace.tokensIn || 0), 0);
    const tokensOut = traces.reduce((total, trace) => total + Number(trace.tokensOut || 0), 0);
    sum.replaceChildren(
      h("span", {}, h("b", {}, raw(String(traces.length))), tr("turni")),
      h("span", {}, h("b", {}, raw(String(agents.length))), tr(agents.length === 1 ? "agente" : "agenti")),
      h("span", {}, h("b", {}, raw(shortTokens(tokensIn))), tr("in")),
      h("span", {}, h("b", {}, raw(shortTokens(tokensOut))), tr("out")),
      ...[thread.closed ? tag("Chiuso") : live.length ? tag("In corso", "agent") : null].filter(Boolean));
    const flows = threadSig(live);
    if (flows !== sigs.flows && !threadBusy(flowsSlot)) {
      sigs.flows = flows;
      flowsSlot.replaceChildren(...(live.length ? [panel({ icon: "spark", title: "Al lavoro adesso" }, h("div", { class: "thread-flows" }, live.map((flow) => threadFlow({ ...flow, channelId: thread.id }))))] : []));
    }
    const managing = JSON.stringify([manage, thread.thread, thread.name, thread.closed]);
    if (managing !== sigs.manage && !threadBusy(manageSlot)) {
      sigs.manage = managing;
      manageSlot.replaceChildren(...(manage && thread.thread ? [panel({ icon: "edit", title: "Gestisci" }, threadManage(thread))] : []));
    }
    const team = JSON.stringify(agents);
    if (team !== sigs.agents) {
      sigs.agents = team;
      if (only && !agents.some((agent) => agent.id === only)) only = "";
      chipsSlot.replaceChildren(...(agents.length > 1 ? [h("div", { class: "chips thread-who", role: "group", "aria-label": tr("Agenti") },
        [{ id: "", name: tr("Tutti") }, ...agents].map((agent) => h("button", { type: "button", class: `chip${agent.id === only ? " on" : ""}`, "aria-pressed": String(agent.id === only), onclick: (event) => {
          only = agent.id;
          for (const chip of event.currentTarget.parentElement.children) { chip.classList.toggle("on", chip === event.currentTarget); chip.setAttribute("aria-pressed", String(chip === event.currentTarget)); }
          for (const card of list.children) card.hidden = Boolean(only) && card.dataset.agent !== only;
        } }, agent.id ? avatar(agent, "xs") : null, raw(agent.name))))] : []));
    }
    const first = !list.children.length;
    keyedChildren(list, traces.map((trace, index) => ({
      key: trace.id,
      sig: turnSig(trace),
      build: (old) => threadTurn(trace, old ? old.open : first ? index < 2 : true),
    })), () => false);
    for (const card of list.children) card.hidden = Boolean(only) && card.dataset.agent !== only;
    listEmpty.hidden = Boolean(traces.length);
    toggleAll.hidden = traces.length <= 2;
    if (hint) hint.textContent = tr(traces.length >= 60 ? "Gli ultimi 60 turni, dal più recente." : "Ogni turno, dal più recente.");
  };
  draw(detail);
  shell([
    btn("Thread", { icon: "back", href: "#/thread", cls: "ghost sm back-link" }),
    h("div", { class: "page-head" }, h("div", { class: "page-title" }, title, place), linkSlot),
    sum,
    flowsSlot,
    reasoning,
    manageSlot,
  ], { title: thread.name, back: "#/thread" });
  let loading = false;
  let again = false;
  const refresh = async () => {
    if (loading) { again = true; return; }
    loading = true;
    try {
      const next = await api(`/api/threads/${encodeURIComponent(id)}`);
      if (location.hash === key && list.isConnected) draw(next);
    } catch {}
    finally {
      loading = false;
      if (again) { again = false; void refresh(); }
    }
  };
  S.threadsRefresh = () => {
    if (location.hash !== key || !list.isConnected) return false;
    void refresh();
    return true;
  };
  S.live = (entry) => {
    if (entry.type !== "trace") return;
    if (entry.event === "step" && entry.channelId === thread.id) list.querySelector(`[data-trace="${CSS.escape(String(entry.traceId))}"]`)?.addStep?.(entry.step);
    if ((entry.event === "start" || entry.event === "end") && entry.trace?.channelId === thread.id) {
      clearTimeout(S.threadReload);
      S.threadReload = setTimeout(() => { if (location.hash === key) void refresh(); }, entry.event === "end" ? 600 : 200);
    }
  };
  // The live events carry the turns; a slow check catches a session that starts or stops without one.
  S.timers.push(setInterval(() => { if (!document.hidden) void refresh(); }, 15000));
}

function threadManage(thread) {
  const name = h("input", { type: "text", class: "thread-name", value: thread.name, "data-name": thread.name, "aria-label": tr("Nome del thread"), maxlength: "100" });
  return h("div", { class: "thread-manage" },
    name,
    btn("Rinomina", { cls: "sm", onclick: () => guard(api("/api/threads/rename", { method: "POST", body: { id: thread.id, name: name.value } }), "Nome aggiornato").then((done) => { if (done) name.dataset.name = name.value; threadsRefresh(); }) }),
    !thread.closed ? btn("Chiudi", { icon: "stop", cls: "sm", onclick: () => guard(api("/api/threads/close", { method: "POST", body: { id: thread.id } }), "Thread chiuso").then(threadsRefresh) }) : null);
}

async function render() {
  closeAccountMenu();
  if (!S.data) return;
  let [page] = route();
  if (page === "domini") {
    history.replaceState(null, "", "#/settings/domini");
    page = "settings";
  }
  S.live = null;
  if (page === "agent") await renderAgent();
  else if (page === "banco") await renderDashboard();
  else if (page === "agenti") renderAgents();
  else if (page === "new") renderNew();
  else if (page === "archivio") renderRoutineArchive();
  else if (page === "contesto") renderContext();
  else if (page === "brain") renderBrain();
  else if (page === "thread") await renderThreads();
  else if (page === "artefatti") renderArtifacts();
  else if (page === "settings") renderSettings();
  else if (page === "salotto") renderSalotto();
  else renderAgents();
}

document.documentElement.lang = LANG;
document.title = "Cora · Computer-Operating Resident Agents";

/** While the state loads, the page being opened in outline: its own name, not always the agents page. */
const BOOT_TITLES = { thread: "Thread", agenti: "Agenti", agent: "Agente", new: "Nuovo agente", salotto: "Salotto", banco: "Banco", contesto: "Contesto", brain: "Brain", artefatti: "Artefatti", domini: "Impostazioni", settings: "Impostazioni", archivio: "Archivio" };

function bootSkeleton() {
  const [section] = route();
  const title = BOOT_TITLES[section] || "Agenti";
  if (title === "Agenti") {
    const heading = pageHead("Agenti"); heading.classList.add("agents-page-head");
    return [[
      heading,
      usageOverviewMode() === "quotas"
        ? panel({ icon: "chart", title: "Quote e saldi", hint: "Aggiornamento ogni minuto.", cls: "subscription-usage", actions: btn("", { icon: "swap", title: "Alterna consumi e quote", cls: "ghost usage-toggle", disabled: true }) }, skeleton("quotas"))
        : panel({ icon: "chart", title: "Consumi globali", actions: btn("", { icon: "swap", title: "Alterna consumi e quote", cls: "ghost usage-toggle", disabled: true }) }, skeleton("heat")),
      panel({ icon: "users", title: "Gli agenti", cls: "agent-roster", actions: btn("", { icon: "plus", title: "Nuovo agente", cls: "primary only-icon", disabled: true }) }, skeleton()),
      panel({ icon: "chart", title: "Consumi per agente" }, skeleton("heat")),
    ], title];
  }
  if (section === "salotto" || section === "agent") return [[pageHead(title, skeletonLine("sk-caption")), skeleton("chat", 4)], title];
  return [[pageHead(title, skeletonLine("sk-caption")), panel({}, skeleton("rows", 4)), panel({}, skeleton("rows", 3))], title];
}

async function boot() {
  const [outline, title] = bootSkeleton();
  shell(outline, { title });
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
  const view = location.hash, keepLogin = subscriptionLoginActive();
  connectEvents();
  await guard(loadState());
  if (location.hash !== view) return;
  if (keepLogin) { refreshSubscriptionViews(); return; }
  if (!document.activeElement?.matches("input, textarea, select") && !document.querySelector(".chat-input")?.value) render();
});

// An app, not a page: no pinch or double-tap zoom.
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("touchmove", (event) => {
  if (event.scale !== undefined && event.scale !== 1) event.preventDefault();
}, { passive: false });
window.addEventListener("hashchange", () => render());
window.addEventListener("resize", () => closeAccountMenu());
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && S.accountMenu) closeAccountMenu(true); });
boot();
