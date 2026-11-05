import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyPass } from "./pass.js";
import { readText, sendPage } from "./send-pages.js";
import { browse, viewer as viewPage, writeZip, ZIP_LIMIT } from "./share-drive.js";

/**
 * The share hosts: <label>--<space>.<domain>, each a folder (or a commit, for
 * its reviewers) served on an address of its own. Nothing of the panel answers
 * there — no API, no panel cookie. A share is public, behind a password, or for
 * people: those prove an address through usecora.space (Google or a link by
 * email) and the share's access says whether they may enter. A cookie of that
 * host alone keeps a visitor in, until the access changes.
 */
const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", webmanifest: "application/manifest+json", xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8", tsv: "text/tab-separated-values; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf", wasm: "application/wasm",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  zip: "application/zip", gz: "application/gzip",
};
// In a folder of files these download: a page or a script there is a document to keep, not a site to run.
const ACTIVE = new Set(["html", "htm", "xhtml", "svg", "xml", "js", "mjs"]);
const SESSION_DAYS = 30;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function same(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

/** A path on this host to come back to: never another host. */
function safeNext(value) {
  const next = String(value || "/");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && next.length < 2000 ? next : "/";
}

const COPY = {
  it: {
    gone: ["Questo link non esiste più", "È stato revocato o è scaduto. Chiedi a chi te l'ha mandato."],
    denied: ["Questo indirizzo non può entrare", "{email} non è tra chi può aprire questo link. Se hai un altro indirizzo, usalo."],
    another: "Entra con un altro indirizzo",
    out: ["Sei uscito", "Per tornare, apri di nuovo il link."],
    notFound: ["Non c'è niente qui", "Questa pagina non è nella cartella condivisa."],
    empty: ["Ancora niente in onda", "Questa cartella non ha ancora una versione pubblicata."],
    files: "{count} file",
    up: "Cartella superiore",
    leave: "Esci",
    locked: ["Serve una password", "Chi ha condiviso questa pagina ti ha dato una password: scrivila qui."],
    wrong: "Password sbagliata.", tooMany: "Troppi tentativi: riprova tra qualche minuto.", password: "Password", enter: "Entra",
    tooBig: ["Troppo grande per un solo zip", "Scarica le sottocartelle una alla volta, o i file uno per uno."],
  },
  en: {
    gone: ["This link is gone", "It was revoked or it expired. Ask whoever sent it to you."],
    denied: ["This address cannot come in", "{email} is not among those who may open this link. If you have another address, use that."],
    another: "Use another address",
    out: ["You are out", "To come back, open the link again."],
    notFound: ["Nothing here", "This page is not in the shared folder."],
    empty: ["Nothing on air yet", "This folder has no published version yet."],
    files: "{count} files",
    up: "Up one folder",
    leave: "Sign out",
    locked: ["A password is needed", "Whoever shared this page gave you a password: type it here."],
    wrong: "Wrong password.", tooMany: "Too many attempts: try again in a few minutes.", password: "Password", enter: "Enter",
    tooBig: ["Too large for one zip", "Download the subfolders one at a time, or the files one by one."],
  },
};

const STYLE = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#050505;color:#f5f5f3;font:15px/1.55 "Manrope","Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;align-items:center;padding:56px 16px}
main{width:100%;max-width:760px}h1{font:600 30px/1.15 "Outfit","Helvetica Neue",Arial,sans-serif;letter-spacing:-.03em;margin:0 0 8px}p{color:#8f8f8a;margin:0 0 18px}
.mark{display:block;width:44px;height:44px;margin-bottom:22px;color:#f2a93b}a{color:#f2a93b}.btn{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:10px;border:1px solid #353535;background:#171717;color:#f5f5f3;text-decoration:none;font:600 12px/1 "DM Mono",monospace;letter-spacing:.1em;text-transform:uppercase}
.path{font:400 13px/1.4 "DM Mono",monospace;color:#5c5c58;margin:0 0 6px}
form{display:grid;gap:12px;max-width:420px}label{font:500 11px/1 "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:#8f8f8a}input{height:46px;padding:0 14px;border:1px solid #353535;border-radius:10px;background:#000;color:#f5f5f3;font:400 16px/1.5 "Manrope",Arial,sans-serif;outline:none}input:focus{border-color:#f2a93b;box-shadow:0 0 0 3px rgba(242,169,59,.35)}button{height:46px;border:0;border-radius:10px;background:#f2a93b;color:#1d1b18;font:600 12px/1 "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.alert{color:#ff9c8b}ul{list-style:none;margin:18px 0 0;padding:0;border:1px solid #232323;border-radius:16px;background:#0f0f0f;overflow:hidden}
li{border-top:1px solid #232323}li:first-child{border-top:0}li a{display:flex;gap:12px;align-items:center;padding:12px 16px;color:#f5f5f3;text-decoration:none;font:400 14px/1.4 "DM Mono",monospace}li a:hover{background:rgba(242,169,59,.08)}
li a span{flex:1;min-width:0;overflow-wrap:anywhere}li small{color:#5c5c58;font:400 12px/1 "DM Mono",monospace}li.dir a span{color:#f2a93b}footer{margin-top:28px;font:400 11px/1.4 "DM Mono",monospace;color:#5c5c58;letter-spacing:.08em;text-transform:uppercase}footer a{color:#8f8f8a}`;
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#050505"/><g fill="none" stroke="#f2a93b" stroke-width="4.2" stroke-linecap="round"><circle cx="32" cy="32" r="18.5"/><g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="18.5" ry="5.6" stroke-opacity="0.38"/><path d="M13.5 32A18.5 5.6 0 0 0 50.5 32"/></g></g></svg>`;
const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3"><circle cx="32" cy="32" r="18.5"/><g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="18.5" ry="5.6" stroke-opacity="0.38"/><path d="M13.5 32A18.5 5.6 0 0 0 50.5 32"/></g></g></svg>`;

function fmtBytes(value) {
  let size = Number(value) || 0;
  const units = ["B", "KB", "MB", "GB"];
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size < 10 && unit ? 1 : 0)} ${units[unit]}`;
}

// The script that opens a send in the browser, the same one the instance serves at /assets/send.js.
const SEND_SCRIPT = readFileSync(new URL("../web/send.js", import.meta.url));

export function shareHosts({ config, store, artifacts, vault = null, cloud, firstUse, sessionKey, activity = () => {} }) {
  // Wrong passwords per link and visitor: ten in ten minutes, then a pause.
  const attempts = new Map();
  const tooMany = (key) => {
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((at) => now - at < 10 * 60000);
    attempts.set(key, recent);
    return recent.length >= 10;
  };
  const secure = !config.insecureCookies;
  const COOKIE = secure ? "__Host-cora_share" : "cora_share";
  const suffix = artifacts?.shareSuffix || "";
  const mac = (value) => createHmac("sha256", sessionKey || "cora-share").update(value).digest("base64url");
  const etag = (sha) => `"${mac(`etag.${sha}`).slice(0, 27)}"`;

  /** The share or preview a request is for, from its Host. */
  function match(req) {
    if (!suffix || !cloud) return null;
    const host = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
    if (!host.endsWith(suffix)) return null;
    return { host, label: host.slice(0, -suffix.length) };
  }

  const language = (req) => (/^\s*en\b/i.test(String(req.headers["accept-language"] || "")) || (!req.headers["accept-language"] && store.settings.language === "en") ? "en" : "it");
  const words = (req, key, vars = {}) => {
    const value = COPY[language(req)][key];
    const fill = (text) => String(text).replace(/\{(\w+)\}/g, (_, name) => esc(vars[name] ?? ""));
    return Array.isArray(value) ? value.map(fill) : fill(value);
  };

  const headers = (extra = {}) => ({
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "private, no-cache",
    ...extra,
  });

  function page(req, res, status, [title, text], extra = "", setCookie = null) {
    res.writeHead(status, headers({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      ...(setCookie ? { "Set-Cookie": setCookie } : {}),
    }));
    res.end(`<!doctype html><html lang="${language(req)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/_cora/icon.svg" type="image/svg+xml"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${MARK}<h1>${esc(title)}</h1><p>${text}</p>${extra}</main></body></html>`);
  }

  const redirect = (res, location, extra = {}) => {
    res.writeHead(302, headers({ Location: location, ...extra }));
    res.end();
  };

  const cookieLine = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  /** Who this host already let in: the address in its cookie, still allowed by the access as it is now. */
  function viewer(req, target) {
    const value = cookies(req.headers.cookie)[COOKIE];
    if (!value) return null;
    const [version, scope, email64, expires, revision, signature, extra] = value.split(".");
    if (version !== "v1" || extra !== undefined || !signature) return null;
    if (!same(signature, mac(`share.${version}.${scope}.${email64}.${expires}.${revision}`))) return null;
    if (scope !== target.scope || Number(revision) !== target.revision || Number(expires) < Date.now()) return null;
    let identity;
    try { identity = JSON.parse(Buffer.from(email64, "base64url").toString("utf8")); } catch { return null; }
    return artifacts.allows(target, identity) ? identity : null;
  }

  function admit(target, identity) {
    const expires = Date.now() + SESSION_DAYS * 86400000;
    const email64 = Buffer.from(JSON.stringify({ email: identity.email, hd: identity.hd || "", via: identity.via })).toString("base64url");
    const body = `v1.${target.scope}.${email64}.${expires}.${target.revision}`;
    return cookieLine(`${body}.${mac(`share.${body}`)}`, SESSION_DAYS * 86400);
  }

  /** A browser and system in two words, for the log: never the whole user agent. */
  const deviceOf = (agent) => {
    const ua = String(agent || "");
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|wget|python|node|Go-http/i.test(ua) ? "script" : "";
    const system = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    return [browser, system].filter(Boolean).join(" · ");
  };
  const recent = new Map();
  /**
   * One line in the folder's log: who (the address they proved, or a visitor tag
   * from their network and browser, never the address itself), what, which file.
   * The same thing by the same person within a minute (half an hour for opening
   * the folder) is one line.
   */
  /** Who a request comes from, for a log: a proven address if there is one, always a visitor code and a device. */
  function whoOf(req, identity = null) {
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    return { email: identity?.email || "", via: identity?.via || "", visitor: mac(`visitor.${ip}.${req.headers["user-agent"] || ""}`).slice(0, 6).toLowerCase(), device: deviceOf(req.headers["user-agent"]) };
  }

  function record(req, target, kind, { path = "", identity = null, detail = "" } = {}) {
    if (target.kind === "send") {
      const who = whoOf(req, identity || viewer(req, target));
      if (!who.via && target.share.access.mode === "public") who.via = "public";
      return vault?.event(kind === "open" ? "send-page" : `send-${kind}`, { name: target.send.name, sendId: target.send.id, who, detail });
    }
    if (!store.addArtifactEvent) return;
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const who = identity || viewer(req, target) || null;
    const visitor = mac(`visitor.${ip}.${req.headers["user-agent"] || ""}`).slice(0, 6).toLowerCase();
    const shareId = target.kind === "share" ? target.share.id : `preview:${target.commit?.id || ""}`;
    const key = `${shareId}.${who?.email || visitor}.${kind}.${path}`;
    const now = Date.now();
    if ((recent.get(key) || 0) > now - (kind === "open" ? 30 * 60000 : 60000)) return;
    recent.set(key, now);
    if (recent.size > 5000) for (const [entry, at] of recent) if (at < now - 30 * 60000) recent.delete(entry);
    store.addArtifactEvent({
      folderId: target.folder.id, shareId, label: target.kind === "share" ? target.share.label : "", at: now, kind, path, detail,
      who: { email: who?.email || "", via: who?.via || (target.kind === "share" && target.share.access.mode === "public" ? "public" : ""), visitor, device: deviceOf(req.headers["user-agent"]) },
    });
  }

  /** A stored file: its type for this kind of share, ETag, a single range, HEAD. */
  function sendFile(req, res, file, { view, status = 200, attachment = false, frameAncestors = "'self'" }) {
    const name = file.path.split("/").at(-1);
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const download = attachment || (view === "files" && ACTIVE.has(extension));
    const type = download ? "application/octet-stream" : TYPES[extension] || "application/octet-stream";
    const tag = etag(file.sha);
    const base = headers({
      "Content-Type": type,
      ETag: tag,
      "Accept-Ranges": "bytes",
      "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
      ...(download || type === "application/octet-stream" ? { "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
    });
    if (status === 200 && req.headers["if-none-match"] === tag) {
      res.writeHead(304, base);
      return res.end();
    }
    const range = status === 200 ? /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "")) : null;
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      if (start >= file.size || start > end) {
        res.writeHead(416, { ...base, "Content-Range": `bytes */${file.size}` });
        return res.end();
      }
      res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return artifacts.stream(file.sha, { start, end }).on("error", () => res.destroy()).pipe(res);
    }
    res.writeHead(status, { ...base, "Content-Length": file.size });
    if (req.method === "HEAD") return res.end();
    artifacts.stream(file.sha).on("error", () => res.destroy()).pipe(res);
  }

  /** The address a panel frames one file from: apart from the panel, for ten minutes, for that file alone. */
  function rawUrl(commitId, path, minutes = 10) {
    if (!suffix || !cloud) return "";
    const expires = Date.now() + minutes * 60000;
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `https://r-${commitId.slice(3)}${suffix}/${encoded}?t=${expires}.${mac(`raw.${commitId}.${path}.${expires}`)}`;
  }

  function rawFile(req, res, target, url, host) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, headers({ Allow: "GET, HEAD" }));
      return res.end();
    }
    let path;
    try { path = decodeURIComponent(url.pathname.slice(1)); } catch { path = ""; }
    const [expires, signature] = String(url.searchParams.get("t") || "").split(".");
    if (!path || !signature || Number(expires) < Date.now() || !same(signature, mac(`raw.${target.commit.id}.${path}.${expires}`))) return page(req, res, 403, words(req, "gone"));
    const file = artifacts.fileAt(target.commit.id, path);
    if (!file) return page(req, res, 404, words(req, "notFound"));
    // Only the panel of this space may frame it, and the page itself runs nothing of its own.
    const panel = `https://${host.slice(host.indexOf("--") + 2)}`;
    return sendFile(req, res, { path, sha: file.sha, size: file.size }, { view: "files", frameAncestors: panel });
  }

  /**
   * A secret's send on its own host: the page, the script, and the one request that
   * hands over the sealed bytes, after the password or the sign-in its access asks for.
   */
  async function sendHost(req, res, target, url, host, mode) {
    const json = (status, body) => {
      res.writeHead(status, headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }));
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/_cora/send.js") {
      res.writeHead(200, headers({ "Content-Type": "text/javascript; charset=utf-8" }));
      return res.end(req.method === "HEAD" ? undefined : SEND_SCRIPT);
    }
    const signedIn = viewer(req, target);
    if (url.pathname === "/_cora/open" && req.method === "POST") {
      const site = req.headers["sec-fetch-site"];
      const origin = req.headers.origin;
      if (req.headers["x-cora"] !== "1" || (site && site !== "same-origin") || (origin && origin !== `https://${host}` && origin !== `http://${req.headers.host}`)) return json(403, { error: "forbidden" });
      if (mode === "people" && !signedIn) return json(403, { error: "sign in first" });
      if (mode === "password") {
        const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
        const key = `${target.send.id}:${ip}`;
        if (tooMany(key)) return json(429, { error: "too many" });
        let given = "";
        try { given = String(JSON.parse((await readText(req, 4096)) || "{}").password || ""); } catch { given = ""; }
        if (!artifacts.passwordOpens({ access: target.share.access }, given)) {
          attempts.get(key).push(Date.now());
          record(req, target, "refused", { detail: "password" });
          return json(401, { error: "wrong password" });
        }
        attempts.delete(key);
      }
      const who = whoOf(req, signedIn || (mode === "password" ? { email: "", via: "password" } : null));
      if (!who.via && mode === "public") who.via = "public";
      const opened = vault.openSendHash(target.hash, who);
      return opened ? json(200, opened) : json(410, { error: "gone" });
    }
    if (url.pathname !== "/") return page(req, res, 404, words(req, "notFound"));
    record(req, target, "open");
    const signIn = mode === "people" && !signedIn ? `${cloud.url}/share?${new URLSearchParams({ to: host, next: "/" })}` : "";
    const shown = sendPage({ lang: language(req), mode, signIn, openUrl: "/_cora/open", script: "/_cora/send.js" });
    res.writeHead(200, headers({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": shown.csp, "Cache-Control": "no-store", "X-Frame-Options": "DENY" }));
    return res.end(req.method === "HEAD" ? undefined : shown.html);
  }

  async function handle(req, res, { host, label }) {
    // The path as sent: "//x/" stays a path here, never an authority.
    const url = new URL(`https://${host}${String(req.url).startsWith("/") ? "" : "/"}${req.url}`);
    const passwordForm = url.pathname === "/_cora/password";
    if (req.method !== "GET" && req.method !== "HEAD" && !((passwordForm || url.pathname === "/_cora/open") && req.method === "POST")) {
      res.writeHead(405, headers({ Allow: "GET, HEAD" }));
      return res.end();
    }
    // The tab's icon for Cora's own pages on a share host: the mark, open to anyone.
    if (url.pathname === "/_cora/icon.svg") {
      res.writeHead(200, headers({ "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "Content-Security-Policy": "default-src 'none'" }));
      return res.end(req.method === "HEAD" ? undefined : ICON);
    }
    const target = artifacts.resolveHost(label) || vault?.resolveHost?.(label) || null;
    if (!target) return page(req, res, 404, words(req, "gone"));
    if (target.kind === "raw") return rawFile(req, res, target, url, host);
    if (url.pathname === "/_cora/logout") return page(req, res, 200, words(req, "out"), "", cookieLine("", 0));
    const mode = target.kind === "share" ? target.share.access.mode || "people" : target.kind === "send" ? target.share.access.mode || "public" : "people";
    if (passwordForm && mode === "password" && target.kind !== "send") {
      const next = safeNext(url.searchParams.get("next"));
      const form = (alert = "") => `${alert ? `<p class="alert">${esc(alert)}</p>` : ""}<form method="post" action="/_cora/password?${esc(new URLSearchParams({ next }).toString())}"><label for="password">${esc(words(req, "password"))}</label><input id="password" name="password" type="password" required autocomplete="current-password" autofocus><button type="submit">${esc(words(req, "enter"))}</button></form>`;
      if (req.method !== "POST") return page(req, res, 200, words(req, "locked"), form());
      const site = req.headers["sec-fetch-site"];
      const origin = req.headers.origin;
      if ((site && site !== "same-origin") || (origin && origin !== "null" && origin !== `https://${host}` && origin !== `http://${req.headers.host}`)) return page(req, res, 403, words(req, "locked"), form());
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const key = `${target.share.id}:${ip}`;
      if (tooMany(key)) return page(req, res, 429, words(req, "locked"), form(words(req, "tooMany")));
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return page(req, res, 413, words(req, "locked"), form());
        chunks.push(chunk);
      }
      const password = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("password") || "";
      if (!artifacts.passwordOpens(target.share, password)) {
        attempts.get(key).push(Date.now());
        record(req, target, "refused", { detail: "password" });
        return page(req, res, 401, words(req, "locked"), form(words(req, "wrong")));
      }
      attempts.delete(key);
      activity({ type: "artifact", text: `il link ${label} è stato aperto con la password` });
      record(req, target, "enter", { identity: { email: "", via: "password" } });
      return redirect(res, next, { "Set-Cookie": admit(target, { email: "", via: "password" }) });
    }
    if (passwordForm) return redirect(res, safeNext(url.searchParams.get("next")));
    if (url.pathname === "/_cora/auth") {
      const fields = verifyPass(cloud.key, url.searchParams.get("pass"), { audience: `share:${host}` });
      if (!fields?.email || !firstUse(fields)) return redirect(res, `${cloud.url}/share?${new URLSearchParams({ to: host, next: safeNext(url.searchParams.get("next")) })}`);
      const identity = { email: String(fields.email).toLowerCase(), hd: String(fields.hd || ""), via: String(fields.via || "") };
      if (fields.emailVerified === false || !artifacts.allows(target, identity)) {
        activity({ type: "warning", text: `link ${label}: ${identity.email} non può entrare` });
        record(req, target, "refused", { identity });
        return page(req, res, 403, words(req, "denied", { email: identity.email }),
          `<a class="btn" href="${esc(`${cloud.url}/share?${new URLSearchParams({ to: host, next: safeNext(url.searchParams.get("next")), other: "1" })}`)}">${esc(words(req, "another"))}</a>`);
      }
      activity({ type: target.kind === "send" ? "secret" : "artifact", text: `${identity.email} ha aperto ${target.kind === "preview" ? `l'anteprima di ${target.folder.path}` : target.kind === "send" ? `il link di ${target.send.name}` : `il link ${label}`}` });
      record(req, target, "enter", { identity });
      return redirect(res, safeNext(url.searchParams.get("next")), { "Set-Cookie": admit(target, identity) });
    }
    if (target.kind === "send") return sendHost(req, res, target, url, host, mode);
    if (mode === "password" && !viewer(req, target)) return redirect(res, `/_cora/password?${new URLSearchParams({ next: safeNext(url.pathname + url.search) })}`);
    if (mode === "people" && !viewer(req, target)) return redirect(res, `${cloud.url}/share?${new URLSearchParams({ to: host, next: safeNext(url.pathname + url.search) })}`);
    if (!target.commit) return page(req, res, 404, words(req, "empty"));
    const tree = artifacts.readTree(target.commit.tree);
    if (url.pathname === "/_cora/files.json") {
      res.writeHead(200, headers({ "Content-Type": "application/json; charset=utf-8" }));
      return res.end(JSON.stringify({ folder: target.folder.path, title: target.folder.title, commit: target.commit.id.slice(3, 10), files: [...tree.entries()].map(([path, file]) => ({ path, size: file.size })) }));
    }
    const signedIn = Boolean(cookies(req.headers.cookie)[COOKIE]);
    const lang = language(req);
    const drivePage = (rendered) => {
      res.writeHead(200, headers({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": rendered.csp }));
      res.end(req.method === "HEAD" ? undefined : rendered.html);
    };
    if (target.view === "files" && url.pathname.startsWith("/_cora/view/")) {
      const found = artifacts.resolvePath(tree, url.pathname.slice("/_cora/view".length), "files");
      if (!found.file) return page(req, res, 404, words(req, "notFound"));
      const dir = found.file.path.includes("/") ? found.file.path.slice(0, found.file.path.lastIndexOf("/") + 1) : "";
      const siblings = [...tree.keys()].filter((path) => path.startsWith(dir) && !path.slice(dir.length).includes("/")).sort((a, b) => a.localeCompare(b, lang));
      record(req, target, "view", { path: found.file.path });
      return drivePage(viewPage({ lang, file: found.file, siblings, title: target.folder.title, read: (max) => artifacts.readObject(found.file.sha, max) }));
    }
    if (url.pathname === "/_cora/zip") {
      const dir = String(url.searchParams.get("dir") || "").replace(/^\/+|\/+$/g, "");
      const inside = dir ? `${dir}/` : "";
      const entries = [...tree.entries()].filter(([path]) => path.startsWith(inside)).sort(([a], [b]) => a.localeCompare(b));
      if (!entries.length) return page(req, res, 404, words(req, "notFound"));
      const total = entries.reduce((sum, [, file]) => sum + file.size, 0);
      if (total > ZIP_LIMIT) return page(req, res, 413, words(req, "tooBig"));
      const name = `${(dir || target.folder.path).split("/").at(-1)}.zip`;
      record(req, target, "download", { path: inside, detail: "zip" });
      res.writeHead(200, headers({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}` }));
      if (req.method === "HEAD") return res.end();
      try {
        await writeZip(res, entries.map(([path, file]) => ({ name: path.slice(inside.length), size: file.size, open: () => artifacts.stream(file.sha) })), new Date(target.commit.publishedAt || target.commit.createdAt));
        res.end();
      } catch { res.destroy(); }
      return;
    }
    const found = artifacts.resolvePath(tree, url.pathname, target.view);
    if (found.redirect) return redirect(res, `${found.redirect}${url.search}`);
    if (found.listing !== undefined) {
      if (url.searchParams.get("q") || !found.listing) record(req, target, url.searchParams.get("q") ? "search" : "open", { detail: String(url.searchParams.get("q") || "").slice(0, 120) });
      return drivePage(browse({
        lang, tree, dir: found.listing.replace(/\/$/, ""), q: String(url.searchParams.get("q") || "").slice(0, 200), mode: url.searchParams.get("v") === "list" ? "list" : "grid",
        title: target.folder.title, sharedBy: target.kind === "share" ? target.share.createdBy?.name || "" : "", updatedAt: target.commit.publishedAt || target.commit.createdAt, signedIn,
        read: (sha, max) => artifacts.readObject(sha, max), direct: target.view === "site",
      }));
    }
    if (found.file) {
      const attachment = url.searchParams.get("download") === "1";
      const dest = String(req.headers["sec-fetch-dest"] || "");
      const ranged = /^bytes=[1-9]/.test(String(req.headers.range || ""));
      const html = /\.html?$/i.test(found.file.path);
      if (!ranged && req.method === "GET") {
        if (attachment || (!dest && target.view === "files")) record(req, target, "download", { path: found.file.path });
        else if (dest === "document" && (target.view === "files" || html)) record(req, target, target.view === "site" && found.file.path.endsWith("index.html") && !url.pathname.endsWith(".html") && url.pathname === "/" ? "open" : "view", { path: found.file.path });
        else if (!dest && html) record(req, target, "view", { path: found.file.path });
      }
      return sendFile(req, res, found.file, { view: target.view, attachment });
    }
    const missing = target.view === "site" && tree.get("404.html");
    if (missing) return sendFile(req, res, { path: "404.html", ...missing }, { view: target.view, status: 404 });
    return page(req, res, found.status || 404, words(req, "notFound"));
  }

  return { match, handle, rawUrl, whoOf };
}
