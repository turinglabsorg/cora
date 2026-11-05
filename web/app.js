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
  grok: "Grok (abbonamento)",
  muse: "Meta Muse (abbonamento)",
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
  hermes: { label: "Hermes", hint: "Hermes guida sé stesso sui modelli del suo endpoint, di solito quelli di questa macchina.", providers: ["hermes"] },
  deepseek: { label: "DeepSeek Harness", hint: "dsh, l'harness di DeepSeek, guida sé stesso con la chiave DeepSeek di questa Cora.", providers: ["deepseek"] },
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
  ["hermes", "Hermes Agent"],
  ["deepseek", "DeepSeek Harness"],
];
const PROVIDER_HINTS = {
  claude: "Claude Code non trovato su questa macchina",
  codex: "Codex non trovato su questa macchina",
  grok: "Grok Build non trovato su questa macchina",
  muse: "Muse Code non trovato su questa macchina",
  ollama: "questa macchina non è collegata a Ollama Cloud, e manca CORA_OLLAMA_API_KEY in hush",
  ollamaLocal: "nessun Ollama in ascolto su questa macchina",
  ollamaCloud: "questa macchina non è collegata a Ollama Cloud, e manca CORA_OLLAMA_API_KEY in hush",
  orcarouter: "manca CORA_ORCAROUTER_API_KEY in hush",
  hermes: "Hermes non trovato su questa macchina",
  deepseek: "serve dsh su questa macchina e la chiave DeepSeek",
};
const PROVIDER_SHORT = { claude: "Claude", codex: "ChatGPT", grok: "Grok", muse: "Meta", ollama: "Ollama", orcarouter: "OrcaRouter", hermes: "Hermes", deepseek: "DeepSeek" };
/** Each subscription's mark, so two accounts are told apart at a glance. */
const SUBSCRIPTION_ICONS = { claude: "spark", codex: "chip", grok: "terminal", muse: "layers" };
/** The account's name and the program that uses it, as Settings lists them. */
const SUBSCRIPTION_NAMES = { claude: "Claude", codex: "ChatGPT / Codex", grok: "Grok / Grok Build", muse: "Meta / Muse Code" };
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
    // The salotto opens from the Banco: it is one of the desk's rooms, not a section of its own.
    ["banco", "Banco", "grid", section === "banco" || section === "salotto"],
    ["contesto", "Contesto", "book", section === "contesto"],
    ["brain", "Brain", "bulb", section === "brain"],
    ["artefatti", "Artefatti", "archive", section === "artefatti", S.data?.artifacts?.reviews || 0],
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
  const routines = S.data.routines.filter((routine) => routine.agentId === agent.id && routine.enabled).length;
  const [account, accountOn] = agentAccount(agent);
  return h("article", { class: `agent-card${agent.enabled ? "" : " off"}`, vars: { "--ring": agent.color || "#f2a93b", "--delay": `${index * 50}ms` } },
    monitor,
    h("a", { class: "agent-ident", href: `#/agent/${agent.id}/chat` },
      avatar(agent),
      h("span", { class: "grow" }, h("b", {}, raw(agent.name)), h("small", { title: modelLabel(agent.model) }, modelLabel(agent.model, { short: true }))),
      icon("next", "chev")),
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
  const total = (trace.tokensIn || 0) + (trace.tokensOut || 0);
  const lead = withAgent && agent
    ? avatar(agent, "sm")
    : h("span", { class: "goal-total" }, h("b", {}, total ? shortTokens(total) : "—"), h("small", {}, "token"));
  const spent = total ? `${tr("{in} in · {out} out", { in: shortTokens(trace.tokensIn || 0), out: shortTokens(trace.tokensOut || 0) })} · ` : "";
  return h("a", { class: "row-link", href: `#/agent/${trace.agentId}/ragionamento/${trace.id}` },
    lead,
    h("span", { class: "grow" },
      h("span", { class: "row-meta" }, withAgent && agent ? h("b", {}, raw(agent.name)) : null, tag(TRACE_KIND[trace.kind] || trace.kind), tag(label, cls), raw(`${spent}${traceWhere(trace)} · ${fmtTime(trace.startedAt, true)} · ${duration(trace)}`)),
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
  grok: "Grok Build non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  muse: "Muse Code non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  hermes: "Hermes non è installato su questa macchina: installalo sul server con l'utente di Cora.",
  deepseek: "DeepSeek Harness ha bisogno di dsh sul server (npm i -g @deepseek-ai/dsh) e della chiave DeepSeek in Impostazioni → DeepSeek.",
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
const SUBSCRIPTION_HARNESSES = ["claude", "codex", "grok", "muse"];

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
          // DeepSeek Harness can be installed and still lack its key: the flag says which.
          h("span", { class: "harness-name" }, tr(item.label), ready ? null : h("span", { class: "harness-flag" }, tr(key === "deepseek" && S.data.providers?.deepseekInstalled ? "senza chiave" : "non installato"))),
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

/** How long an agent thinks before it answers: the same four levels wherever it is chosen. */
function effortSelect(agent) {
  return h("select", { name: "effort", "aria-label": tr("Ragionamento") },
    [["", "Automatico"], ["low", "Basso"], ["medium", "Medio"], ["high", "Alto"]].map(([value, label]) =>
      h("option", { value, selected: (agent.effort || (agent.think ? "high" : "")) === value }, label)));
}

/** The Cervello tab: the two columns, plus what the brain does once it has a model. */
function brainTab(agent) {
  const brain = brainPanel(agent);
  const form = h("form", { class: "stack" },
    panel({ icon: "chip", title: "Cervello", hint: "Chi guida il ciclo, dove gira il modello e quale." }, brain.node),
    panel({ icon: "spark", title: "Come pensa", hint: "Quanto si ferma a ragionare e cosa ha per le mani." },
      setRows(
        setRow("Ragionamento", "Quanto pensa prima di rispondere: più alto è più accurato ma più lento.", effortSelect(agent)),
        setRow("Usa il suo computer", "Un desktop Linux tutto suo, che vedi anche tu.", switchInput("tools", "", agent.tools ?? true)))),
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
const CLI_NAMES = { claude: "Claude Code", codex: "Codex", grok: "Grok Build", muse: "Muse Code" };
const SUBSCRIPTION_STATES = { disconnected: "Da collegare", connecting: "Accesso in corso", ready: "Collegata", error: "Accesso non riuscito" };

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

/** A sign-in under way: the official page to open, the device code to copy or confirm, Claude's code to paste back. */
function subscriptionLoginSteps(record, name, { authCode, act }) {
  const out = [];
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
        btn("Completa collegamento", { icon: "check", cls: "subscription-complete", onclick: () => {
          if (!authCode.value.trim()) { authCode.focus(); return; }
          const code = authCode.value;
          authCode.value = "";
          act(() => api(`/api/subscriptions/${record.id}/code`, { method: "POST", body: { code } }));
        } })));
    }
    out.push(steps);
  } else out.push(h("p", { class: "subscription-description" }, "Preparazione dell'accesso…"));
  out.push(h("div", { class: "subscription-footer" },
    h("span", { class: "subscription-wait" }, icon("clock"), "In attesa di autorizzazione"),
    btn("Annulla", { cls: "ghost", onclick: () => act(() => api(`/api/subscriptions/${record.id}/cancel`, { method: "POST" })) })));
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
  const root = h("div", { class: "accounts" });
  const codes = new Map();
  let busy = false;
  let error = "";
  let snapshot = "";
  async function act(fn) {
    if (busy) return;
    busy = true;
    error = "";
    draw(true);
    try { await fn(); }
    catch (failure) { error = failure.message; }
    try { S.data.subscriptions = await api("/api/subscriptions"); }
    catch { error ||= "Impossibile aggiornare il collegamento. Riprova."; }
    busy = false;
    draw(true);
  }
  const add = () => act(async () => {
    const record = await api("/api/subscriptions", { method: "POST", body: { provider, label: name } });
    await api(`/api/subscriptions/${record.id}/login`, { method: "POST" });
  });
  function draw(force = false) {
    const records = (S.data.subscriptions || []).filter((item) => item.provider === provider && !item.resident);
    const next = JSON.stringify({ records, busy, error });
    if (!force && next === snapshot) return;
    snapshot = next;
    const installed = Boolean(S.data.providers?.[provider]);
    const rows = records.map((record) => {
      const used = (S.data.agents || []).filter((agent) => agent.subscriptionId === record.id).length;
      if (!codes.has(record.id)) codes.set(record.id, h("input", { type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Codice di autorizzazione", placeholder: "Incolla il codice di Claude" }));
      const remove = btn("", { icon: "trash", cls: "sm ghost danger", title: used ? "In uso: prima scegli un altro account nel profilo dell'agente" : "Rimuovi account", disabled: Boolean(used) || busy,
        onclick: () => act(() => api(`/api/subscriptions/${record.id}`, { method: "DELETE" })) });
      return h("div", { class: `account ${record.status}` },
        h("div", { class: "account-row" },
          h("span", { class: `subscription-option-dot ${record.status}`, "aria-hidden": "true" }),
          h("div", { class: "grow" }, h("b", {}, raw(record.email || record.label || name)),
            h("small", {}, raw(`${accountOwner(record)} · `), SUBSCRIPTION_STATES[record.status] || raw(record.status),
              used ? raw(` · ${used === 1 ? tr("Usato da un agente") : tr("Usato da {count} agenti", { count: used })}`) : null)),
          h("div", { class: "account-actions" },
            record.status === "ready" ? btn("", { icon: "refresh", cls: "sm ghost", title: "Verifica collegamento", disabled: busy, onclick: () => act(() => api(`/api/subscriptions/${record.id}/check`, { method: "POST" })) }) : null,
            record.status === "disconnected" || record.status === "error"
              ? btn("Ricollega", { icon: "external", cls: "sm", title: "Ricollega", disabled: busy, onclick: () => act(() => api(`/api/subscriptions/${record.id}/login`, { method: "POST" })) }) : null,
            remove)),
        record.status === "error" ? h("p", { class: "subscription-error", role: "alert" }, icon("alert"), record.issue === "isolation"
          ? "Questa istanza non supporta ancora il collegamento. Aggiorna Claude Code sul server e riprova."
          : "L'accesso non è stato completato. Riprova quando vuoi.") : null,
        record.status === "connecting" ? h("div", { class: "account-login" }, subscriptionLoginSteps(record, name, { authCode: codes.get(record.id), act })) : null);
    });
    root.replaceChildren(...[
      error ? h("p", { class: "subscription-error", role: "alert" }, icon("alert"), tr(error)) : null,
      rows.length ? h("div", { class: "account-list" }, rows)
        : h("p", { class: "accounts-empty" }, installed ? tr("Nessun altro account {provider} collegato.", { provider: name })
          : tr("{cli} non è installato su questa macchina, quindi non c'è ancora niente da collegare. Installalo sul server con l'utente di Cora e questa scheda si accende da sola.", { cli: CLI_NAMES[provider] || name })),
      installed ? h("div", { class: "accounts-add" }, btn(busy ? "Preparazione dell'accesso…" : "Aggiungi account", { icon: busy ? "refresh" : "plus", cls: rows.length ? "" : "primary", disabled: busy, onclick: add })) : null,
    ].filter(Boolean));
    onChange();
  }
  const poll = async () => {
    if (!root.isConnected) return;
    if (!busy && S.data.subscriptions?.some((item) => item.provider === provider && item.status === "connecting")) {
      try {
        S.data.subscriptions = await api("/api/subscriptions");
        draw();
      } catch {}
    }
    setTimeout(poll, 1500);
  };
  draw(true);
  setTimeout(poll, 1500);
  return root;
}

function subscriptionPicker(currentId, { manage = false, isNew = false } = {}) {
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
      h("span", { class: "subscription-mark", "aria-hidden": "true" }, icon(SUBSCRIPTION_ICONS[provider])),
      h("div", { class: "grow" }, h("span", { class: "label" }, "Abbonamento"), h("h3", {}, raw(name))),
      record && !choosing ? status : null));
    if (actionError) content.append(h("p", { class: "subscription-error", role: "alert" }, icon("alert"), tr(actionError)));

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
        btn("", { icon: "refresh", cls: "ghost", title: "Verifica collegamento", onclick: () => action(() => api(`/api/subscriptions/${record.id}/check`, { method: "POST" })) })));
    } else if (record?.status === "connecting") {
      content.append(...subscriptionLoginSteps(record, name, { authCode, act: action }));
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
          ? () => action(() => api(`/api/subscriptions/${record.id}/login`, { method: "POST" })) : connectNew }),
        records.length ? btn("Cambia account", { cls: "ghost", onclick: changeAccount }) : null));
      if (provider === "codex") content.append(subscriptionDeviceHelp());
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
      const needs = SUBSCRIPTION_HARNESSES.includes(provider);
      root.hidden = !needs;
      input.disabled = !needs;
      if (previous !== provider) {
        // A new agent starts on the account its creator signed in themselves, when there is one.
        const own = isNew ? (S.data.subscriptions || []).find((item) => item.provider === provider && item.status === "ready" && isOwnAccount(item)) : null;
        selectedId = selections.has(provider) ? selections.get(provider) : ((S.data.subscriptions || []).find((item) => item.id === currentId && item.provider === provider)?.id) || own?.id || "";
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
 * Who the agent is. The brain lives in its own tab once the agent exists; while it
 * is being created there is no tab yet, so the simple pair harness + model rides here.
 */
function agentForm(agent, { only = "" } = {}) {
  const isNew = !agent.id;
  const wantsBrain = only !== "profile";
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
  const form = h("form", { class: "stack" },
    panel({ icon: "user", title: "Identità", hint: "Come si chiama e come appare." },
      setRows(
        setRow("Nome", "Chi lo nomina riceve la sua risposta.", nameInput),
        setRow("Colore", "Quello della sua immagine e del suo nome nel pannello.", colorInput),
        setRow("Genere", "Come parla di sé, e la voce che gli viene data.", genderInput),
        setRow("Immagine", "La disegna Cora con il colore dell'agente; «Ridisegna» propone un'altra faccia. Una tua viene tagliata quadrata.", picture.node, { stack: true }))),
    wantsBrain ? panel({ icon: "chip", title: "Cervello", hint: "Con che modello pensa e cosa può usare." },
      setRows(
        setRow("Harness", harnessHint, harnessPick),
        setRow("Modello", "Il modello che pensa, per l'harness scelto.", model, { stack: true }),
        h("div", { class: "set-row stack" }, subscription.node),
        setRow("Ragionamento", "Quanto pensa prima di rispondere: più alto è più accurato ma più lento.", effortSelect(agent)),
        setRow("Usa il suo computer", "Un desktop Linux tutto suo, che vedi anche tu.", switchInput("tools", "", agent.tools ?? true)))) : null,
    panel({ icon: "spark", title: "Carattere", hint: "Chi è, come parla, cosa gli interessa, che rapporto ha con gli altri." },
      h("textarea", { name: "personality", class: "tall", placeholder: "Chi è, come parla, cosa gli interessa, cosa odia, che rapporto ha con gli altri agenti e con te…" }, agent.personality || "")),
    panel({ icon: "radio", title: "Ascolto", hint: "Dove ascolta. Parla solo quando qualcuno lo chiama." },
      setRows(
        setRow(tr("Canali {transport}", { transport: TRANSPORTS[S.data.transport].label }), "Nessuno selezionato = li ascolta tutti.", channelChips(agent.channelIds || []), { stack: true }),
        setRow("In onda", "Spento non ascolta e non parla, da nessuna parte.", switchInput("enabled", "", agent.enabled ?? true)))),
    voicePanel(agent, genderInput),
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
      avatarSeed: data.get("avatarSeed"),
      color: data.get("color"),
      gender: data.get("gender"),
      channelIds: [...hidden, ...[...form.querySelectorAll("[data-channels] .chip.on")].map((chip) => chip.dataset.id)],
      enabled: form.elements.enabled.checked,
      personality: data.get("personality"),
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
    if (isNew) location.hash = `#/agent/${saved.id}/profilo`;
    else renderAgent();
  });
  return form;
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
  return panel({ icon: "mic", title: "Voce", hint: "Ascolta i messaggi vocali: a un vocale risponde sempre a voce, con la sua." }, body);
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
      : tr("Nome, descrizione e immagine seguono il pannello: allineati {time}.", { time: fmtTime(record.at, true) });
  return h("div", { class: `slack-app-sync${record?.error ? " err" : ""}` }, icon(record?.error ? "alert" : "check"), h("span", { class: "grow" }, raw(line)), button);
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

function telegramAccount(agent) {
  const bot = agent.telegramBot || { configured: false, env: "" };
  const actions = bot.user
    ? badge(bot.inChat ? "Nel gruppo" : "Fuori dal gruppo", bot.inChat ? "on" : "err", bot.inChat ? "check" : "alert")
    : badge("Bot principale", bot.state === "error" ? "err" : "", "send");
  let body;
  if (bot.user) {
    body = setRows(
      setRow("Bot suo", h("span", {}, "Collegato come ", h("b", {}, raw(`@${bot.user.username}`)), ". ", bot.inChat ? "Scrive nel gruppo con il suo account." : "Non è ancora nel gruppo: finché non lo aggiungi scrive tramite il bot principale."),
        h("div", { class: "row" },
          bot.inChat ? null : btn("Aggiungi al gruppo", { icon: "plus", href: `https://t.me/${bot.user.username}?startgroup=cora`, target: "_blank", cls: "primary" }),
          btn("Apri su Telegram", { icon: "external", href: bot.link, target: "_blank" }))),
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
  return panel({ icon: "send", title: "Account Telegram", hint: "Il suo bot su Telegram.", actions }, body);
}

function renderNew() {
  shell([pageHead("Nuovo agente", "Dagli un nome, un cervello e un carattere."), agentForm({ enabled: true, tools: true })], { title: "Nuovo agente", back: "#/agenti" });
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

  // A new memory is a line at the top of the list, like a rule in Accesso: no panel of its own.
  const input = h("input", { type: "text", name: "text", placeholder: "Un fatto da ricordare. Es: «Sara odia le riunioni prima delle 10».", "aria-label": tr("Nuovo ricordo"), autocomplete: "off" });
  const add = h("form", { class: "memory-add" }, input,
    h("div", { class: "memory-add-options" }, data.brain ? null : switchInput("shared", "Condiviso", false), switchInput("pinned", "Fissato", false),
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
  // With a company brain, what everyone should know goes there: an agent's memory is its own.
  return [
    corePanel,
    panel({ icon: "book", title: "Ricordi", hint: `${data.brain && !data.shared.length ? tr("{count} ricordi suoi. Quelli comuni a tutti sono nel Brain.", { count: all.length }) : tr("{count} tra privati e condivisi.", { count: all.length })} ${tr("A ogni messaggio riaffiorano quelli pertinenti; quelli fissati ci sono sempre.")}` },
      add, h("label", { class: "search" }, icon("search"), search), list),
    panel({ icon: "moon", title: "Diario", hint: "Le ultime due pagine gli tornano in mente ogni giorno." }, diary),
  ];
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
    S.data.channels.map((channel) => h("option", { value: channel.id, selected: channel.id === routine.channelId }, raw(channelChipLabel(channel)))));
  if (routine.channelId && !routine.channelId.startsWith("web") && !S.data.channels.some((channel) => channel.id === routine.channelId)) {
    channelSelect.append(h("option", { value: routine.channelId, selected: true }, tr("{channel} (non attivo)", { channel: channelName(routine.channelId) })));
  }
  const form = panel({ tag: "form", icon: isNew ? "plus" : "edit", title: isNew ? "Nuova attività" : tr("Modifica «{name}»", { name: routine.name }), hint: "Un compito, quando serve, con un risultato da ritrovare." },
    setRows(
      isNew ? setRow("Tipo", "Una routine si ripete; un reminder va una volta sola, poi in archivio.", kindPicker, { stack: true })
        : setRow("Tipo", null, badge(kind === "reminder" ? "Reminder" : "Routine", "", "clock")),
      setRow("Nome", "Come la ritrovi nell'elenco e nell'archivio.", h("input", { type: "text", name: "name", value: routine.name || "", required: true, placeholder: "es. Rassegna stampa" })),
      setRow(S.data.transport === "telegram" ? "Chat" : "Canale", "Dove pubblica il risultato.", channelSelect),
      setRow("Quando", null, timing, { stack: true }),
      setRow("Compito", "Cosa deve fare, dove guardare, cosa riportare.", h("textarea", { name: "prompt", class: "tall", required: true, placeholder: "Cosa deve fare, dove guardare, cosa riportare. Se non c'è niente da dire può restare in silenzio." }, routine.prompt || ""), { stack: true }),
      setRow("Attiva", "Spenta resta in elenco ma non parte.", switchInput("enabled", "", routine.enabled ?? true))),
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
  const navigation = h("nav", { class: "segmented task-switch", "aria-label": "Attività programmate" },
    h("a", { href: `#/agent/${agent.id}/routine`, class: archived ? "" : "on", "aria-current": archived ? null : "page" }, icon("clock"), "In programma"),
    h("a", { href: `#/agent/${agent.id}/routine?view=archive`, class: archived ? "on" : "", "aria-current": archived ? "page" : null }, icon("book"), "Archivio"));
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
          btn("", { icon: "play", cls: "sm", title: reminder && ["blocked", "unverified", "error", "interrupted", "stopped"].includes(routine.lastStatus) ? "Riprova" : "Esegui ora", disabled: routine.running, onclick: async () => {
            if (await guard(api(`/api/routines/${routine.id}/run`, { method: "POST" }), "Attività avviata")) scheduleRefresh();
          } }),
          btn("", { icon: "edit", cls: "sm", title: "Modifica", href: `#/agent/${agent.id}/routine?edit=${routine.id}` }),
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
    pageHead(h("span", {}, "Il ", h("em", {}, "salotto")), "Tutti gli agenti in onda: risponde chi chiami per nome."),
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
          raw(`${tr(item.turns === 1 ? "1 turno" : "{count} turni", { count: item.turns })} · ${tr("{in} in · {out} out", { in: shortTokens(item.tokensIn), out: shortTokens(item.tokensOut) })} · ${traceWhere(item)} · ${fmtTime(item.last, true)}`)),
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
  const [list, goals] = await Promise.all([guard(api(`/api/agents/${agent.id}/traces`)), guard(api(`/api/agents/${agent.id}/goals`))]);
  if (!isCurrent()) return null;
  let pending = null;
  S.live = (entry) => {
    if (entry.type !== "trace" || entry.event === "step" || entry.trace.agentId !== agent.id) return;
    clearTimeout(pending);
    pending = setTimeout(() => { if (route()[2] === "ragionamento" && !route()[3]) renderAgent(); }, 1500);
  };
  // One list, newest first: a goal stands for all the turns that worked toward it, the other turns stand alone.
  const groups = goals?.goals || [];
  const grouped = (trace) => trace.goal && groups.some((item) => item.goal === trace.goal && (item.channelId || "") === (trace.channelId || ""));
  const items = [
    ...groups.map((item) => ({ at: Number(item.last) || Date.parse(item.last) || 0, node: () => goalGroup(agent, item) })),
    ...(list || []).filter((trace) => !grouped(trace)).map((trace) => ({ at: Number(trace.startedAt) || Date.parse(trace.startedAt) || 0, node: () => traceRow(trace) })),
  ].sort((a, b) => b.at - a.at);
  const spent = groups.reduce((sum, item) => sum + item.tokensIn + item.tokensOut, 0)
    + (list || []).filter((trace) => !grouped(trace)).reduce((sum, trace) => sum + (trace.tokensIn || 0) + (trace.tokensOut || 0), 0);
  const provider = (agent.model || S.data.settings.defaultModel).split("/")[0];
  const hint = provider === "claude"
    ? "Ogni turno, anche quando passa, e gli obiettivi con tutti i turni che ci hanno lavorato. Claude Code mostra i passi e gli strumenti, non il testo del ragionamento."
    : "Ogni turno, anche quando passa: cosa ha letto, cosa ha pensato, gli strumenti e la risposta. Un obiettivo raccoglie tutti i turni che ci hanno lavorato.";
  return panel({ icon: "bulb", title: "Ragionamento", hint, actions: spent ? h("span", { class: "reasoning-total" }, h("b", {}, shortTokens(spent)), h("small", {}, "token")) : null },
    items.length ? h("div", { class: "reasoning-list" }, items.map((item) => item.node())) : empty("bulb", "Ancora nessun turno registrato."));
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

function renderBrain() {
  const [, view, slug] = route();
  if (view === "p" && slug) return renderBrainPage(slug);
  if (view === "revisione") return renderBrainReview();
  const mapView = view === "mappa";
  const body = h("div", { class: "stack" }, skeleton("rows", 4));
  let state = null;
  let kind = "";
  let map = null;
  const mapBox = h("div", {}, skeleton("rows", 3));
  const search = h("input", { type: "search", placeholder: tr("Cerca nel brain…"), "aria-label": tr("Cerca nel brain"), autocomplete: "off" });
  const list = h("div", { class: "brain-list" });
  const reviewButton = btn("Rivedi", { icon: "check", cls: "primary", href: "#/brain/revisione" });
  const runButton = btn("Aggiorna adesso", { icon: "refresh", cls: "ghost", onclick: async () => {
    runButton.disabled = true;
    if (await guard(api("/api/brain/run", { method: "POST" }), "Il bibliotecario è al lavoro")) setTimeout(load, 4000);
    runButton.disabled = false;
  } });
  async function pages() {
    const query = search.value.trim();
    if (mapView) {
      if (map) { map.filter({ kind, query }); return; }
      try {
        const graph = await api("/api/brain/graph");
        if (!graph.nodes.length) { mapBox.replaceChildren(empty("bulb", "Ancora nessuna pagina: il bibliotecario le scrive di notte dalle chat.")); return; }
        map = brainMap(graph);
        mapBox.replaceChildren(map.element);
        map.filter({ kind, query: search.value.trim() });
      } catch (error) { mapBox.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
      return;
    }
    list.replaceChildren(skeleton("rows", 3));
    try {
      const data = await api(`/api/brain/pages?${new URLSearchParams(query ? { q: query } : { kind })}`);
      list.replaceChildren(...(data.pages.length ? data.pages.map((page) => h("a", { class: "brain-row", href: `#/brain/p/${page.slug}` },
        h("div", { class: "grow" }, h("b", {}, raw(page.title)), page.summary ? h("small", {}, raw(page.summary)) : null),
        h("div", { class: "brain-row-meta" }, badge(BRAIN_KINDS_LABEL[page.kind] || raw(page.kind)), page.pending ? badge("Da rivedere", "warn") : null))) :
        [empty("bulb", query ? "Niente nel brain su questo." : "Ancora nessuna pagina: il bibliotecario le scrive di notte dalle chat.")]));
    } catch (error) { list.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  }
  let timer = null;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(pages, mapView ? 120 : 300); });
  const views = h("div", { class: "segmented", role: "tablist", "aria-label": tr("Come vedere il brain") },
    [["", "Elenco", "list"], ["mappa", "Mappa", "graph"]].map(([key, label, name]) => h("button", { type: "button", role: "tab", class: (key === "mappa") === mapView ? "on" : "", "aria-selected": String((key === "mappa") === mapView), onclick: () => { location.hash = key ? `#/brain/${key}` : "#/brain"; } }, icon(name), label)));
  // The librarian's settings, in the rows of Settings: each saved as it changes.
  const settingsPanel = () => {
    const settings = S.data.settings;
    const model = modelPicker("brainModel", settings.brainModel || "", { allowDefault: true });
    const modelRow = setRow("Modello del bibliotecario", "Legge le chat e scrive le pagine: un modello attento sui fatti e sulle fonti.", model, { stack: true });
    model.addEventListener("change", () => {
      const value = model.querySelector("input").value.trim() || model.querySelector("select").value;
      if (value !== (S.data.settings.brainModel || "")) saveSettings({ brainModel: value }, modelRow);
    });
    const embed = h("input", { type: "text", class: "mono", value: settings.brainEmbedModel || "", autocomplete: "off", spellcheck: "false", "aria-label": tr("Modello per la ricerca") });
    const embedRow = setRow("Modello per la ricerca", "Un modello di embedding dell'Ollama di questa macchina, es. bge-m3. Vuoto: ricerca solo per parole.", embed);
    embed.addEventListener("change", () => saveSettings({ brainEmbedModel: embed.value.trim() }, embedRow));
    const hourRow = (key, label, hint) => {
      const select = h("select", { "aria-label": tr(label) }, Array.from({ length: 24 }, (_, index) => h("option", { value: index, selected: index === settings[key] }, raw(`${String(index).padStart(2, "0")}:00`))));
      const row = setRow(label, hint, select);
      select.addEventListener("change", () => saveSettings({ [key]: Number(select.value) }, row));
      return row;
    };
    return panel({ icon: "sliders", title: "Il bibliotecario", hint: "Ogni notte legge le chat e aggiorna il brain; la mattina ti dice cosa è cambiato. Le modifiche valgono subito, anche se non le rivedi." },
      setRows(modelRow, embedRow,
        hourRow("librarianHour", "Ora del bibliotecario", "Prima fa il backup, poi aggiorna il brain."),
        hourRow("reviewHour", "Ora della revisione", "Ti arriva il riepilogo: sul telefono e in privato.")));
  };
  function draw() {
    if (!state.enabled) {
      body.replaceChildren(panel({ icon: "bulb", title: "Il brain non è collegato" },
        h("p", { class: "notice warn" }, icon("alert"), h("span", {}, "Questa Cora non ha ancora il suo database del brain: serve un Postgres con pgvector, in hush come CORA_BRAIN_DATABASE_URL."))));
      return;
    }
    const { stats, lastRun } = state;
    reviewButton.querySelector("span").textContent = stats.pending + stats.flagged ? tr("Rivedi ({count})", { count: stats.pending + stats.flagged }) : tr("Rivedi");
    reviewButton.className = `btn${stats.pending + stats.flagged ? " primary" : " ghost"}`;
    const chips = h("div", { class: "chips", role: "group", "aria-label": tr("Tipo di pagina") },
      [["", "Tutte"], ...Object.entries(BRAIN_KINDS_PLURAL)].map(([key, label]) => h("button", { type: "button", class: `chip${kind === key ? " on" : ""}`, "aria-pressed": String(kind === key), onclick: () => { kind = key; search.value = ""; draw(); pages(); } }, label)));
    body.replaceChildren(
      h("div", { class: "stats" },
        statCard({ icon: "book", value: String(stats.pages), label: "pagine" }),
        statCard({ icon: "check", value: String(stats.pending + stats.flagged), label: "da rivedere", href: stats.pending + stats.flagged ? "#/brain/revisione" : null }),
        statCard({ icon: "search", value: String(stats.chunks), label: "messaggi cercabili" }),
        statCard({ icon: "clock", value: lastRun ? raw(fmtTime(lastRun.at, true)) : "—", label: "ultimo giro",
          sub: lastRun ? raw(tr("{created} nuove, {updated} modificate{errors}", { created: lastRun.created, updated: lastRun.updated, errors: lastRun.errors?.length ? tr(", con errori") : "" })) : "il bibliotecario non è ancora passato" })),
      h("div", { class: "brain-search" }, search, h("div", { class: "brain-views" }, chips, views)),
      ...(mapView ? [mapBox] : state.canManage ? [list, settingsPanel()] : [list]));
  }
  async function load() {
    try {
      state = await api("/api/brain");
      if (!body.isConnected) return;
      draw();
      if (state.enabled) pages();
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  }
  shell([pageHead("Brain", "Quello che sa l'azienda: clienti, progetti, persone, decisioni e procedure, con le fonti.", [reviewButton, runButton]), body], { title: "Brain" });
  load();
}

async function renderBrainPage(slug) {
  const body = h("div", { class: "stack" }, skeleton("rows", 3));
  shell([body], { title: "Brain", back: "#/brain" });
  let page;
  let state;
  try { [page, state] = await Promise.all([api(`/api/brain/pages/${encodeURIComponent(slug)}`), api("/api/brain")]); }
  catch (error) { body.replaceChildren(empty("bulb", error.message, btn("Torna al brain", { icon: "back", href: "#/brain" }))); return; }
  const editing = { on: false };
  const draw = () => {
    const actions = state.canManage ? [
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
    body.replaceChildren(
      pageHead(raw(page.title), h("span", { class: "brain-head-meta" }, badge(BRAIN_KINDS_LABEL[page.kind] || raw(page.kind)), page.status === "archived" ? badge("Archiviata") : null, page.pending ? badge("Da rivedere", "warn") : null,
        h("small", {}, tr("aggiornata {when}", { when: fmtTime(page.updatedAt, true) }))), actions),
      panel({ cls: "brain-page" }, content),
      panel({ icon: "clock", title: "Storia", hint: "Ogni modifica, chi l'ha fatta e da dove viene." },
        h("ol", { class: "brain-history" }, page.revisions.map((revision) => h("li", {},
          h("div", { class: "row" }, h("b", {}, BRAIN_ACTIONS[revision.action] || raw(revision.action)), badge(BRAIN_REVIEWS[revision.review] || raw(revision.review), revision.review === "approved" ? "on" : revision.review === "reverted" ? "" : "warn"),
            h("small", { class: "grow" }, brainAuthor(revision.author), raw(` · ${fmtTime(revision.createdAt, true)}`))),
          revision.note ? h("p", {}, raw(revision.note)) : null,
          revision.conflict ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(revision.conflict))) : null,
          brainSources(revision.sources))))));
  };
  draw();
}

async function renderBrainReview() {
  const body = h("div", { class: "stack" }, skeleton("rows", 3));
  const approveAll = btn("Approva tutto", { icon: "check", cls: "primary", onclick: () => decide({ all: true, decision: "approve" }, "Tutto approvato") });
  shell([pageHead("Revisione del brain", "Cosa ha cambiato il bibliotecario. Vale già: approva quello che va bene, annulla quello che no.", [approveAll]), body], { title: "Revisione", back: "#/brain" });
  let state;
  async function decide(choice, done) {
    for (const button of body.querySelectorAll("button")) button.disabled = true;
    approveAll.disabled = true;
    if (await guard(api("/api/brain/review", { method: "POST", body: choice }), done)) await load();
    approveAll.disabled = false;
  }
  async function load() {
    try {
      const [{ queue }, brain] = await Promise.all([api("/api/brain/review"), state ? Promise.resolve(state) : api("/api/brain")]);
      state = brain;
      approveAll.hidden = !queue.length || !state.canManage;
      if (!queue.length) { body.replaceChildren(empty("check", "Niente da rivedere: il brain è come l'hai lasciato.", btn("Torna al brain", { icon: "back", href: "#/brain" }))); return; }
      body.replaceChildren(...queue.map((revision) => h("article", { class: `brain-change${revision.review === "flagged" ? " flagged" : ""}` },
        h("header", { class: "row" },
          h("a", { href: `#/brain/p/${revision.slug}`, class: "grow" }, h("b", {}, raw(revision.title))),
          badge(BRAIN_ACTIONS[revision.action] || raw(revision.action), revision.action === "create" ? "on" : ""), revision.review === "flagged" ? badge("Da verificare", "warn", "alert") : null),
        h("small", {}, brainAuthor(revision.author), raw(` · ${fmtTime(revision.createdAt, true)}${revision.note ? ` · ${revision.note}` : ""}`)),
        revision.conflict ? h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(revision.conflict))) : null,
        revision.previous && revision.previous.summary !== revision.summary ? brainDiff(revision.previous.summary, revision.summary) : null,
        revision.previous ? brainDiff(revision.previous.body, revision.body) : brainText(revision.body),
        brainSources(revision.sources),
        state.canManage ? h("div", { class: "row brain-change-actions" }, h("span", { class: "spacer" }),
          btn("Annulla", { icon: "close", cls: "ghost", onclick: () => decide({ ids: [revision.id], decision: "revert" }, "Modifica annullata") }),
          btn("Approva", { icon: "check", cls: "primary", onclick: () => decide({ ids: [revision.id], decision: "approve" }, "Approvata") })) : null)));
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  }
  load();
}

/* ---------- artifacts ---------- */
const ARTIFACT_STATUS = {
  proposed: ["Da rivedere", "warn"], conflict: ["In conflitto", "err"], published: ["Pubblicato", "on"], rejected: ["Rifiutato", "err"], superseded: ["Sostituito", ""],
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

function renderArtifacts() {
  const [, id, view, commitId] = route();
  if (id === "segreti") return renderSecrets();
  if (id && view === "c" && commitId) return renderArtifactCommit(id, commitId);
  if (id) return renderArtifactFolder(id, view || "file", view === "file" ? artifactDir(route().slice(3)) : "");
  const body = h("div", { class: "stack" }, skeleton("rows", 4));
  let data = null;
  let creating = false;
  const search = h("input", { type: "search", placeholder: tr("Cerca tra le cartelle…"), "aria-label": tr("Cerca tra le cartelle"), autocomplete: "off" });
  const newButton = btn("Nuova cartella", { icon: "plus", cls: "primary", onclick: () => { creating = !creating; draw(); if (creating) body.querySelector(".art-new input")?.focus(); } });
  search.addEventListener("input", () => drawList());
  const list = h("div", { class: "art-groups" });

  function drawList() {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const folders = data.folders.filter((folder) => !words.length || words.every((word) => `${folder.path} ${folder.title} ${folder.description}`.toLowerCase().includes(word)));
    if (!data.folders.length) {
      list.replaceChildren(empty("archive", "Ancora nessuna cartella. Quando un agente deve conservare o mostrare qualcosa ti chiede dove metterlo, oppure creane una tu.", creating ? null : btn("Nuova cartella", { icon: "plus", onclick: () => newButton.click() })));
      return;
    }
    if (!folders.length) { list.replaceChildren(empty("search", "Nessuna cartella con queste parole.")); return; }
    const groups = new Map();
    for (const folder of folders) {
      const group = folder.path.includes("/") ? folder.path.split("/")[0] : "";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(folder);
    }
    list.replaceChildren(...[...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map(([group, items]) => h("section", { class: "art-group" },
      h("h3", { class: "label" }, group ? raw(group) : tr("Senza gruppo"), h("span", {}, raw(String(items.length)))),
      h("div", { class: "art-list" }, items.map((folder) => h("a", { class: "art-row", href: `#/artefatti/${folder.id}` },
        artifactLed(folder),
        h("span", { class: "panel-ico" }, icon(folder.kind === "site" ? "globe" : "folder")),
        h("span", { class: "grow art-row-text" }, artifactPathLabel(folder.path), h("small", {}, raw(folder.title !== folder.path.split("/").at(-1) ? folder.title : folder.description || folder.title))),
        h("span", { class: "art-row-meta" },
          folder.pending ? badge(tr("{count} da rivedere", { count: folder.pending }), "warn") : null,
          folder.conflicts ? badge("Conflitto", "err", "alert") : null,
          folder.shares ? badge(String(folder.shares), "", "link") : null,
          h("small", {}, raw(folder.head ? `${fileCount(folder.files)} · ${fmtBytes(folder.bytes)}` : tr("niente in onda")), raw(` · ${fmtTime(new Date(folder.lastActivity).toISOString(), true)}`))),
        icon("next", "chev")))))));
  }

  function newFolderForm() {
    const kind = { value: "files" };
    const kinds = h("div", { class: "segmented", role: "radiogroup", "aria-label": tr("Cosa contiene") },
      [["files", "File", "file"], ["site", "Sito", "globe"]].map(([key, label, name]) => h("button", { type: "button", role: "radio", class: key === kind.value ? "on" : "", "aria-checked": String(key === kind.value), onclick: (event) => {
        kind.value = key;
        for (const button of kinds.children) { button.classList.toggle("on", button === event.currentTarget); button.setAttribute("aria-checked", String(button === event.currentTarget)); }
      } }, icon(name), label)));
    const path = h("input", { type: "text", name: "path", class: "mono", placeholder: "clienti/acme/report", autocomplete: "off", spellcheck: "false", required: true, pattern: "[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){0,5}", "aria-label": tr("Percorso") });
    path.addEventListener("input", () => { path.value = path.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9/-]/g, ""); });
    const direct = data.canManage ? switchInput("direct", "Pubblica subito", false, "Senza revisione: ogni caricamento va in onda appena arriva.") : null;
    const form = h("form", { class: "art-new stack" },
      h("div", { class: "grid2" },
        field("Percorso", path, "parole minuscole e trattini, fino a sei livelli"),
        field("Titolo", h("input", { type: "text", name: "title", placeholder: tr("Report trimestrali di Acme"), maxlength: 80 }))),
      field("Cosa ci va", h("textarea", { name: "description", rows: 2, maxlength: 600, placeholder: tr("Gli agenti lo leggono per capire dove mettere le cose.") })),
      h("div", { class: "row" }, field("Contiene", kinds), direct, h("span", { class: "spacer" }),
        btn("Annulla", { cls: "ghost", onclick: () => { creating = false; draw(); } }),
        btn("Crea la cartella", { icon: "check", cls: "primary", type: "submit" })));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const created = await guard(api("/api/artifacts/folders", { method: "POST", body: { path: values.get("path"), title: values.get("title"), description: values.get("description"), kind: kind.value, policy: values.get("direct") ? "direct" : "review" } }), "Cartella creata");
      if (created) location.hash = `#/artefatti/${created.id}`;
    });
    return panel({ icon: "folder", title: "Nuova cartella", hint: "Gli agenti la trovano nel brain e con artifact_folders: scrivi bene cosa ci va." }, form);
  }

  function draw() {
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

  async function load() {
    try {
      data = await api("/api/artifacts");
      setArtifactReviews(data.reviews.length);
      if (body.isConnected) draw();
    } catch (error) { body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))); }
  }
  shell([pageHead("Artefatti", "Quello che gli agenti fanno sui loro computer, con tutte le versioni. Ogni caricamento è un commit e va in onda solo quando lo approvi.", [newButton]), body], { title: "Artefatti" });
  load();
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
async function artifactPreview(url, path, size) {
  const kind = artifactKind(path);
  const download = btn("Scarica", { icon: "download", cls: "sm ghost", href: `${url}?download=1` });
  const head = h("header", { class: "art-preview-head" }, h("span", { class: "grow" }, h("b", {}, raw(path.split("/").at(-1))), h("small", {}, raw(`${path} · ${fmtBytes(size)}`))), download);
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
  if (kind === "text" && size <= 2 * 1024 * 1024) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (response.ok && /^text\/plain/.test(response.headers.get("content-type") || "")) {
        const text = await response.text();
        if (/\.(csv|tsv)$/i.test(path)) {
          const table = artifactTable(text, /\.tsv$/i.test(path) ? "\t" : "");
          if (table) return [head, table];
        }
        const lines = text.split("\n");
        const shown = lines.slice(0, 3000);
        return [head, h("pre", { class: "art-code" }, h("code", {}, shown.map((line, index) => h("span", { class: "art-line" }, h("i", { "aria-hidden": "true" }, raw(String(index + 1))), raw(line || " "))))),
          lines.length > shown.length ? h("p", { class: "muted small" }, tr("Mostrate le prime {shown} righe di {total}: scarica il file per il resto.", { shown: shown.length, total: lines.length })) : null];
      }
    } catch {}
  }
  return [head, h("div", { class: "art-noview" }, icon("file"), h("p", {}, "Il pannello non mostra questo tipo di file: scaricalo."), download.cloneNode(true))];
}

