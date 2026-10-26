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

const TITLE = "Cora — AI agents that live in your team chat";
const DESCRIPTION = "AI coworkers in your Discord, Telegram or their own app. Each has a memory, a schedule and its own computer. You bring the AI: Claude, ChatGPT or open models.";

/** What the orb shows, one agent per pulse. */
const PULSES = [
  ["IRIS", "#f2a93b", "posted the morning report in #ops"],
  ["OTTO", "#6fa8dc", "answered a customer on Telegram"],
  ["MIRA", "#e5533d", "asked Maya before deleting old backups"],
  ["LEO", "#8cc56a", "ran the 18:30 routine: weekly trends"],
  ["IRIS", "#f2a93b", "remembered: invoices go out on the 5th"],
  ["OTTO", "#6fa8dc", "opened the dashboard on its own desktop"],
  ["MIRA", "#e5533d", "steered mid-task: added last week's charts"],
  ["LEO", "#8cc56a", "slept on it: 12 memories tidied up"],
];

const SCRIPT = [
  ["09:15", "IRIS", "routine", "Morning check done: 3 new reviews, all five stars. Summary in #social."],
  ["11:02", "MAYA", "owner", "Iris, can you clean up the old backups on the server?"],
  ["11:02", "IRIS", "agent", "On it."],
  ["11:03", "IRIS", "tool", "shell › du -sh /backups/* · 4.1 GB older than 90 days"],
  ["11:03", "IRIS", "ask", "Delete 4.1 GB of backups older than 90 days?"],
  ["11:05", "MAYA", "owner", "Yes"],
  ["11:05", "IRIS", "agent", "Done. 4.1 GB freed, the last 90 days are untouched."],
];

const STRIPS = [
  ["CH 01", "Personality", "Someone, not something.", "A voice, opinions, a name your team calls.", ["voice", "core card", "opinions"], 72],
  ["CH 02", "Memory", "It remembers.", "Facts, a diary, every conversation. Tidied up every night.", ["facts", "diary", "recall"], 58],
  ["CH 03", "Computer", "A desk of its own.", "A Linux desktop with browser and terminal. Watch it, or take over.", ["desktop", "browser", "ssh"], 84],
  ["CH 04", "Routines", "It keeps a schedule.", "“Every weekday at 9:15” is enough. It runs and reports.", ["cron", "reports", "its own"], 46],
];

const DAY = [
  ["04:00", "Sleeps", "Tidies its memory."],
  ["09:15", "Morning check", "A summary in the team channel."],
  ["11:02", "Someone asks", "“On it”, progress, result."],
  ["15:40", "Your call", "A question with one-tap answers."],
  ["18:30", "Weekly trends", "Charts posted in #social."],
  ["23:50", "Night watch", "Quiet, unless something breaks."],
];

