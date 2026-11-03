/**
 * The cloud's pages, rendered on the server. Every value that comes from
 * people or providers goes through esc().
 */
const REPO = "https://github.com/turinglabsorg/cora";
/** The cloud's own address: pages shown on a space's name still load from here. */
let BASE = "";
/** Changes with the CSS and JS, so a deploy is never hidden behind the browser's cache. */
let VERSION = "";

export function configure({ origin, version = "" }) {
  BASE = String(origin || "").replace(/\/$/, "");
  VERSION = version ? `?v=${version}` : "";
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const TITLE = "Cora cloud";
const DESCRIPTION = "Identity and space routing for Cora.";

/** What the orb shows, one agent per pulse. */
const LOGIN_ERRORS = {
  expired: "The sign-in took too long or started somewhere else. Try again.",
  denied: "Sign-in was cancelled.",
  provider: "Google or GitHub did not answer as expected. Try again in a moment.",
  unavailable: "This way of signing in is not available yet.",
};
const ACCOUNT_ERRORS = {
  "bad-name": "Use 3 to 32 lowercase letters, numbers or single dashes.",
  taken: "That name is taken.",
  "has-spaces": "An account that owns a space cannot be deleted here.",
};
const ACCOUNT_NOTICES = { requested: "Request received. We will let you know when it is on air." };

const PRIVACY = [
  ["Who", "usecora.space is run by DigitalOracles LTD. It is the sign-in service for Cora spaces."],
  ["What we keep", "When you sign in with Google or GitHub we keep your name, email address, profile picture and the account id that service gives us, plus the spaces you own and any space request you send. We never see your Google or GitHub password."],
  ["What a space keeps", "Agents, memories, chats and computers live inside each space, run for its owner. The sign-in service does not read them."],
  ["Waitlist", "If you join the waitlist we keep the email address and the company you give us, only to tell you when spaces open. Ask us and we remove it."],
  ["Cookies", "One keeps you signed in, and an anonymous visit counter (stored only as a hash) counts page views. No ads, no third-party trackers."],
  ["Deleting", "From your account page you can delete your account at any time, once it owns no space. For anything else, reach DigitalOracles LTD through digitaloracles.com."],
];

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3"><circle cx="32" cy="32" r="18.5"/><g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="18.5" ry="5.6" stroke-opacity="0.38"/><path d="M13.5 32A18.5 5.6 0 0 0 50.5 32"/></g></g></svg>`;
const ICONS = {
  google: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1a6.6 6.6 0 0 1-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.8 14a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9L5.8 14Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7 0-.6 0-.6 1 .1 1.6 1.1 1.6 1.1 1 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.3.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.2 0c2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M21 4 3 11l6 2.5L18 7l-7 8 7.5 5L21 4Z"/></svg>`,
  app: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  context: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9l-6-6Zm0 0v6h6M8 13h8M8 17h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2v5m6-5v5M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/** The providers' own marks, in one color: Lobe Icons (MIT), the brands' trademarks. OrcaRouter has no one-color mark, so a plain router glyph. */
function layout({ title = TITLE, description = DESCRIPTION, body, page = "", account = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#050505">
${page === "landing" ? `<link rel="canonical" href="${BASE}/">` : ""}
<link rel="icon" href="${BASE}/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${BASE}/assets/cloud.css${VERSION}">

</head>
<body class="${page}">
<header class="top">
  <a class="brand" href="${BASE}/" aria-label="Cora">${MARK}<span>Cora</span></a>
  <nav class="top-nav">
    ${page !== "landing" && account ? `<a class="pill" href="${BASE}/account">Your spaces</a>` : ""}
  </nav>
</header>
${body}
<footer class="foot">
  <div class="foot-brand">${MARK}<span>Cora</span></div>
  <div class="foot-links"><a href="https://digitaloracles.com">Made by DigitalOracles LTD</a><a href="${REPO}">Source on GitHub</a><a href="${BASE}/privacy">Privacy</a></div>
</footer>
</body>
</html>`;
}

export function landing({ account, joined = false, waitlistError = "" }) {
  const notice = joined ? `<p role="status">You're on the list.</p>` : waitlistError ? `<p role="alert">That email doesn't look right.</p>` : "";
  return layout({ title: "Cora cloud", body: card(`<h1>Cora cloud</h1><p>Identity and space routing for Cora.</p>${notice}<a class="btn primary" href="${BASE}/login">Sign in</a><a class="btn ghost" href="https://usecora.space">Cora website</a>`, "status-card"), page: "plain", account });
}

function card(content, kind) {
  return `<main class="solo"><section class="card ${kind}">${content}</section></main>`;
}

export function login({ next, providers, error, account }) {
  const message = error ? `<p class="alert" role="alert">${esc(LOGIN_ERRORS[error] || LOGIN_ERRORS.provider)}</p>` : "";
  const query = `?next=${encodeURIComponent(next)}`;
  const names = { google: "Continue with Google", github: "Continue with GitHub" };
  const buttons = ["google", "github"].filter((provider) => providers[provider])
    .map((provider) => `<a class="btn provider ${provider}" href="${BASE}/auth/${provider}${query}">${ICONS[provider]}<span>${names[provider]}</span></a>`).join("");
  const body = card(`
    <div class="card-mark">${MARK}</div>
    <h1>Sign in</h1>
    <p class="lead">One account for all your spaces.</p>
    ${message}
    <div class="providers">${buttons || `<p class="muted">Signing in opens soon.</p>`}</div>
    <p class="fine">We read only your name, email address and picture. <a href="${BASE}/privacy">Privacy</a></p>`, "login-card");
  return layout({ title: "Sign in · Cora", body, page: "plain", account });
}

export function account({ account, identities, spaces, request, notice, error, domain }) {
  const alert = error ? `<p class="alert" role="alert">${esc(ACCOUNT_ERRORS[error] || "Something went wrong.")}</p>`
    : notice && ACCOUNT_NOTICES[notice] ? `<p class="notice" role="status">${ACCOUNT_NOTICES[notice]}</p>` : "";
  // A space installed on the customer's own machine is named by its own address: that is where it answers.
  const spaceList = spaces.map((space) => `
    <li class="space-row">
      <span class="lamp on"><i></i>On air</span>
      <span class="space-name">${space.publicUrl ? `<b>${esc(new URL(space.publicUrl).hostname)}</b>` : `<b>${esc(space.slug)}</b>.${esc(domain)}`}</span>
      <a class="btn primary" href="${BASE}/go/${esc(space.slug)}">Enter${ICONS.arrow}</a>
    </li>`).join("");
  const asking = request
    ? `<div class="requested"><span class="lamp warm"><i></i>Requested</span><p><b>${esc(request.slug)}</b>.${esc(domain)}</p><p class="muted">We will let you know when it is on air.</p></div>`
    : "";
  const form = `
    <form class="request" method="post" action="${BASE}/account/request">
      <label for="slug">The name you want</label>
      <div class="slug-input"><input id="slug" name="slug" required minlength="3" maxlength="32" pattern="[a-z0-9]+(-[a-z0-9]+)*" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(request?.slug || "")}"><span>.${esc(domain)}</span></div>
      <label for="note">What your team would use it for (optional)</label>
      <textarea id="note" name="note" maxlength="500" rows="3">${esc(request?.note || "")}</textarea>
      <button class="btn primary" type="submit">${request ? "Change the request" : "Request it"}</button>
    </form>`;
  const who = identities.map((identity) => `<li>${ICONS[identity.provider]}<span>${esc(identity.provider === "github" ? identity.login : identity.email)}</span></li>`).join("");
  const body = `<main class="solo wide">
    <section class="card account-card">
      <div class="account-head">
        ${account.avatar ? `<img class="avatar" src="${esc(account.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${MARK}</span>`}
        <div><p class="muted">Signed in as</p><h1>${esc(account.name || account.email || "Cora")}</h1></div>
      </div>
      ${alert}
      <h2>${spaces.length ? "Your spaces" : "No space yet"}</h2>
      ${spaces.length ? `<ul class="spaces">${spaceList}</ul>` : `<p class="lead">Tell us the name you want: we open spaces a few at a time and we will let you in.</p>${asking}${form}`}
      <h2>Signed in with</h2>
      <ul class="identities">${who}</ul>
      <div class="account-actions">
        <a class="btn ghost" href="${BASE}/logout">Sign out</a>
        <form method="post" action="${BASE}/logout?everywhere=1"><button class="btn ghost" type="submit">Sign out everywhere</button></form>
      </div>
      ${spaces.length ? "" : `<details class="danger-zone"><summary>Delete your account</summary><form method="post" action="${BASE}/account/delete"><p class="muted">Removes your account and the identities you signed in with.</p><label class="check"><input type="checkbox" name="confirm" value="yes" required> Yes, delete it</label><button class="btn danger" type="submit">Delete account</button></form></details>`}
    </section>
  </main>`;
  return layout({ title: "Your spaces · Cora", body, page: "plain", account });
}

export function privacy({ account }) {
  const body = `<main class="solo wide"><section class="card prose"><p class="kicker">usecora.space</p><h1>Privacy</h1>
    ${PRIVACY.map(([title, text]) => `<h2>${title}</h2><p>${text}</p>`).join("")}</section></main>`;
  return layout({ title: "Privacy · Cora", body, page: "plain", account });
}

export function notFound({ slug = "", account = null } = {}) {
  const body = card(`<div class="card-mark dim">${MARK}</div><h1>Nothing on this frequency.</h1>${slug ? `<p class="lead">There is no space called ${esc(slug)} yet.</p>` : ""}<a class="btn ghost" href="${BASE}/">Back to Cora</a>`, "status-card");
  return layout({ title: "Not found · Cora", body, page: "plain", account });
}

export function offline({ slug }) {
  const body = card(`<div class="card-mark dim">${MARK}</div><span class="lamp"><i></i>Off air</span><h1>Off air for a moment.</h1><p class="lead">${esc(slug)} is not answering right now. Try again in a minute.</p><a class="btn primary" href="">Try again</a>`, "status-card");
  return layout({ title: "Off air · Cora", body, page: "plain" });
}

export function accessDenied({ account, slug }) {
  return layout({ title: "Access not granted · Cora", page: "plain", account,
    body: card(`<div class="card-mark dim">${MARK}</div><h1>This space is private.</h1><p class="lead">Ask the owner of <b>${esc(slug)}</b> to authorize your email address or your company domain.</p><a class="btn ghost" href="${BASE}/account">Your account</a>`, "status-card") });
}
