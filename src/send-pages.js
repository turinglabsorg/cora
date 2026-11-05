/**
 * The vault's two pages for people outside the panel, at /send/: a request, where
 * whoever holds a secret types it in once, and a send, which opens a secret a set
 * number of times and decrypts it in the browser with the key in the link's fragment
 * (the server never has that key). No session, no panel script, nothing to load
 * from elsewhere.
 */
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const COPY = {
  it: {
    askTitle: "Ti chiedono un segreto", askLead: "{who} ti chiede <b>{name}</b>{what}. Scrivilo qui sotto: va nella cassaforte cifrata di Cora e nessuno lo rivede in chiaro, nemmeno in chat.",
    label: "Il valore", put: "Metti nella cassaforte", fine: "Il link vale una volta e scade il {when}.",
    thanksTitle: "Ricevuto", thanksLead: "<b>{name}</b> è nella cassaforte. Puoi chiudere questa pagina.",
    goneTitle: "Questo link non vale più", goneLead: "È già stato usato, è scaduto o è stato annullato.",
    sendTitle: "Ti hanno mandato un segreto", sendLead: "Si apre un numero limitato di volte, poi sparisce: aprilo solo quando sei pronto a copiarlo.", open: "Mostra il segreto",
    copy: "Copia", copied: "Copiato", gone: "Questo segreto non si apre più.", broken: "Il link è incompleto: copialo per intero, con la parte dopo #.",
    someone: "Qualcuno", empty: "Il valore è vuoto.",
    password: "Password", wrong: "Password sbagliata.", tooMany: "Troppi tentativi: riprova tra qualche minuto.",
    signInLead: "È per persone precise: entra con Google o con un link che ti arriva per email, poi torni qui.", signIn: "Entra per vederlo", refused: "Questo indirizzo non può aprirlo.",
  },
  en: {
    askTitle: "You are asked for a secret", askLead: "{who} asks you for <b>{name}</b>{what}. Type it below: it goes into Cora's encrypted vault and nobody sees it in clear again, not even in a chat.",
    label: "The value", put: "Put it in the vault", fine: "The link works once and expires on {when}.",
    thanksTitle: "Received", thanksLead: "<b>{name}</b> is in the vault. You can close this page.",
    goneTitle: "This link no longer works", goneLead: "It was used already, it expired or it was cancelled.",
    sendTitle: "Someone sent you a secret", sendLead: "It opens a limited number of times, then it is gone: open it only when you are ready to copy it.", open: "Show the secret",
    copy: "Copy", copied: "Copied", gone: "This secret does not open any more.", broken: "The link is incomplete: copy it whole, with the part after #.",
    someone: "Someone", empty: "The value is empty.",
    password: "Password", wrong: "Wrong password.", tooMany: "Too many attempts: try again in a few minutes.",
    signInLead: "It is for specific people: sign in with Google or with a link sent to you by email, then come back here.", signIn: "Sign in to see it", refused: "This address cannot open it.",
  },
};