/** A CSV or TSV as a table: the first 500 rows under a sticky header, the separator guessed from the first line. */
function artifactTable(text, separator = "") {
  const first = text.split("\n", 1)[0];
  const sep = separator || [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  // Every record is counted, a quoted cell may span lines; only the first 501 are kept.
  const rows = [];
  let records = 0;
  let row = [];
  let cell = "";
  let quoted = false;
  const end = () => { row.push(cell.replace(/\r$/, "")); if (row.length > 1 || row[0]) { records += 1; if (rows.length < 501) rows.push(row); } row = []; cell = ""; };
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
  if (rows.length < 1 || rows.every((line) => line.length < 2)) return null;
  const [header, ...body] = rows;
  const total = records - 1;
  return h("div", { class: "stack-sm" },
    h("div", { class: "art-sheet" }, h("table", {},
      h("thead", {}, h("tr", {}, header.map((name) => h("th", {}, raw(name))))),
      h("tbody", {}, body.slice(0, 500).map((line) => h("tr", {}, line.map((value) => h("td", { class: /^-?[\d.,]+%?$/.test(value.trim()) ? "num" : "" }, raw(value)))))))),
    h("p", { class: "muted small" }, raw(total > 500 ? tr("Le prime 500 righe di {total}: scarica il file per il resto.", { total }) : tr(total === 1 ? "1 riga" : "{count} righe", { count: total }))));
}

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
  shell([slot], { title: "Artefatti", back: "#/artefatti" });
  let data;
  try { data = await api(`/api/artifacts/folders/${id}`); }
  catch (error) { slot.replaceChildren(empty("archive", error.message, btn("Torna agli artefatti", { icon: "back", href: "#/artefatti" }))); return; }
  if (location.hash !== view) return;
  const { folder } = data;
  const head = data.commits.find((commit) => commit.id === folder.head) || null;
  const pending = data.commits.filter((commit) => commit.status === "proposed" || commit.status === "conflict");
  const TABS = [["file", "File", "file"], ["commit", "Commit", "commit"], ["condivisione", "Condivisione", "link"], ...(data.canReview ? [["registro", "Registro", "clock"]] : []), ["permessi", "Permessi", "shield"]];
  const content = h("div", { class: "stack" });
  shell([
    btn("Artefatti", { icon: "back", href: "#/artefatti", cls: "ghost sm back-link art-back" }),
    pageHead(raw(folder.title), h("span", { class: "art-head-meta" }, artifactPathLabel(folder.path),
      badge(folder.kind === "site" ? "Sito" : "File", "", folder.kind === "site" ? "globe" : "folder"),
      badge(folder.policy === "direct" ? "Pubblica subito" : "Con revisione", folder.policy === "direct" ? "warn" : "", folder.policy === "direct" ? "spark" : "check"))),
    folder.description ? h("p", { class: "lead art-lead" }, raw(folder.description)) : null,
    h("div", { class: `art-onair${head ? " on" : ""}` },
      h("span", { class: `art-lamp${head ? " on" : ""}` }, h("i"), h("span", {}, head ? tr("In onda") : tr("Spento"))),
      head ? h("span", { class: "grow art-onair-text" },
        h("b", {}, raw(head.message)),
        h("small", {}, h("code", {}, raw(head.short)), artifactAuthor(head.author), raw(` · ${fmtTime(new Date(head.publishedAt || head.createdAt).toISOString(), true)} · ${fileCount(head.files)} · ${fmtBytes(head.bytes)}`)))
        : h("span", { class: "grow art-onair-text" }, h("b", {}, "Niente in onda"), h("small", {}, "Il primo commit approvato va in onda qui.")),
      pending.length ? btn(tr("Rivedi ({count})", { count: pending.length }), { icon: "check", cls: "primary sm", href: `#/artefatti/${folder.id}/c/${pending[0].id}` }) : null),
    h("nav", { class: "tabs" }, TABS.map(([key, label, name]) => {
      const count = key === "commit" ? data.commits.length : key === "file" ? data.tree.length : key === "condivisione" ? data.shares.filter((share) => share.status !== "revoked").length : null;
      return h("a", { href: `#/artefatti/${folder.id}/${key}`, class: key === tab ? "active" : "" }, icon(name), h("span", {}, label), count ? h("i", { class: "count" }, raw(String(count))) : null);
    })),
    content,
  ], { title: folder.title, back: "#/artefatti" });
  document.querySelector(".tabs a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  const shown = tab === "commit" ? artifactTakes(data) : tab === "permessi" ? artifactPermissions(data) : tab === "condivisione" ? artifactShares(data) : tab === "registro" && data.canReview ? artifactLog(data) : artifactFiles(data, head, dir);
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
    const shown = await artifactPreview(`/api/artifacts/commits/${head.id}/files/${artifactPath(file.path)}`, file.path, file.size);
    if (chosen === file.path) preview.replaceChildren(...shown.flat().filter(Boolean));
    if (scroll && matchMedia("(max-width: 899px)").matches) preview.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const parts = dir ? dir.split("/") : [];
  const crumbs = h("nav", { class: "art-crumbs", "aria-label": tr("Dove sei nella cartella") },
    h("a", { href: artifactDirHref(folder.id, ""), class: parts.length ? "" : "on" }, icon("folder"), raw(folder.path.split("/").at(-1))),
    parts.map((part, index) => [h("span", { class: "sep", "aria-hidden": "true" }, "/"),
      h("a", { href: artifactDirHref(folder.id, parts.slice(0, index + 1).join("/")), class: index === parts.length - 1 ? "on" : "" }, raw(part))]).flat());
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
    if (!items.length || drop.classList.contains("busy")) return;
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
  const zone = h("div", { class: "stack-sm art-zone" }, drop, head || dir ? h("div", { class: "art-files" }, h("div", { class: "stack-sm" }, crumbs, list), head ? preview : null) : null);
  let depth = 0;
  zone.addEventListener("dragenter", (event) => { if (![...(event.dataTransfer?.types || [])].includes("Files")) return; event.preventDefault(); depth += 1; zone.classList.add("over"); });
  zone.addEventListener("dragover", (event) => { if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault(); });
  zone.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove("over"); });
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    depth = 0;
    zone.classList.remove("over");
    send(await droppedFiles(event.dataTransfer));
  });

  if (!head) {
    return panel({ icon: "file", title: "File", hint: data.commits.length ? "Nessuna versione è ancora in onda: approva un commit, o carica i primi file." : "Ancora nessun file: caricali da qui, o chiedi a un agente di farlo." }, zone);
  }
  const total = data.tree.reduce((sum, file) => sum + file.size, 0);
  const first = files.find((file) => /^index\.html?$/i.test(file.name)) || files.find((file) => /^readme/i.test(file.name)) || (dir ? null : files[0]);
  if (first) setTimeout(() => { const row = [...list.querySelectorAll("button.art-file")][files.indexOf(first)]; if (row) open(first, row, { scroll: false }); });
  return panel({ icon: "file", title: tr("File in onda"), hint: raw(tr("{count} file · {size} · commit {id}", { count: data.tree.length, size: fmtBytes(total), id: head.short })) }, zone);
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
function shareAccessPicker(access = {}) {
  const current = access.mode || "people";
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
    [["public", "Pubblico", "globe"], ["people", "Persone precise", "users"], ["password", "Con password", "key"]].map(([key, text, name]) => h("button", { type: "button", role: "radio", class: key === mode.value ? "on" : "", "aria-checked": String(key === mode.value), onclick: (event) => {
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
  return h("a", { class: "share-stats", href: `#/artefatti/${folderId}/registro?link=${shareId}` },
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
function artifactShares(data) {
  const { folder } = data;
  if (!data.shareHosting) {
    return panel({ icon: "link", title: "Condivisione" },
      h("p", { class: "notice" }, icon("info"), h("span", {}, "I link di condivisione hanno un indirizzo loro su usecora.space: ci sono quando questo spazio passa da lì.")));
  }
  const reload = () => renderArtifactFolder(folder.id, "condivisione");
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
        h("div", { class: "row tight" }, live ? h("a", { class: "share-url", href: share.url, target: "_blank", rel: "noopener" }, raw(share.url.replace(/^https:\/\//, "").replace(/\/$/, ""))) : h("span", { class: "share-url" }, raw(share.url.replace(/^https:\/\//, "").replace(/\/$/, ""))), badge(label, cls), badge(share.view === "files" ? "File" : "Sito", "", share.view === "files" ? "folder" : "globe")),
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
      ...access.nodes,
      h("div", { class: "row" }, field("Scadenza", expiry), h("span", { class: "spacer" }), btn("Crea il link", { icon: "link", cls: "primary", type: "submit" })));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const days = Number(values.get("expiry"));
      const created = await guard(api(`/api/artifacts/folders/${folder.id}/shares`, { method: "POST", body: {
        label: values.get("label"), view: view.value, expiresAt: days ? Date.now() + days * 86400000 : 0,
        access: access.value(),
      } }), "Link creato");
      if (created) reload();
    });
  }
  return [
    panel({ icon: "link", title: "Link di condivisione", hint: "Ogni link ha un indirizzo suo: pubblico, con una password, o solo per persone precise, che entrano con Google o con un link via email." },
      rows.length ? h("ul", { class: "share-list" }, rows) : empty("link", "Ancora nessun link per questa cartella.")),
    form ? panel({ icon: "plus", title: "Nuovo link" }, form) : null,
  ];
}

/** Who pushes, who reviews, whether it waits: rows that save as they change. */
function artifactPermissions(data) {
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
  const people = (data.people || []).filter((person) => person.role !== "owner");
  const reviewers = !data.canManage ? null : people.length ? h("div", { class: "set-switches" }, people.map((person) => h("label", { class: "switch" },
    h("input", { type: "checkbox", value: person.id, checked: folder.reviewers.includes(person.id) }), h("span", { class: "rocker" }),
    h("span", { class: "switch-text" }, raw(person.name), h("small", { class: "mono" }, raw(person.email || "")))))) : h("p", { class: "muted small" }, "Nessun altro entra in questo spazio: per ora rivedi solo tu.");
  const reviewersRow = data.canManage ? setRow("Revisori", "Oltre a te, chi può approvare o rifiutare i commit di questa cartella.", reviewers, { stack: true }) : null;
  if (people.length) reviewers?.addEventListener("change", () => save({ reviewers: [...reviewers.querySelectorAll("input")].filter((input) => input.checked).map((input) => input.value) }, reviewersRow));
  const removeRow = data.canManage ? setRow("Elimina la cartella", "Con tutte le versioni e i link. I file restano solo nei backup della notte.", armedButton("Elimina", "Conferma: elimina tutto", { onconfirm: async () => {
    if (await guard(api(`/api/artifacts/folders/${folder.id}`, { method: "DELETE" }), "Cartella eliminata")) location.hash = "#/artefatti";
  } })) : null;
  return [
    panel({ icon: "edit", title: "La cartella" }, setRows(titleRow, descriptionRow)),
    panel({ icon: "shield", title: "Permessi", hint: editable ? null : "Li cambiano il proprietario e i revisori della cartella." }, setRows(directRow, writersRow, reviewersRow, removeRow)),
  ];
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
  const decideBar = waiting && commit.canReview ? panel({ icon: "check", title: "La tua decisione", hint: commit.status === "conflict" ? "Rifiutalo, o forzalo: per i file in conflitto vince questo commit." : "Approvato, va in onda subito. Rifiutato, resta nella storia con la tua nota." },
    h("div", { class: "art-decide stack" }, note,
      h("div", { class: "row" }, h("span", { class: "spacer" }),
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
    commit.folder ? btn(raw(commit.folder.title || commit.folder.path), { icon: "back", href: `#/artefatti/${commit.folder.id}/commit`, cls: "ghost sm back-link art-back" }) : null,
    pageHead(raw(commit.message), h("span", { class: "art-head-meta" }, h("code", {}, raw(commit.short)), badge(label, cls),
      commit.folder ? h("a", { href: `#/artefatti/${commit.folder.id}` }, artifactPathLabel(commit.folder.path)) : null),
      commit.previewUrl ? [btn("Apri anteprima", { icon: "external", cls: "ghost", href: commit.previewUrl, target: "_blank" })] : null),
    h("div", { class: "art-byline" }, artifactAuthor(commit.author),
      commit.requestedBy?.name ? h("small", {}, tr("chiesto da {name}", { name: commit.requestedBy.name })) : null,
      h("small", {}, raw(fmtTime(new Date(commit.createdAt).toISOString(), true))), artifactCounts(commit.changes),
      commit.supersedes ? h("small", {}, tr("sostituisce una proposta precedente")) : null),
    commit.review ? h("p", { class: `notice${commit.status === "rejected" ? " warn" : ""}` }, icon(commit.status === "rejected" ? "close" : "check"),
      h("span", {}, tr(commit.review.decision === "reject" ? "Rifiutato da {name}" : commit.review.decision === "force" ? "Forzato in onda da {name}" : "Approvato da {name}", { name: commit.review.by?.name || "?" }),
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
  const toggle = (name) => () => { form = form === name ? "" : name; shown = null; draw(); };
  const newButton = btn("Nuovo segreto", { icon: "plus", cls: "primary", onclick: toggle("new") });
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
      if (what === "send") {
        const views = h("select", { name: "views", "aria-label": tr("Aperture") }, [1, 2, 3, 5].map((n) => h("option", { value: n }, n === 1 ? tr("Si apre una volta") : tr("Si apre {count} volte", { count: n }))));
        const days = h("select", { name: "days", "aria-label": tr("Scadenza") }, [[1, "Un giorno"], [7, "Una settimana"], [30, "Un mese"]].map(([n, label]) => h("option", { value: n, selected: n === 7 }, label)));
        const note = h("input", { type: "text", maxlength: 300, placeholder: tr("Per chi è (resta nel registro)"), "aria-label": tr("Per chi è") });
        extra.replaceChildren(h("div", { class: "vault-inline" }, views, days, note, btn("Crea il link", { icon: "send", cls: "sm primary", onclick: async () => {
          const made = await guard(api(`/api/secrets/${secret.name}/sends`, { method: "POST", body: { views: Number(views.value), days: Number(days.value), note: note.value } }));
          if (made) extra.replaceChildren(vaultLink(made.url, tr("Chi lo apre vede il segreto; poi il link sparisce. La chiave è nel link: la cassaforte non la conosce.")));
        } })));
      } else if (what === "replace") {
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
        btn("Manda", { icon: "send", cls: "sm ghost", onclick: () => open("send") }),
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
          btn("Approva", { icon: "check", cls: "sm primary", onclick: async () => {
            const made = await guard(api(`/api/secrets/sends/${item.id}/approve`, { method: "POST" }));
            if (made) { shown = { title: tr("Il link per {name}", { name: made.name }), link: vaultLink(made.url, tr("Mandalo tu a chi deve riceverlo: l'agente non lo vede.")) }; reload(); }
          } })))) : null,
      shown ? panel({ icon: "link", title: shown.title }, shown.link) : null,
      form === "new" ? newForm() : form === "ask" ? askForm() : null,
      panel({ icon: "key", title: "Cassaforte", hint: "Si usano per nome: un agente li mette nel suo hush e lancia i comandi con hush run, senza vederli." },
        data.secrets.length ? h("ul", { class: "vault-list" }, data.secrets.map(secretRow)) : empty("key", "Ancora nessun segreto. Mettine uno, oppure chiedilo con un link a chi lo ha.")),
      data.requests.length ? panel({ icon: "clock", title: "Aspettano di arrivare" },
        h("ul", { class: "vault-list" }, data.requests.map((request) => h("li", { class: "vault-row" },
          h("span", { class: "panel-ico" }, icon("link")),
          h("div", { class: "grow vault-text" }, h("b", { class: "vault-name" }, raw(request.name)), h("small", {}, raw([request.by?.name ? tr("chiesto da {name}", { name: request.by.name }) : "", tr("scade {when}", { when: fmtTime(new Date(request.expiresAt).toISOString(), true) })].filter(Boolean).join(" · ")))),
          data.canManage ? armedButton("Annulla", "Conferma", { icon: "close", cls: "sm", onconfirm: async () => { if (await guard(api(`/api/secrets/requests/${request.id}`, { method: "DELETE" }), "Richiesta annullata")) reload(); } }) : null)))) : null,
      live.length ? panel({ icon: "send", title: "Link di invio aperti" },
        h("ul", { class: "vault-list" }, live.map((item) => h("li", { class: "vault-row" },
          h("span", { class: "panel-ico" }, icon("send")),
          h("div", { class: "grow vault-text" }, h("b", { class: "vault-name" }, raw(item.name)), h("small", {}, raw([tr("si apre ancora {count} volte", { count: item.left }), tr("scade {when}", { when: fmtTime(new Date(item.expiresAt).toISOString(), true) }), item.note].filter(Boolean).join(" · ")))),
          data.canManage ? armedButton("Revoca", "Conferma", { cls: "sm", onconfirm: async () => { if (await guard(api(`/api/secrets/sends/${item.id}`, { method: "DELETE" }), "Link revocato")) reload(); } }) : null)))) : null,
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
  shell([pageHead("Contesto", "Le istruzioni del server e i file che tutti gli agenti leggono.", [upload, newButton, refresh]),
    h("small", { class: "context-upload-hint" }, "File .md e .txt · 30.000 caratteri per file · 60.000 caratteri attivi in totale"), fileInput, body], { title: "Contesto" });
  newButton.disabled = upload.disabled = true;
  load();
}

/* ---------- settings ---------- */
function subscriptionPlanLabel(plan) {
  // Meta names its tiers itself ("Muse Code High Usage"): those are shown as they come.
  return ({ free: "Free", pro: "Pro", plus: "Plus", max: "Max", team: "Team", enterprise: "Enterprise", business: "Business", self_serve_business_prolite: "Business" })[plan] || (/\s/.test(plan) ? plan : tr("Abbonamento attivo"));
}

/**
 * Settings → Permissions: the people in the chats the owner lets put the agents to work
 * on their computers, on every agent or on the ones chosen, so the agents stop asking
 * the owner for the go-ahead each time. Every change is saved at once; members only read.
 */
function permissionsPane() {
  const body = h("div", { class: "stack" }, h("p", { class: "muted", role: "status" }, "Caricamento…"));
  let data = null;
  let busy = false;
  const grants = () => data.people.filter((person) => person.agents.length).map(({ id, name, agents }) => ({ id, name, agents }));
  const save = async (next) => {
    if (busy) return;
    busy = true;
    for (const control of body.querySelectorAll("button, select")) control.disabled = true;
    try {
      data = await api("/api/permissions", { method: "PUT", body: { grants: next } });
      toast("Permessi aggiornati");
    } catch (error) { toast(error.message, true); }
    busy = false;
    draw();
  };
  const change = (id, agents) => save([...grants().filter((grant) => grant.id !== id), ...(agents.length ? [{ id, agents }] : [])]);
  const where = (person) => h("small", {}, icon(TRANSPORTS[person.transport]?.icon || "user"), raw(TRANSPORTS[person.transport]?.label || person.transport),
    person.last ? raw(` · ${tr("ultimo messaggio")} ${new Date(person.last).toLocaleDateString(LOCALE, { day: "numeric", month: "short" })}`) : null);
  const row = (person) => {
    const all = person.agents.includes("*");
    const agents = S.data.agents;
    const chip = (label, on, onclick) => h("button", { type: "button", class: `chip${on ? " on" : ""}`, "aria-pressed": String(on), disabled: !data.canManage, onclick }, label);
    const toggle = (agent) => {
      const chosen = all ? agents.map((item) => item.id) : person.agents;
      change(person.id, chosen.includes(agent.id) ? chosen.filter((id) => id !== agent.id) : [...chosen, agent.id]);
    };
    return h("div", { class: "permission" },
      h("div", { class: "permission-who" }, h("span", { class: "access-user-mark" }, icon("user")),
        h("div", { class: "grow" }, h("b", {}, raw(person.name)), where(person)),
        data.canManage ? btn("", { icon: "trash", cls: "ghost", title: tr("Togli il permesso a {name}", { name: person.name }), onclick: () => change(person.id, []) }) : null),
      h("div", { class: "chips", role: "group", "aria-label": tr("Agenti che {name} può far lavorare", { name: person.name }) },
        chip(tr("Tutti gli agenti"), all, () => !all && change(person.id, ["*"])),
        agents.map((agent) => chip(raw(agent.name), all || person.agents.includes(agent.id), () => toggle(agent)))));
  };
  const draw = () => {
    const granted = data.people.filter((person) => person.agents.length);
    const others = data.people.filter((person) => !person.agents.length);
    const pick = h("select", { "aria-label": tr("Persona da autorizzare") },
      h("option", { value: "" }, others.length ? "Scegli una persona…" : "Nessun altro ha scritto nei canali"),
      others.map((person) => h("option", { value: person.id }, raw(`${person.name} · ${TRANSPORTS[person.transport]?.label || person.transport}`))));
    const add = btn("Autorizza", { icon: "plus", cls: "primary", disabled: !others.length, onclick: () => {
      if (!pick.value) { pick.focus(); return; }
      change(pick.value, ["*"]);
    } });
    body.replaceChildren(
      granted.length ? h("div", { class: "permissions" }, granted.map(row))
        : h("p", { class: "access-no-rules" }, "Per ora solo tu fai lavorare gli agenti sul loro computer: per gli altri ti chiedono il via libera."),
      data.canManage ? h("div", { class: "access-add" }, pick, add)
        : h("p", { class: "access-note" }, icon("info"), h("span", {}, "Solo l'owner dà e toglie i permessi.")));
  };
  api("/api/permissions").then((value) => { data = value; draw(); })
    .catch((error) => body.replaceChildren(h("p", { class: "notice warn" }, icon("alert"), h("span", {}, raw(error.message)))));
  return panel({ icon: "user", title: "Chi può far lavorare gli agenti", hint: "Oltre a te: le persone che scrivono nei canali e possono chiedere agli agenti un lavoro sul loro computer senza che ti chiedano il via libera." }, body);
}

function instanceAccessPanel() {
  const current = S.data.currentUser;
  const identity = h("div", { class: "access-identity" }, icon("user"),
    h("div", { class: "grow" }, h("b", {}, raw(current?.name || current?.email || "Owner")), current?.email ? h("small", {}, raw(current.email)) : null),
    badge(current?.role === "member" ? "Utente" : "Owner", "on"));
  if (!S.data.access?.canManage) return panel({ icon: "shield", title: "Accesso all'istanza", hint: "Il tuo account e i permessi di questa Cora." }, identity,
    h("p", { class: "lead" }, "Puoi lavorare con gli agenti e usare tutte le funzioni operative. L'owner gestisce chi può entrare."));
  const body = h("div", { class: "stack" }, h("p", { class: "muted", role: "status" }, "Caricamento…"));
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
    return h("section", { class: "set-section access-rules" }, h("span", { class: "label" }, title), h("p", { class: "muted" }, hint),
      h("div", { class: "access-add" }, input, add),
      h("ul", {}, data[kind].length ? data[kind].map((value) => h("li", { class: "access-rule" }, icon(kind === "domains" ? "globe" : "user"), h("span", { class: "grow" }, raw((kind === "domains" ? "@" : "") + value)),
        btn("", { icon: "close", cls: "ghost", title: tr("Rimuovi {value}", { value }), onclick: () => update(() => api("/api/access", { method: "PUT", body: { [kind]: data[kind].filter((entry) => entry !== value) } })) })))
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
      h("p", { class: "lead" }, "Gli utenti ammessi hanno gli stessi permessi operativi. Solo l'owner può autorizzare o revocare gli accessi."),
      rules("domains", "Domini autorizzati", "Ammetti tutti gli account con un indirizzo verificato di questi domini.", "es. azienda.it"),
      rules("emails", "Singole persone", "Autorizza una persona senza aprire l'accesso a tutto il suo dominio.", "nome@azienda.it"),
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
  return panel({ icon: "shield", title: "Accesso all'istanza", hint: "Scegli chi può entrare nella tua Cora.", actions: refresh }, body);
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
    const on = [...list.querySelectorAll("input")].filter((input) => input.checked);
    if (!(await saveSettings({ [key]: on.map((input) => input.value) }, row()))) {
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
  const inUse = S.data.transport === kind;
  if (info.state === "missing-token") return ["off", tr("senza token")];
  if (info.state === "error") return ["err", tr("errore")];
  if (inUse) return [info.state === "ready" ? "on" : "busy", tr("in uso · {state}", { state: tr(STATE_LABEL[info.state] || info.state) })];
  return ["off", tr("pronto, non in uso")];
}

/** Moves Cora to another transport: the first tap says what goes off, the second does it. */
function transportButton(kind) {
  const info = transportInfo(kind);
  const label = tr("Usa {transport}", { transport: info.label });
  const button = btn(label, { icon: info.icon, cls: "primary", disabled: info.state === "missing-token", title: info.state === "missing-token" ? tr("Prima collega il bot") : null });
  let armed = false;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.classList.add("danger");
      button.lastChild.textContent = tr("Conferma: {transport} si spegne", { transport: TRANSPORTS[S.data.transport].label });
      setTimeout(() => {
        armed = false;
        button.classList.remove("danger");
        button.lastChild.textContent = label;
      }, 4000);
      return;
    }
    button.disabled = true;
    if (await guard(api("/api/settings", { method: "PUT", body: { transport: kind } }), tr("Cora ora vive su {transport}", { transport: info.label }))) {
      await loadState();
      renderSettings();
    } else button.disabled = false;
  });
  return button;
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

  /* ---------- Canali ---------- */
  const listenRow = (kind) => {
    const inUse = S.data.transport === kind;
    return inUse
      ? setRow(tr("Cora vive su {transport}", { transport: TRANSPORTS[kind].label }), "Gli altri canali sono spenti. Il salotto del pannello c'è sempre.")
      : setRow("Canale di Cora", tr("Un canale alla volta: passando a {transport}, {current} si spegne.", { transport: TRANSPORTS[kind].label, current: TRANSPORTS[S.data.transport].label }), transportButton(kind));
  };
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
            : telegram.state === "idle" || telegram.state === "stopped" ? "Il token c'è: il bot si collega quando Cora passa su Telegram."
              : telegram.state === "error" ? tr("Il token non funziona: {error}.", { error: telegram.error }) : "Serve un bot che ascolti.",
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
    if (await guard(api("/api/slack/channels"), "Canali aggiornati")) {
      await loadState();
      renderSettings();
    }
  } });
  let slackRow;
  page("slack",
    panel({ icon: "slack", title: "Slack", hint: "Un'app per ogni agente, così è un utente vero: la menzioni e le scrivi in privato.", actions: channelBadge("slack") },
      setRows(listenRow("slack"),
        setRow("App principale",
          slack.user ? h("span", {}, h("b", {}, raw(`@${slack.user.username}`)), raw(`${slack.team ? ` · ${slack.team.name}` : ""} · ${tr(STATE_LABEL[slack.state] || slack.state)}${slack.error ? ` (${slack.error})` : ""}`))
            : slack.state === "idle" || slack.state === "stopped" ? "I token ci sono: l'app si collega quando Cora passa su Slack."
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
        slackRow = setRow("Canali", slack.channels?.length ? "Le app sentono solo i canali accesi." : "Invita un'app in un canale (/invite): il canale compare qui e lo accendi.",
          slack.channels?.length ? switchList(slack.channels.map((channel) => ({ id: channel.id, name: `#${channel.name}`, sub: tr(channel.private ? "canale privato" : "canale pubblico") })), settings.slackChannelIds, "slackChannelIds", () => slackRow) : null, { stack: true }),
        ownersRow("slackOwnerIds", "ID utente Slack. Se è vuoto diventa proprietario chi possiede il workspace, appena scrive."))),
    panel({ icon: "user", title: "Aspetto delle app", hint: "Nome, descrizione e immagine di ogni app seguono il pannello." }, slackAppsField()));

  /* ---------- Abbonamenti e chiavi ---------- */
  const providers = SUBSCRIPTION_HARNESSES.filter((provider) => provider === "claude" || provider === "codex" || S.data.providers?.[provider] || S.data.subscriptions?.some((item) => item.provider === provider));
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
    residentList.replaceChildren(...providers.map((provider) => residentRow(provider, () => show(provider))));
    for (const [provider, slot] of residentSlots) slot.replaceChildren(residentRow(provider));
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
    page(provider,
      panel({ icon: SUBSCRIPTION_ICONS[provider], title: SUBSCRIPTION_NAMES[provider], hint: tr("Lo usa {cli}, per gli agenti che lo scelgono nel loro Cervello.", { cli: CLI_NAMES[provider] }), actions: (() => { const [led, line] = providerState(provider); return badge(raw(line), led === "on" ? "on" : led === "busy" ? "warn" : "", led === "on" ? "check" : "user"); })() },
        h("div", { class: "set-section" }, h("span", { class: "label" }, "Su questo server"), residentSlots.get(provider)),
        h("div", { class: "set-section" }, h("span", { class: "label" }, "Altri account"),
          h("p", { class: "muted" }, "Collegane quanti vuoi, dal browser: nel profilo di ogni agente scegli quale usa."),
          subscriptionAccounts(provider, { onChange: () => drawNav() }))));
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
      : provider === "soniox" ? h("p", {}, "Gli agenti ascoltano i messaggi vocali e rispondono con una voce loro. La voce di ogni agente si sceglie nel suo profilo.")
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

  /* ---------- Persone ---------- */
  page("permessi", permissionsPane());
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
  const people = (settings.permissions || []).length;
  const keyCount = settings.sshKeys.length;
  entries = [
    ...["discord", "telegram", "slack"].map((kind) => ({ id: kind, group: "Canali", label: TRANSPORTS[kind].label, mark: TRANSPORTS[kind].icon, state: () => channelState(kind) })),
    { id: "server", group: "Abbonamenti", label: "Account del server", mark: "monitor", state: () => [null, settings.useResidentSubscriptions ? tr("in uso per chi non sceglie") : tr("non usati")] },
    ...providers.map((provider) => ({ id: provider, group: "Abbonamenti", label: SUBSCRIPTION_NAMES[provider], mark: SUBSCRIPTION_ICONS[provider], state: () => providerState(provider) })),
    ...CONNECTION_KEYS.map(([provider, name, mark]) => ({ id: provider, group: "Chiavi API", label: name, mark, state: () => keyState(provider) })),
    { id: "regia", group: "Agenti", label: "Regia", mark: "sliders", state: () => [null, tr("{turns} messaggi · obiettivi {goals}", { turns: S.data.settings.maxAgentTurns, goals: tr(S.data.settings.goalMode ? "accesi" : "spenti") })] },
    { id: "modelli", group: "Agenti", label: "Modelli e sonno", mark: "chip", state: () => {
      const known = S.data.models.find((item) => item.id === S.data.settings.defaultModel);
      return [known && known.usable !== false ? null : "warn", S.data.settings.defaultModel || tr("nessun modello")];
    } },
    { id: "permessi", group: "Persone", label: "Permessi", mark: "user", state: () => [null, people ? (people === 1 ? tr("1 persona oltre a te") : tr("{count} persone oltre a te", { count: people })) : tr("solo tu")] },
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
      items.push(h("button", { type: "button", class: `rail-item${active ? " active" : ""}`, "aria-current": active ? "page" : null, "data-page": entry.id, onclick: () => show(entry.id) },
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
  closeAccountMenu();
  if (!S.data) return;
  const [page] = route();
  S.live = null;
  if (page === "agent") await renderAgent();
  else if (page === "banco") await renderDashboard();
  else if (page === "agenti") renderAgents();
  else if (page === "new") renderNew();
  else if (page === "archivio") renderRoutineArchive();
  else if (page === "contesto") renderContext();
  else if (page === "brain") renderBrain();
  else if (page === "artefatti") renderArtifacts();
  else if (page === "settings") renderSettings();
  else if (page === "salotto") renderSalotto();
  else renderAgents();
}

document.documentElement.lang = LANG;
document.title = "Cora · Computer-Operating Resident Agents";

/** While the state loads, the page being opened in outline: its own name, not always the agents page. */
const BOOT_TITLES = { agenti: "Agenti", agent: "Agente", new: "Nuovo agente", salotto: "Salotto", banco: "Banco", contesto: "Contesto", brain: "Brain", artefatti: "Artefatti", settings: "Impostazioni", archivio: "Archivio" };

function bootSkeleton() {
  const [section] = route();
  const title = BOOT_TITLES[section] || "Agenti";
  if (title === "Agenti") {
    return [[
      pageHead("Agenti", skeletonLine("sk-caption")),
      panel({ icon: "chart", title: "Consumi globali" }, skeleton("heat")),
      panel({ icon: "users", title: "Gli agenti" }, skeleton()),
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
window.addEventListener("resize", () => closeAccountMenu());
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && S.accountMenu) closeAccountMenu(true); });
boot();
