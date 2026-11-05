/**
 * A shared folder of files, the way a drive shows one: folders and files as
 * cards or rows, a search over the whole folder, a page per file with its
 * preview and a download, and the whole folder as one zip. Everything is
 * rendered here, on the server: the pages run no script.
 */
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function fmtBytes(value) {
  let size = Number(value) || 0;
  const units = ["B", "KB", "MB", "GB"];
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size < 10 && unit ? 1 : 0)} ${units[unit]}`;
}

const GROUPS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"],
  video: ["mp4", "webm", "m4v", "mov"],
  audio: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
  pdf: ["pdf"],
  sheet: ["csv", "tsv", "xls", "xlsx", "ods", "numbers"],
  doc: ["doc", "docx", "odt", "rtf", "pages"],
  slides: ["ppt", "pptx", "odp", "key"],
  archive: ["zip", "gz", "tgz", "tar", "rar", "7z"],
  text: ["txt", "md", "markdown", "log", "json", "xml", "yml", "yaml", "toml", "ini", "env.example", "html", "htm", "css", "js", "mjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "sh", "sql", "svg", "vue", "php"],
};
const extension = (name) => (String(name).includes(".") ? String(name).split(".").pop().toLowerCase() : "");
export function kindOf(name) {
  const ext = extension(name);
  for (const [kind, list] of Object.entries(GROUPS)) if (list.includes(ext)) return kind;
  return "other";
}
const TEXT_PREVIEW = new Set(["text", "sheet"]);

const ICONS = {
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.5h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4"/>',
  video: '<rect x="3.5" y="6" width="12.5" height="12" rx="2"/><path d="m16 10.5 4.5-2.5v8l-4.5-2.5"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.75" cy="6.5" r=".9"/><circle cx="4.75" cy="12" r=".9"/><circle cx="4.75" cy="17.5" r=".9"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  prev: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  zip: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M11 6v1.5M11 9.5v1.5M11 13v2"/>',
};
const icon = (name, cls = "") => `<svg class="ico${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3.4"><circle cx="32" cy="32" r="18.5"/><g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="18.5" ry="5.6" stroke-opacity="0.38"/><path d="M13.5 32A18.5 5.6 0 0 0 50.5 32"/></g></g></svg>`;

const WORDS = {
  it: {
    search: "Cerca nei file", find: "Cerca", grid: "Griglia", list: "Elenco", all: "Scarica tutto", leave: "Esci",
    folders: "Cartelle", files: "File", results: "Risultati per «{q}»", none: "Nessun file si chiama così.", empty: "Questa cartella è vuota.",
    count: "{count} file", count1: "1 file", sharedBy: "Condiviso da {name}", updated: "aggiornato {when}", download: "Scarica", open: "Apri",
    name: "Nome", size: "Dimensione", type: "Tipo", noPreview: "Nessuna anteprima per questo tipo di file", tooBig: "Troppo grande per l'anteprima: scaricalo per aprirlo.",
    source: "Il sorgente, come testo: scaricalo per aprirlo.", rows: "Le prime {count} righe", prev: "File precedente", next: "File successivo", in: "in {dir}",
    kinds: { folder: "Cartella", image: "Immagine", video: "Video", audio: "Audio", pdf: "PDF", sheet: "Foglio", doc: "Documento", slides: "Presentazione", archive: "Archivio", text: "Testo", other: "File" },
  },
  en: {
    search: "Search the files", find: "Search", grid: "Grid", list: "List", all: "Download all", leave: "Sign out",
    folders: "Folders", files: "Files", results: "Results for “{q}”", none: "No file is called that.", empty: "This folder is empty.",
    count: "{count} files", count1: "1 file", sharedBy: "Shared by {name}", updated: "updated {when}", download: "Download", open: "Open",
    name: "Name", size: "Size", type: "Type", noPreview: "No preview for this kind of file", tooBig: "Too large to preview: download it to open it.",
    source: "The source, as text: download it to open it.", rows: "The first {count} rows", prev: "Previous file", next: "Next file", in: "in {dir}",
    kinds: { folder: "Folder", image: "Image", video: "Video", audio: "Audio", pdf: "PDF", sheet: "Sheet", doc: "Document", slides: "Slides", archive: "Archive", text: "Text", other: "File" },
  },
};

const STYLE = `:root{color-scheme:dark;--bg:#050505;--panel:#0f0f0f;--panel2:#171717;--well:#000;--line:#232323;--line2:#353535;--text:#f5f5f3;--muted:#8f8f8a;--faint:#5c5c58;--amber:#f2a93b;--wash:rgba(242,169,59,.08);--green:#8cc56a;--coral:#ff9c8b}
*{box-sizing:border-box}html,body{margin:0}body{min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.5 "Manrope","Helvetica Neue",Arial,sans-serif}
a{color:inherit;text-decoration:none}.ico{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.top{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px;padding:14px max(16px,calc((100vw - 1180px)/2));background:rgba(5,5,5,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 260px}.mark{width:34px;height:34px;flex:none;color:var(--amber)}
.brand b{display:block;font:600 19px/1.15 "Outfit","Helvetica Neue",Arial,sans-serif;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.brand small{display:block;color:var(--faint);font:400 11.5px/1.4 "DM Mono",ui-monospace,monospace;letter-spacing:.04em}
.search{display:flex;align-items:center;gap:8px;flex:1 1 280px;max-width:460px;height:42px;padding:0 6px 0 12px;border:1px solid var(--line2);border-radius:12px;background:var(--well)}.search:focus-within{border-color:var(--amber);box-shadow:0 0 0 3px rgba(242,169,59,.25)}
.search .ico{color:var(--faint)}.search input{flex:1;min-width:0;height:100%;border:0;background:none;color:var(--text);font:400 15px/1 "Manrope",Arial,sans-serif;outline:none}.search button{height:30px;padding:0 12px;border:0;border-radius:8px;background:var(--panel2);color:var(--muted);font:600 11px/1 "DM Mono",monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.tools{display:flex;align-items:center;gap:6px}.tool{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:10px;color:var(--muted);font:600 11px/1 "DM Mono",monospace;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}.tool:hover{color:var(--text);border-color:var(--line2)}.tool.on{color:var(--amber);border-color:rgba(242,169,59,.38);background:var(--wash)}.tool.primary{background:var(--amber);border-color:var(--amber);color:#1d1b18}
.page{width:100%;max-width:1212px;margin:0 auto;padding:20px 16px 56px}
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;margin:0 0 18px;font:400 13px/1.3 "DM Mono",monospace;color:var(--muted)}.crumbs a{display:inline-flex;align-items:center;gap:7px;padding:5px 7px;border-radius:7px}.crumbs .ico{width:15px;height:15px}.crumbs a:hover{background:var(--panel2);color:var(--text)}.crumbs .on{color:var(--amber)}.crumbs .sep{color:var(--faint)}
h2{margin:26px 0 12px;color:var(--faint);font:500 11px/1 "DM Mono",monospace;letter-spacing:.14em;text-transform:uppercase}h2:first-of-type{margin-top:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:14px}
.card{position:relative;display:flex;flex-direction:column;min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;transition:border-color .15s,transform .15s}.card:hover{border-color:rgba(242,169,59,.45);transform:translateY(-1px)}
.card .open{display:flex;flex-direction:column;min-width:0;flex:1}.thumb{position:relative;display:grid;place-items:center;aspect-ratio:4/3;background:var(--well);border-bottom:1px solid var(--line);overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover}
.thumb.pic{background:conic-gradient(#121212 25%,#0a0a0a 0 50%,#121212 0 75%,#0a0a0a 0) 0 0/16px 16px}
.thumb.text{place-items:start;padding:12px 14px;background:linear-gradient(180deg,#0d0d0d,#000)}.snippet{display:block;width:100%;white-space:pre;overflow:hidden;color:var(--muted);font:400 9.5px/1.5 "DM Mono",ui-monospace,monospace;-webkit-mask-image:linear-gradient(180deg,#000 60%,transparent);mask-image:linear-gradient(180deg,#000 60%,transparent)}
.thumb .ext{position:absolute;left:10px;bottom:8px;padding:3px 6px;border:1px solid var(--line2);border-radius:6px;background:#0b0b0b;color:var(--muted);font:600 9.5px/1 "DM Mono",monospace;letter-spacing:.12em;font-style:normal;text-transform:uppercase}
.badge{display:grid;place-items:center;gap:8px;color:var(--muted)}.badge .ico{width:34px;height:34px;stroke-width:1.3}.badge em{font:600 10.5px/1 "DM Mono",monospace;letter-spacing:.12em;font-style:normal;text-transform:uppercase;padding:4px 7px;border-radius:6px;border:1px solid currentColor}
.k-pdf .badge{color:var(--coral)}.k-image .badge,.k-video .badge,.k-audio .badge{color:var(--green)}.k-sheet .badge,.k-doc .badge,.k-slides .badge{color:var(--amber)}.k-archive .badge,.k-other .badge{color:var(--faint)}
.meta{display:grid;gap:3px;padding:10px 12px 12px}.meta b{font:500 13.5px/1.35 "Manrope",Arial,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:var(--faint);font:400 11.5px/1.3 "DM Mono",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .dl{position:absolute;top:8px;right:8px;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:rgba(5,5,5,.78);border:1px solid var(--line2);color:var(--text);opacity:0;transition:opacity .15s}.card:hover .dl,.card .dl:focus{opacity:1}@media (hover:none){.card .dl{opacity:1}}
.folder{flex-direction:row;align-items:center}.folder .open{flex-direction:row;align-items:center;gap:12px;padding:14px}.folder .open>.ico{width:24px;height:24px;color:var(--amber)}.folder .meta{padding:0;min-width:0}
.rows{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}.row{display:grid;grid-template-columns:minmax(0,1fr) 110px 120px 44px;align-items:center;gap:12px;padding:0 10px 0 14px;min-height:52px;border-top:1px solid var(--line)}.row:first-child{border-top:0}.row:hover{background:var(--wash)}
.row .open{display:flex;align-items:center;gap:12px;min-width:0;padding:10px 0}.row .open span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .open small{display:block;color:var(--faint);font:400 11.5px/1.3 "DM Mono",monospace}.row .k{color:var(--muted)}.row .k-pdf .ico{color:var(--coral)}
.row>small{color:var(--faint);font:400 12px/1 "DM Mono",monospace}.row .dl{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--muted)}.row .dl:hover{background:var(--panel2);color:var(--text)}.row.head{min-height:36px;color:var(--faint);font:500 10.5px/1 "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase}.row.head:hover{background:none}
.note{padding:40px 16px;text-align:center;color:var(--faint);font:400 13px/1.5 "DM Mono",monospace;border:1px dashed var(--line2);border-radius:14px}
.foot{display:flex;flex-wrap:wrap;gap:8px 18px;justify-content:space-between;margin-top:28px;color:var(--faint);font:400 11px/1.4 "DM Mono",monospace;letter-spacing:.06em;text-transform:uppercase}.foot a{color:var(--muted)}
.bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:10px max(14px,calc((100vw - 1212px)/2 + 16px));background:rgba(5,5,5,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.bar .title{flex:1;min-width:0}.bar .title b{display:block;font:600 16px/1.25 "Outfit","Helvetica Neue",Arial,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar .title small{color:var(--faint);font:400 11.5px/1.3 "DM Mono",monospace}
.round{display:grid;place-items:center;width:38px;height:38px;flex:none;border:1px solid var(--line);border-radius:10px;color:var(--muted)}.round:hover{color:var(--text);border-color:var(--line2)}.round.off{opacity:.3;pointer-events:none}
.stage{display:grid;place-items:center;gap:10px;min-height:calc(100vh - 60px);padding:20px 16px 40px}.stage.top{align-content:start}.stage img,.stage video{max-width:min(100%,1180px);max-height:calc(100vh - 120px);border-radius:10px;background:var(--well)}.stage audio{width:min(100%,560px)}.stage iframe{width:min(100%,1180px);height:calc(100vh - 110px);border:1px solid var(--line);border-radius:10px;background:#fff}
.textview{width:min(100%,1180px);margin:0;padding:16px 0;border:1px solid var(--line);border-radius:12px;background:var(--well);overflow:auto;max-height:calc(100vh - 120px);font:400 13px/1.6 "DM Mono",ui-monospace,monospace;counter-reset:line;align-self:start}.textview span{display:block;padding:0 18px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.textview span::before{counter-increment:line;content:counter(line);display:inline-block;width:52px;margin-right:16px;padding-right:12px;text-align:right;color:var(--faint);border-right:1px solid var(--line)}
.sheetview{width:min(100%,1180px);overflow:auto;max-height:calc(100vh - 120px);border:1px solid var(--line);border-radius:12px;align-self:start}.sheetview table{border-collapse:collapse;font:400 13px/1.4 "DM Mono",monospace;min-width:100%}.sheetview td,.sheetview th{padding:8px 12px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);white-space:nowrap;text-align:left}.sheetview th{position:sticky;top:0;background:var(--panel2);color:var(--muted);font-weight:500}
.caption{width:min(100%,1180px);margin:0;color:var(--faint);font:400 12px/1.4 "DM Mono",monospace}
.nopreview{display:grid;justify-items:center;gap:14px;color:var(--muted);text-align:center}.nopreview .ico{width:64px;height:64px;stroke-width:1.1;color:var(--faint)}
@media (max-width:640px){.top{padding:12px 14px}.tools .label{display:none}.grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}.row{grid-template-columns:minmax(0,1fr) 44px}.row>small{display:none}.bar .label{display:none}}`;

const counted = (words, n) => (n === 1 ? words.count1 : words.count.replace("{count}", n));

/** A path as a link on this host, each segment encoded. */
const href = (path) => `/${String(path).split("/").map(encodeURIComponent).join("/")}`;
const viewHref = (path) => `/_cora/view${href(path)}`;
const dirHref = (dir) => (dir ? `${href(dir)}/` : "/");

function crumbs(folderName, dir, words) {
  const parts = dir ? dir.split("/") : [];
  const items = [`<a class="${parts.length ? "" : "on"}" href="/">${icon("folder")}${esc(folderName)}</a>`];
  parts.forEach((part, index) => items.push(`<span class="sep">/</span><a class="${index === parts.length - 1 ? "on" : ""}" href="${esc(dirHref(parts.slice(0, index + 1).join("/")))}">${esc(part)}</a>`));
  return `<nav class="crumbs" aria-label="${esc(words.folders)}">${items.join("")}</nav>`;
}

function page(lang, title, csp, body) {
  return { csp, html: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>` };
}
const BROWSE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/**
 * A folder of the share as a drive shows it. `tree` is the served version,
 * `dir` the folder being looked at ("" for the top), `q` a search over everything.
 */
export function browse({ lang, tree, dir, q = "", mode = "grid", title, sharedBy = "", updatedAt = 0, signedIn = false, zip = true, read = null }) {
  const words = WORDS[lang] || WORDS.it;
  const here = dir ? `${dir}/` : "";
  const query = String(q || "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const folders = new Map();
  const files = [];
  for (const [path, file] of tree) {
    if (terms.length) {
      if (terms.every((term) => path.toLowerCase().includes(term))) files.push({ path, name: path.split("/").at(-1), where: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", ...file });
      continue;
    }
    if (!path.startsWith(here)) continue;
    const rest = path.slice(here.length);
    const slash = rest.indexOf("/");
    if (slash === -1) files.push({ path, name: rest, ...file });
    else {
      const name = rest.slice(0, slash);
      const entry = folders.get(name) || { name, path: `${here}${name}`, count: 0, size: 0 };
      entry.count += 1;
      entry.size += file.size;
      folders.set(name, entry);
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, lang) || a.path.localeCompare(b.path));
  const total = [...tree.values()].reduce((sum, file) => sum + file.size, 0);
  const keep = (extra) => { const params = new URLSearchParams(); if (query) params.set("q", q); if (mode === "list") params.set("v", "list"); for (const [key, value] of Object.entries(extra)) { if (value) params.set(key, value); else params.delete(key); } const text = params.toString(); return text ? `?${text}` : "?"; };
  const sub = (file) => `${fmtBytes(file.size)}${file.where !== undefined ? ` · ${file.where ? esc(file.where) : "/"}` : ""}`;
  let snippets = 0;
  const thumb = (file) => {
    const kind = kindOf(file.name);
    if (kind === "image" && file.size <= 25 * 1024 * 1024) return `<span class="thumb pic"><img loading="lazy" decoding="async" src="${esc(href(file.path))}" alt=""></span>`;
    // The first lines of a text, the way a drive shows a document's first page.
    if (read && TEXT_PREVIEW.has(kind) && file.size && file.size <= 256 * 1024 && snippets < 60) {
      snippets += 1;
      const data = read(file.sha, 256 * 1024);
      if (data && !data.subarray(0, 4096).includes(0)) {
        const lines = data.subarray(0, 1600).toString("utf8").split("\n").slice(0, 9).map((line) => esc(line.slice(0, 80)) || " ");
        return `<span class="thumb text"><span class="snippet">${lines.join("\n")}</span><em class="ext">${esc(extension(file.name))}</em></span>`;
      }
    }
    return `<span class="thumb"><span class="badge">${icon(["image", "video", "audio"].includes(kind) ? kind : kind === "archive" ? "zip" : "file")}<em>${esc(extension(file.name) || words.kinds[kind])}</em></span></span>`;
  };
  const download = (file) => `<a class="dl" href="${esc(href(file.path))}?download=1" title="${esc(words.download)}" aria-label="${esc(`${words.download} ${file.name}`)}">${icon("download")}</a>`;
  let content;
  if (mode === "list") {
    const rows = [
      ...[...folders.values()].sort((a, b) => a.name.localeCompare(b.name, lang)).map((folder) => `<div class="row"><a class="open" href="${esc(dirHref(folder.path))}">${icon("folder")}<span>${esc(folder.name)}</span></a><small>${esc(counted(words, folder.count))}</small><small>${esc(words.kinds.folder)}</small><span></span></div>`),
      ...files.map((file) => { const kind = kindOf(file.name); return `<div class="row k-${kind}"><a class="open" href="${esc(viewHref(file.path))}"><span class="k">${icon(["image", "video", "audio"].includes(kind) ? kind : "file")}</span><span>${esc(file.name)}${file.where !== undefined ? `<small>${esc(file.where || "/")}</small>` : ""}</span></a><small>${fmtBytes(file.size)}</small><small>${esc(words.kinds[kind])}</small>${download(file)}</div>`; }),
    ];
    content = rows.length ? `<div class="rows"><div class="row head"><span>${esc(words.name)}</span><span>${esc(words.size)}</span><span>${esc(words.type)}</span><span></span></div>${rows.join("")}</div>` : "";
  } else {
    const folderCards = [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, lang)).map((folder) => `<div class="card folder"><a class="open" href="${esc(dirHref(folder.path))}">${icon("folder")}<span class="meta"><b>${esc(folder.name)}</b><small>${esc(counted(words, folder.count))} · ${fmtBytes(folder.size)}</small></span></a></div>`);
    const fileCards = files.map((file) => `<div class="card k-${kindOf(file.name)}"><a class="open" href="${esc(viewHref(file.path))}">${thumb(file)}<span class="meta"><b title="${esc(file.name)}">${esc(file.name)}</b><small>${sub(file)}</small></span></a>${download(file)}</div>`);
    content = [
      folderCards.length ? `<h2>${esc(words.folders)}</h2><div class="grid">${folderCards.join("")}</div>` : "",
      fileCards.length ? `<h2>${esc(terms.length ? words.results.replace("{q}", q) : words.files)}</h2><div class="grid">${fileCards.join("")}</div>` : "",
    ].join("");
  }
  if (!content) content = `<p class="note">${esc(terms.length ? words.none : words.empty)}</p>`;
  else if (terms.length && mode === "list") content = `<h2>${esc(words.results.replace("{q}", q))}</h2>${content}`;
  const subtitle = [sharedBy ? words.sharedBy.replace("{name}", sharedBy) : "", counted(words, tree.size), fmtBytes(total)].filter(Boolean).join(" · ");
  const body = `<header class="top">
<a class="brand" href="/">${MARK}<span><b>${esc(title)}</b><small>${esc(subtitle)}</small></span></a>
<form class="search" action="${esc(dirHref(dir))}" method="get" role="search">${icon("search")}<input type="search" name="q" value="${esc(q)}" placeholder="${esc(words.search)}" aria-label="${esc(words.search)}">${mode === "list" ? '<input type="hidden" name="v" value="list">' : ""}<button type="submit">${esc(words.find)}</button></form>
<nav class="tools"><a class="tool${mode === "grid" ? " on" : ""}" href="${esc(keep({ v: "" }))}" title="${esc(words.grid)}">${icon("grid")}<span class="label">${esc(words.grid)}</span></a><a class="tool${mode === "list" ? " on" : ""}" href="${esc(keep({ v: "list" }))}" title="${esc(words.list)}">${icon("list")}<span class="label">${esc(words.list)}</span></a>${zip && tree.size ? `<a class="tool primary" href="/_cora/zip${dir ? `?dir=${encodeURIComponent(dir)}` : ""}">${icon("download")}<span class="label">${esc(words.all)}</span></a>` : ""}</nav>
</header>
<div class="page">${terms.length ? "" : crumbs(title, dir, words)}${content}
<footer class="foot"><span>${esc(updatedAt ? words.updated.replace("{when}", new Date(updatedAt).toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { day: "numeric", month: "long", year: "numeric" })) : "")}</span>${signedIn ? `<a href="/_cora/logout">${esc(words.leave)}</a>` : ""}</footer></div>`;
  return page(lang, terms.length ? `${q} · ${title}` : dir ? `${dir.split("/").at(-1)} · ${title}` : title, BROWSE_CSP, body);
}

function csvRows(text, separator, limit) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < limit; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === separator) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if ((cell || row.length) && rows.length < limit) { row.push(cell); rows.push(row); }
  return rows;
}

/** One file of the share on a page of its own: its preview, its neighbours, and a download. */
export function viewer({ lang, file, siblings, title, read }) {
  const words = WORDS[lang] || WORDS.it;
  const kind = kindOf(file.path);
  const name = file.path.split("/").at(-1);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const index = siblings.indexOf(file.path);
  const prev = index > 0 ? siblings[index - 1] : "";
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : "";
  const raw = href(file.path);
  let stage;
  if (kind === "image") stage = `<img src="${esc(raw)}" alt="${esc(name)}">`;
  else if (kind === "video") stage = `<video src="${esc(raw)}" controls playsinline preload="metadata"></video>`;
  else if (kind === "audio") stage = `<audio src="${esc(raw)}" controls preload="metadata"></audio>`;
  else if (kind === "pdf") stage = `<iframe src="${esc(raw)}" title="${esc(name)}"></iframe>`;
  else if (TEXT_PREVIEW.has(kind) && ["csv", "tsv"].includes(extension(name))) {
    const data = read(512 * 1024);
    if (!data) stage = `<div class="nopreview">${icon("file")}<p>${esc(words.tooBig)}</p></div>`;
    else {
      const rows = csvRows(data.toString("utf8"), extension(name) === "tsv" ? "\t" : (data.toString("utf8").split("\n")[0].split(";").length > data.toString("utf8").split("\n")[0].split(",").length ? ";" : ","), 501);
      const [headRow = [], ...rest] = rows;
      stage = `<p class="caption">${esc(words.rows.replace("{count}", Math.min(rest.length, 500)))}</p><div class="sheetview"><table><thead><tr>${headRow.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rest.slice(0, 500).map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
  } else if (TEXT_PREVIEW.has(kind)) {
    const data = read(512 * 1024);
    if (!data || data.subarray(0, 8192).includes(0)) stage = `<div class="nopreview">${icon("file")}<p>${esc(words.tooBig)}</p></div>`;
    else {
      const source = ["html", "htm", "svg", "js", "mjs", "xml"].includes(extension(name)) ? `<p class="caption">${esc(words.source)}</p>` : "";
      stage = `${source}<pre class="textview">${data.toString("utf8").replace(/\n$/, "").split("\n").map((line) => `<span>${esc(line) || " "}</span>`).join("")}</pre>`;
    }
  } else stage = `<div class="nopreview">${icon(kind === "archive" ? "zip" : "file")}<p>${esc(words.noPreview)}</p><a class="tool primary" href="${esc(raw)}?download=1">${icon("download")}<span>${esc(words.download)} · ${fmtBytes(file.size)}</span></a></div>`;
  const body = `<header class="bar">
<a class="round" href="${esc(dirHref(dir))}" title="${esc(dir || title)}" aria-label="${esc(dir || title)}">${icon("back")}</a>
<div class="title"><b>${esc(name)}</b><small>${esc(words.kinds[kind])} · ${fmtBytes(file.size)} · ${esc(dir ? words.in.replace("{dir}", dir) : title)}</small></div>
<a class="round${prev ? "" : " off"}" href="${prev ? esc(viewHref(prev)) : "#"}" title="${esc(words.prev)}" aria-label="${esc(words.prev)}">${icon("prev")}</a>
<a class="round${next ? "" : " off"}" href="${next ? esc(viewHref(next)) : "#"}" title="${esc(words.next)}" aria-label="${esc(words.next)}">${icon("next")}</a>
<a class="tool primary" href="${esc(raw)}?download=1">${icon("download")}<span class="label">${esc(words.download)}</span></a>
</header><main class="stage${TEXT_PREVIEW.has(kind) ? " top" : ""}">${stage}</main>`;
  return page(lang, `${name} · ${title}`, "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", body);
}

/* ---------- the whole folder as one zip, stored, streamed in one pass ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(crc, chunk) {
  let c = ~crc;
  for (let i = 0; i < chunk.length; i += 1) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** At most this much in one zip: past it the format needs zip64, and a folder that big is better downloaded in parts. */
export const ZIP_LIMIT = 2 * 1024 * 1024 * 1024 - 1;

/**
 * Writes `entries` ({name, size, open() → readable}) to `out` as a zip, each file
 * stored as it is and its checksum computed on the way through.
 */
export async function writeZip(out, entries, when = new Date()) {
  const { time, day } = dosTime(when);
  const central = [];
  let offset = 0;
  const write = (buffer) => new Promise((resolve, reject) => {
    offset += buffer.length;
    if (out.write(buffer)) resolve();
    else { out.once("drain", resolve); out.once("error", reject); }
  });
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0808, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt16LE(name.length, 26);
    const start = offset;
    await write(Buffer.concat([header, name]));
    let crc = 0;
    let size = 0;
    for await (const chunk of entry.open()) {
      crc = crc32(crc, chunk);
      size += chunk.length;
      await write(chunk);
    }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await write(descriptor);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0808, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(day, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(size, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(start, 42);
    central.push(Buffer.concat([record, name]));
  }
  const directory = Buffer.concat(central);
  const at = offset;
  await write(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(at, 16);
  await write(end);
}