const STYLE = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#050505;color:#f5f5f3;font:15px/1.55 "Manrope","Helvetica Neue",Arial,sans-serif;display:flex;justify-content:center;padding:56px 16px}
main{width:100%;max-width:560px}h1{font:600 30px/1.15 "Outfit","Helvetica Neue",Arial,sans-serif;letter-spacing:-.03em;margin:0 0 10px}p{color:#8f8f8a;margin:0 0 18px}b{color:#f5f5f3;font-weight:600}
.mark{display:block;width:44px;height:44px;margin-bottom:22px;color:#f2a93b}label{display:block;margin:0 0 8px;font:500 11px/1 "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:#8f8f8a}
textarea{width:100%;min-height:120px;padding:12px 14px;border:1px solid #353535;border-radius:10px;background:#000;color:#f5f5f3;font:400 14px/1.5 "DM Mono",monospace;resize:vertical;outline:none}textarea:focus{border-color:#f2a93b;box-shadow:0 0 0 3px rgba(242,169,59,.35)}
button,a.button{display:inline-flex;align-items:center;justify-content:center;width:100%;height:46px;margin-top:14px;border:0;border-radius:10px;background:#f2a93b;color:#1d1b18;font:600 12px/1 "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;cursor:pointer}
input{width:100%;height:46px;padding:0 14px;border:1px solid #353535;border-radius:10px;background:#000;color:#f5f5f3;font:400 16px/1.5 "Manrope",Arial,sans-serif;outline:none}input:focus{border-color:#f2a93b;box-shadow:0 0 0 3px rgba(242,169,59,.35)}button.ghost{background:#171717;color:#f5f5f3;border:1px solid #353535}
small{display:block;margin-top:14px;color:#5c5c58;font-size:12px}.alert{color:#ff9c8b}[hidden]{display:none!important}`;
const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3"><circle cx="32" cy="32" r="18.5"/><g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="18.5" ry="5.6" stroke-opacity="0.38"/><path d="M13.5 32A18.5 5.6 0 0 0 50.5 32"/></g></g></svg>`;

export const SEND_STYLE = STYLE;
export const SEND_MARK = MARK;

/**
 * The page around a send, wherever it is served: the instance's /send/s/ path or a
 * send's own host. The value is decrypted in the browser by /send.js with the key
 * in the fragment; a password goes with the request to open, and a send for named
 * people first sends its visitor to sign in (the key waits in the tab meanwhile).
 */
export function sendPage({ lang, mode = "public", signIn = "", openUrl = "", script = "/assets/send.js" }) {
  const t = COPY[lang] || COPY.it;
  const fill = (text) => String(text);
  const password = mode === "password" ? `<label for="password">${fill(t.password)}</label><input id="password" type="password" autocomplete="off" required>` : "";
  const action = signIn
    ? `<p>${fill(t.signInLead)}</p><a id="signin" class="button" href="${esc(signIn)}">${fill(t.signIn)}</a>`
    : `${password}<button id="open" type="button">${fill(t.open)}</button>`;
  const body = `<h1>${fill(t.sendTitle)}</h1><p>${fill(t.sendLead)}</p>
      <div id="send" data-open="${esc(openUrl)}" data-mode="${esc(mode)}" data-gone="${fill(t.gone)}" data-broken="${fill(t.broken)}" data-copy="${fill(t.copy)}" data-copied="${fill(t.copied)}" data-wrong="${fill(t.wrong)}" data-too-many="${fill(t.tooMany)}" data-refused="${fill(t.refused)}">
        ${action}
        <div id="shown" hidden><label for="secret" id="name"></label><textarea id="secret" readonly></textarea><button id="copy" class="ghost" type="button">${fill(t.copy)}</button></div>
        <p id="error" class="alert" hidden></p>
      </div>`;
  return {
    csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    html: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t.sendTitle)}</title><style>${STYLE}</style><script src="${esc(script)}" defer></script></head><body><main>${MARK}${body}</main></body></html>`,
  };
}

const originHost = (value) => {
  try { return new URL(value).host; } catch { return null; }
};

/** A small body as text, or null when it is larger than `limit`. */
export async function readText(req, limit = 4096) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readForm(req, limit = 128 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function sendPages({ vault, store, timezone = "UTC", whoOf = () => null }) {
  // Wrong passwords per send and visitor: ten in ten minutes, then a pause.
  const attempts = new Map();
  const language = (req) => (/^\s*en\b/i.test(String(req.headers["accept-language"] || "")) || (!req.headers["accept-language"] && store.settings.language === "en") ? "en" : "it");
  const words = (lang, key, vars = {}) => COPY[lang][key].replace(/\{(\w+)\}/g, (_, name) => esc(vars[name] ?? ""));
  const page = (res, status, lang, title, body, { script = false } = {}) => {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'${script ? "; script-src 'self'; connect-src 'self'" : ""}`,
      // same-origin, not no-referrer: with no-referrer a browser posts the form with "Origin: null".
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY",
    });
    res.end(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style>${script ? '<script src="/assets/send.js" defer></script>' : ""}</head><body><main>${MARK}${body}</main></body></html>`);
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(body));
  };
  const gone = (res, lang) => page(res, 410, lang, words(lang, "goneTitle"), `<h1>${words(lang, "goneTitle")}</h1><p>${words(lang, "goneLead")}</p>`);
  const when = (lang, ms) => new Date(ms).toLocaleString(lang === "en" ? "en-GB" : "it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: timezone });

  return async function handle(req, res, url) {
    const lang = language(req);
    const match = /^\/send\/(r|s)\/([A-Za-z0-9_-]{32})$/.exec(url.pathname);
    if (!match || !vault?.enabled) return gone(res, lang);
    const [, kind, token] = match;
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Only this page posts here: a form or a fetch from another site is refused.
      const origin = req.headers.origin;
      const site = req.headers["sec-fetch-site"];
      const foreign = (site && site !== "same-origin") || (origin && origin !== "null" && originHost(origin) !== req.headers.host) || (!origin && !site);
      if (foreign) return kind === "s" ? json(res, 403, { error: "forbidden" }) : page(res, 403, lang, words(lang, "goneTitle"), `<h1>${words(lang, "goneTitle")}</h1>`);
    }
    if (kind === "r") {
      const request = vault.openRequest(token);
      if (!request) return gone(res, lang);
      if (req.method === "GET") vault.event("request-page", { name: request.name, requestId: request.id, who: whoOf(req) });
      if (req.method === "POST") {
        const form = await readForm(req);
        const value = form?.get("value") || "";
        if (!value.trim()) return page(res, 400, lang, words(lang, "askTitle"), `<h1>${words(lang, "askTitle")}</h1><p class="alert">${words(lang, "empty")}</p><p><a href="" style="color:#f2a93b">↻</a></p>`);
        try {
          vault.fillRequest(token, value, whoOf(req));
        } catch (error) {
          if (error.status === 410) return gone(res, lang);
          return page(res, error.status || 400, lang, words(lang, "askTitle"), `<h1>${words(lang, "askTitle")}</h1><p class="alert">${esc(error.message)}</p>`);
        }
        return page(res, 200, lang, words(lang, "thanksTitle"), `<h1>${words(lang, "thanksTitle")}</h1><p>${words(lang, "thanksLead", { name: request.name })}</p>`);
      }
      const what = request.description ? ` (${request.description})` : "";
      return page(res, 200, lang, words(lang, "askTitle"), `<h1>${words(lang, "askTitle")}</h1>
        <p>${words(lang, "askLead", { who: request.by?.name || words(lang, "someone"), name: request.name, what })}</p>
        <form method="post"><label for="value">${words(lang, "label")}</label><textarea id="value" name="value" required autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <button type="submit">${words(lang, "put")}</button></form><small>${words(lang, "fine", { when: when(lang, request.expiresAt) })}</small>`);
    }
    const send = vault.sendAlive(token);
    // A send for named people lives on its own host, where they can sign in: never here.
    const mode = send?.access?.mode || "public";
    if (req.method === "POST") {
      if (!send || mode === "people") return json(res, 410, { error: "gone" });
      const who = whoOf(req);
      if (mode === "password") {
        const key = `${send.id}:${who?.visitor || ""}`;
        const recent = (attempts.get(key) || []).filter((at) => at > Date.now() - 10 * 60000);
        attempts.set(key, recent);
        if (recent.length >= 10) return json(res, 429, { error: "too many" });
        let given = "";
        try { given = String(JSON.parse((await readText(req, 4096)) || "{}").password || ""); } catch { given = ""; }
        if (!vault.access?.passwordOpens({ access: send.access }, given)) {
          recent.push(Date.now());
          vault.event("send-refused", { name: send.name, sendId: send.id, detail: "password", who });
          return json(res, 401, { error: "wrong password" });
        }
        attempts.delete(key);
      }
      const opened = vault.openSend(token, who);
      return opened ? json(res, 200, opened) : json(res, 410, { error: "gone" });
    }
    if (!send || mode === "people") return gone(res, lang);
    vault.event("send-page", { name: send.name, sendId: send.id, who: whoOf(req) });
    const shown = sendPage({ lang, mode, openUrl: url.pathname });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": shown.csp,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY",
    });
    return res.end(shown.html);
  };
}