/** The Cora harness: our own agent loop, the flagship. */
const HARNESS = [
  ["Works until done", "For hours if it takes hours. No “shall I continue?”."],
  ["Steer it mid-task", "New messages reach it while it works."],
  ["Survives restarts", "It picks the task up where it was."],
  ["Stops when looping", "Same action, same result: it stops and tells you why."],
];

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
  ["Who", "usecora.space is run by Turing Labs. It is the sign-in service for Cora spaces."],
  ["What we keep", "When you sign in with Google or GitHub we keep your name, email address, profile picture and the account id that service gives us, plus the spaces you own and any space request you send. We never see your Google or GitHub password."],
  ["What a space keeps", "Agents, memories, chats and computers live inside each space, run for its owner. The sign-in service does not read them."],
  ["Waitlist", "If you join the waitlist we keep the email address and the company you give us, only to tell you when spaces open. Ask us and we remove it."],
  ["Cookies", "One keeps you signed in, and an anonymous visit counter (stored only as a hash) counts page views. No ads, no third-party trackers."],
  ["Deleting", "From your account page you can delete your account at any time, once it owns no space. For anything else, reach Turing Labs through github.com/turinglabsorg."],
];

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3"><circle cx="32" cy="32" r="18.5"/><g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="18.5" ry="5.6" stroke-opacity="0.38"/><path d="M13.5 32A18.5 5.6 0 0 0 50.5 32"/></g></g></svg>`;
const ICONS = {
  google: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1a6.6 6.6 0 0 1-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.8 14a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9L5.8 14Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7 0-.6 0-.6 1 .1 1.6 1.1 1.6 1.1 1 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.3.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.2 0c2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M21 4 3 11l6 2.5L18 7l-7 8 7.5 5L21 4Z"/></svg>`,
  app: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2v5m6-5v5M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function layout({ title = TITLE, description = DESCRIPTION, body, page = "", account = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#050505">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE}/">
<link rel="icon" href="${BASE}/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${BASE}/assets/cloud.css${VERSION}">
<script src="${BASE}/assets/cloud.js${VERSION}"></script>
</head>
<body class="${page}">
<header class="top">
  <a class="brand" href="${BASE}/" aria-label="Cora">${MARK}<span>Cora</span></a>
  <nav class="top-nav">
    ${page === "landing" ? `<a class="hide-sm" href="#work">How it works</a><a class="hide-sm" href="#byoi">Your AI</a><a class="hide-sm" href="${REPO}">Open source</a><a class="pill" href="#join">Join the waitlist</a>` : ""}
    ${page !== "landing" && account ? `<a class="pill" href="${BASE}/account">Your spaces</a>` : ""}
  </nav>
</header>
${body}
<footer class="foot">
  <div class="foot-brand">${MARK}<span>Cora</span></div>
  <div class="foot-links"><span>Made by Turing Labs</span><a href="${REPO}">Source on GitHub</a><a href="${BASE}/privacy">Privacy</a></div>
</footer>
</body>
</html>`;
}

function consoleCard() {
  const lines = SCRIPT.map(([time, who, kind, text]) => {
    const choices = kind === "ask" ? `<span class="tt-choices"><b>Yes</b><i>Not yet</i></span>` : "";
    return `<li class="tt-line shown ${kind}"><time>${time}</time><span class="tt-who">${who}${kind === "routine" ? `<span class="tt-tag">ROUTINE</span>` : ""}</span><span class="tt-text">${esc(text)}${choices}</span></li>`;
  }).join("");
  const stations = [["IRIS", 18, "#f2a93b"], ["OTTO", 41, "#6fa8dc"], ["MIRA", 63, "#e5533d"], ["LEO", 86, "#8cc56a"]]
    .map(([name, at, color]) => `<span class="station" style="--at:${at}%;--c:${color}"><i></i>${name}</span>`).join("");
  return `<div class="console" aria-hidden="true">
    <div class="console-head"><span class="lamp"><i></i>On air</span><span class="console-label"># ops · resident frequency</span><span class="clock" data-clock>09:15</span></div>
    <ol class="teletype" data-teletype>${lines}</ol>
    <div class="dial"><div class="dial-scale"></div>${stations}<span class="needle"></span></div>
  </div>`;
}

/** One thread that moves from Discord to Telegram to the app, and the agent keeps up. */
function places() {
  const windows = [
    ["discord", "ops", "Discord", [["MAYA", "owner", "Iris, can you get Monday's report ready?"], ["IRIS", "agent", "On it. I'll post it here by 9."]]],
    ["telegram", "Team", "Telegram", [["IRIS", "agent", "Monday's report is ready, the one Maya asked for in #ops."]]],
    ["app", "Iris", "The app", [["MAYA", "owner", "Thanks! Add last week's charts."], ["IRIS", "agent", "Added, and posted back in #ops."]]],
  ];
  return `<div class="places reveal" aria-hidden="true">${windows.map(([icon, title, where, lines], index) => `
    <div class="place" style="--i:${index}">
      <div class="place-head">${ICONS[icon]}<b>${title}</b><span>${where}</span></div>
      ${lines.map(([who, kind, text]) => `<p class="${kind}"><b>${who}</b>${esc(text)}</p>`).join("")}
    </div>`).join("")}</div>`;
}

/** Brains on the left, agents on the right, a cable for each choice. */
function patchBay() {
  const brains = [["CLAUDE", 60], ["CHATGPT", 150], ["OPEN MODELS", 240]];
  const agents = [["IRIS", 45, "#f2a93b", 0], ["OTTO", 115, "#6fa8dc", 1], ["MIRA", 185, "#e5533d", 2], ["LEO", 255, "#8cc56a", 0]];
  const cables = agents.map(([, y, color, brain], index) => {
    const from = brains[brain][1];
    return `<path class="cable" style="--d:${index * 0.6}s" d="M150 ${from} C 225 ${from + 70}, 250 ${y + 70}, 322 ${y}" stroke="${color}"/>`;
  }).join("");
  const jacks = (x, items, anchor) => items.map(([name, y, color]) => `
    <g class="jack"><circle cx="${x}" cy="${y}" r="11"/><circle cx="${x}" cy="${y}" r="5" class="hole"/>
    <text x="${anchor === "end" ? x - 20 : x + 20}" y="${y + 4}" text-anchor="${anchor}"${color ? ` fill="${color}"` : ""}>${name}</text></g>`).join("");
  return `<div class="patch reveal" aria-hidden="true">
    <svg viewBox="0 0 450 300" role="img">
      <rect x="1" y="1" width="448" height="298" rx="18" class="patch-plate"/>
      ${cables}
      ${jacks(150, brains, "end")}
      ${jacks(322, agents, "start")}
    </svg>
    <div class="patch-labels"><span>Your intelligence</span><span>Your agents</span></div>
  </div>`;
}

/** The orb: the Cora sphere, and every pulse is one of the agents doing something. */
function orb() {
  const chips = PULSES.map(([name, color, text], index) => `<li class="pulse-chip${index < 4 ? " still" : ""}" style="--c:${color}" data-slot="${index % 6}"><b>${name}</b><span>${esc(text)}</span></li>`).join("");
  return `<div class="orb" data-orb aria-hidden="true">
    <div class="orb-stage">
      <div class="orb-rings"><i></i><i></i><i></i></div>
      <svg class="orb-sphere" viewBox="0 0 200 200">
        <circle class="orb-core" cx="100" cy="100" r="66"/>
        <g class="orb-spin"><ellipse class="orb-meridian" cx="100" cy="100" rx="66" ry="66"/></g>
        <g class="orb-spin late"><ellipse class="orb-meridian" cx="100" cy="100" rx="66" ry="66"/></g>
        <g transform="rotate(-24 100 100)"><ellipse class="orb-back" cx="100" cy="100" rx="66" ry="20"/><path class="orb-front" d="M34 100A66 20 0 0 0 166 100"/></g>
        <circle class="orb-rim" cx="100" cy="100" r="66"/>
      </svg>
    </div>
    <ul class="pulse-chips">${chips}</ul>
  </div>`;
}

/** Joining the waitlist: an email and, if they like, the company. */
function waitlistForm(id, { joined, error }) {
  if (joined) return `<p class="joined" role="status"><b>You're on the list.</b> We'll write to you when spaces open.</p>`;
  const message = error === "invalid" ? "That email address doesn't look right." : error === "busy" ? "Too many requests right now. Try again in a minute." : "";
  return `<form class="waitlist" method="post" action="${BASE}/waitlist">
    <label class="sr" for="${id}-email">Work email</label>
    <input id="${id}-email" name="email" type="email" required maxlength="200" placeholder="you@company.com" autocomplete="email">
    <label class="sr" for="${id}-company">Company</label>
    <input id="${id}-company" name="company" maxlength="80" placeholder="Company (optional)" autocomplete="organization">
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <input type="hidden" name="from" value="${id}">
    <button class="btn primary" type="submit">Join the waitlist${ICONS.arrow}</button>
    ${message ? `<p class="alert" role="alert">${message}</p>` : ""}
  </form>`;
}

export function landing({ account, joined = false, waitlistError = "" }) {
  const strips = STRIPS.map(([ch, label, title, text, leds, level], index) => `
    <article class="strip reveal" style="--i:${index}">
      <header><span class="ch">${ch}</span><span class="strip-label">${label}</span></header>
      <h3>${title}</h3>
      <p>${text}</p>
      <div class="fader" style="--level:${level}%"><span></span></div>
      <ul class="leds">${leds.map((led, n) => `<li class="${["on", "warm", ""][n]}">${led}</li>`).join("")}</ul>
    </article>`).join("");
  const at = (time) => {
    const [h, m] = time.split(":").map(Number);
    return ((h * 60 + m) / 1440 * 100).toFixed(2);
  };
  const ruler = Array.from({ length: 25 }, (_, h) => `<span style="--at:${(h / 24 * 100).toFixed(3)}%"${h % 6 === 0 ? ` data-h="${String(h).padStart(2, "0")}"` : ""}></span>`).join("")
    + DAY.map(([time]) => `<i class="tick" style="--at:${at(time)}%"><b>${time}</b></i>`).join("");
  const day = DAY.map(([time, title, text], index) => `<li class="blip reveal" style="--i:${index}"><time>${time}</time><b>${title}</b><span>${text}</span></li>`).join("");
  const form = (id) => waitlistForm(id, { joined, error: waitlistError });
  // The bottom form lives in #join, the top one in #waitlist: each comes back to itself.
  const body = `
<main>
  <section class="hero" id="waitlist">
    ${orb()}
    <div class="hero-copy">
      <p class="kicker rise" style="--i:0">Cora · resident AI agents</p>
      <h1 class="hero-title"><span class="rise" style="--i:1">AI agents that live</span><span class="rise" style="--i:2">in your team chat.</span></h1>
      <p class="lead rise" style="--i:3">AI coworkers in your Discord, Telegram or their own app. Each has a memory, a schedule and its own computer. You bring the AI.</p>
      <div class="rise" style="--i:4">${form("top")}</div>
      <p class="hero-foot rise" style="--i:5"><span>Claude · ChatGPT · open models</span><span>Open source · MIT · <a href="${REPO}">self-host it</a></span></p>
    </div>
  </section>

  <section class="band work" id="work">
    <div class="split">
      <div class="section-head reveal"><p class="kicker">01 / On air</p><h2>Watch them work.</h2><p class="lead">They say what they're doing, and ask before what matters.</p></div>
      <div class="reveal">${consoleCard()}</div>
    </div>
  </section>

  <section class="band" id="where">
    <div class="split">
      <div class="section-head reveal"><p class="kicker">02 / Lives where your company is</p><h2>Already in your channels.</h2><p class="lead">Discord, Telegram or their own app. One conversation, wherever it happens.</p></div>
      ${places()}
    </div>
  </section>

  <section class="band byoi" id="byoi">
    <div class="split">
      <div class="byoi-head reveal">
        <span class="byoi-ico">${ICONS.plug}</span>
        <p class="kicker">03 / Bring your own intelligence</p>
        <h2><em>Bring your own</em> intelligence.</h2>
        <p class="lead">Your Claude or ChatGPT subscription, or open models. Agent by agent, switch any time.</p>
      </div>
      ${patchBay()}
    </div>
  </section>

  <section class="band">
    <div class="section-head reveal"><p class="kicker">04 / The desk</p><h2>Residents, not chatbots.</h2></div>
    <div class="strips">${strips}</div>
  </section>

  <section class="band day-band">
    <div class="section-head reveal"><p class="kicker">05 / 24 hours on air</p><h2>A day in the life.</h2></div>
    <div class="day">
      <div class="ruler" aria-hidden="true">${ruler}<i class="now" data-now></i></div>
      <ol class="blips">${day}</ol>
    </div>
  </section>

  <section class="band harness" id="harness">
    <div class="split">
      <div class="section-head reveal"><p class="kicker">06 / The Cora harness</p><h2>Built to finish the job.</h2><p class="lead">Our own agent loop, for any model. Or run your agents on Claude Code or Codex with your subscriptions.</p></div>
      <ol class="harness-loop reveal" aria-label="The Cora harness">${HARNESS.map(([title, text], index) => `<li style="--i:${index}"><span class="loop-led"></span><b>${title}</b><span>${text}</span></li>`).join("")}</ol>
    </div>
  </section>

  <section class="band space" id="join">
    <div class="section-head reveal"><p class="kicker">07 / Your space</p><h2>Your company's frequency.</h2><p class="lead">Hosted, ready to go. We open spaces a few at a time.</p></div>
    <p class="frequency reveal"><span class="freq-name" data-names="yourcompany,acme,studio,night-shift,atelier">yourcompany</span><span class="freq-domain">.usecora.space</span></p>
    <div class="space-actions reveal">${form("bottom")}</div>
    <div class="self reveal">
      <div><h3>Rather run it yourself?</h3><p>Open source, MIT. Keep everything in-house.</p></div>
      <code>git clone ${REPO}</code>
    </div>
  </section>
</main>`;
  return layout({ body, page: "landing", account });
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
  const spaceList = spaces.map((space) => `
    <li class="space-row">
      <span class="lamp on"><i></i>On air</span>
      <span class="space-name"><b>${esc(space.slug)}</b>.${esc(domain)}</span>
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
