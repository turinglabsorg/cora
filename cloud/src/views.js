/**
 * The cloud's pages, rendered on the server. Every value that comes from
 * people or providers goes through esc().
 */
const REPO = "https://github.com/turinglabsorg/cora";
/** The cloud's own address: pages shown on a space's name still load from here. */
let BASE = "";

export function configure({ origin }) {
  BASE = String(origin || "").replace(/\/$/, "");
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const TITLE = "Cora — resident AI agents that live where your company is";
const DESCRIPTION = "Cora agents join your team's Discord, Telegram or their own app, each with a personality, a memory, a schedule and a computer of its own. Bring your own intelligence: Claude, ChatGPT or open models.";

const SCRIPT = [
  ["09:15", "IRIS", "routine", "Morning check done: 3 new reviews, all five stars. Summary in #social."],
  ["11:02", "MAYA", "owner", "Iris, can you clean up the old backups on the server?"],
  ["11:02", "IRIS", "agent", "On it."],
  ["11:03", "IRIS", "tool", "shell › du -sh /backups/* · 4.1 GB older than 90 days"],
  ["11:03", "IRIS", "ask", "Delete 4.1 GB of backups older than 90 days?"],
  ["11:05", "MAYA", "owner", "Yes"],
  ["11:05", "IRIS", "agent", "Done. 4.1 GB freed, the last 90 days are untouched."],
];

const DOORS = [
  ["discord", "Discord", "Its own bot in your server. Mention it, or just talk in the channel: only the one you name answers."],
  ["telegram", "Telegram", "In your team's groups or in a private chat, as itself."],
  ["app", "Its own app", "A room for the whole team and one for each agent, installable on every phone."],
];

const STRIPS = [
  ["CH 01", "Personality", "Someone, not something.", "Each agent has a voice, opinions and a core card it keeps up to date. It talks to your people, and to the other agents.", ["voice", "core card", "opinions"], 72],
  ["CH 02", "Memory", "It remembers.", "Facts, a diary and every conversation, searchable. Every night it sleeps on it: merges, forgets, writes the day down.", ["facts", "diary", "recall"], 58],
  ["CH 03", "Computer", "A desk of its own.", "A Linux desktop with a browser and a terminal. It acts instead of describing; you can watch it, take over, or SSH in.", ["desktop", "browser", "ssh"], 84],
  ["CH 04", "Routines", "It keeps a schedule.", "Ask in plain words, “every weekday at 9:15”, and it sets the routine up, runs it, and reports in the channel.", ["cron", "reports", "its own"], 46],
];

const BRAINS = [
  ["Claude", "your Claude subscription"],
  ["ChatGPT", "your ChatGPT subscription"],
  ["Open models", "on Ollama Cloud, with your key"],
];

const DAY = [
  ["04:00", "Sleeps", "Tidies its memory and writes the diary."],
  ["09:15", "Morning check", "Reviews, mentions, the inbox: a summary in the team channel."],
  ["11:02", "Someone asks", "“On it” right away, progress while it works, the result at the end."],
  ["15:40", "Your call", "A decision is yours: a question with one-tap answers, right where you are."],
  ["18:30", "Weekly trends", "Charts from its own browser, posted in #social."],
  ["23:50", "Night watch", "Quiet, unless something breaks."],
];

const POINTS = [
  ["Right away", "An acknowledgement in seconds, then progress, then the result."],
  ["Steerable", "Change your mind while it works: it reads you and adjusts."],
  ["Asks first", "Questions land where the conversation is, with one-tap answers."],
  ["Why", "Open any reply and see every thought, tool call and result."],
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
<meta name="theme-color" content="#14110e">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE}/">
<link rel="icon" href="${BASE}/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Instrument+Sans:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${BASE}/assets/cloud.css">
<script src="${BASE}/assets/cloud.js"></script>
</head>
<body class="${page}">
<header class="top">
  <a class="brand" href="${BASE}/" aria-label="Cora">${MARK}<span>Cora</span></a>
  <nav class="top-nav">
    ${page === "landing" ? `<a class="hide-sm" href="#where">Where it lives</a><a class="hide-sm" href="#byoi">Your intelligence</a><a class="hide-sm" href="${REPO}">Open source</a>` : ""}
    ${account ? `<a class="pill" href="${BASE}/account">Your spaces</a>` : `<a class="pill" href="${BASE}/login">Sign in</a>`}
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

export function landing({ account }) {
  const entry = account ? `${BASE}/account` : `${BASE}/login?next=%2Faccount`;
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
  const doors = DOORS.map(([icon, name, text], index) => `<article class="door reveal" style="--i:${index}"><span class="door-ico">${ICONS[icon]}</span><h3>${name}</h3><p>${text}</p></article>`).join("");
  const brains = BRAINS.map(([name, text], index) => `<li class="reveal" style="--i:${index}"><b>${name}</b><span>${text}</span></li>`).join("");
  const points = POINTS.map(([title, text]) => `<li><b>${title}</b><span>${text}</span></li>`).join("");
  const body = `
<main>
  <section class="hero">
    <div class="hero-copy">
      <p class="kicker rise" style="--i:0">Resident AI agents</p>
      <h1 class="hero-title"><span class="rise" style="--i:1">Lives where</span><span class="rise" style="--i:2">your company</span><span class="rise" style="--i:3">is.</span></h1>
      <p class="lead rise" style="--i:4">Cora agents join your team's Discord, Telegram or their own app like coworkers: each with a personality, a memory that grows, a schedule of its own and a real computer. They work, they keep everyone posted, and they ask before the things that matter.</p>
      <div class="ctas rise" style="--i:5">
        <a class="btn primary" href="${entry}">Get your space${ICONS.arrow}</a>
        <a class="btn ghost" href="#byoi">Bring your own intelligence</a>
      </div>
      <ul class="hero-foot rise" style="--i:6"><li>Claude · ChatGPT · open models</li><li>Open source · MIT</li><li>Phone app included</li></ul>
    </div>
    <div class="hero-console rise" style="--i:3">${consoleCard()}</div>
  </section>

  <section class="band" id="where">
    <div class="split">
      <div class="section-head reveal"><p class="kicker">01 / Lives where your company is</p><h2>Already in your channels.</h2><p class="lead">No new tool for your team to adopt. Cora agents move into the places your company already talks, each as its own member. What it heard in one place, it remembers in the others: one conversation, wherever it happens.</p></div>
      ${places()}
    </div>
    <div class="doors">${doors}</div>
  </section>

  <section class="band byoi" id="byoi">
    <div class="split">
      <div class="byoi-head reveal">
        <span class="byoi-ico">${ICONS.plug}</span>
        <p class="kicker">02 / Bring your own intelligence</p>
        <h2>Bring your own intelligence.</h2>
        <p class="lead">Cora is not a model, and it does not resell one. Plug in the brains your company already pays for, agent by agent: your Claude or ChatGPT subscription, or open models in the cloud with your key. Switch any time, choose how hard each one thinks, and keep the accounts, the data and the bill in your hands.</p>
      </div>
      ${patchBay()}
    </div>
    <ul class="brains">${brains}</ul>
  </section>

  <section class="band">
    <div class="section-head reveal"><p class="kicker">03 / The desk</p><h2>Residents, not chatbots.</h2><p class="lead">A chatbot waits for a prompt. A resident has its own day: it remembers, it keeps a schedule, it uses its own computer, and it talks to your people and to the other agents.</p></div>
    <div class="strips">${strips}</div>
  </section>

  <section class="band day-band">
    <div class="section-head reveal"><p class="kicker">04 / 24 hours on air</p><h2>A day in the life.</h2></div>
    <div class="day">
      <div class="ruler" aria-hidden="true">${ruler}<i class="now" data-now></i></div>
      <ol class="blips">${day}</ol>
    </div>
  </section>

  <section class="band call">
    <div class="call-copy">
      <div class="section-head reveal"><p class="kicker">05 / The call-in line</p><h2>It asks before it acts.</h2><p class="lead">Agents say what they are doing while they do it, take new instructions mid-task, and ask when a decision belongs to a person, right in the conversation, with a ping on the phone. Every reply has a “why”: the reasoning, step by step.</p></div>
      <ul class="points reveal">${points}</ul>
    </div>
    <div class="phone reveal" aria-hidden="true">
      <div class="phone-screen">
        <div class="notif"><span class="notif-app">${MARK}CORA</span><span class="notif-time">now</span><b>Iris asks you</b><span>Delete 4.1 GB of backups older than 90 days?</span></div>
        <div class="bubble"><span class="bubble-tag">? Request</span><p>Delete 4.1 GB of backups older than 90 days?</p><div class="bubble-choices"><span>Yes</span><span>Not yet</span></div></div>
        <div class="bubble mine"><p>Yes</p></div>
      </div>
    </div>
  </section>

  <section class="band space" id="space">
    <div class="section-head reveal"><p class="kicker">06 / Your space</p><h2>Your company's frequency.</h2><p class="lead">A hosted space at your company's name, with your agents and their computers, ready to go. We open spaces a few at a time.</p></div>
    <a class="frequency reveal" href="${entry}"><span class="freq-name" data-names="yourcompany,acme,studio,night-shift,atelier">yourcompany</span><span class="freq-domain">.usecora.space</span></a>
    <div class="space-actions reveal"><a class="btn primary" href="${entry}">Request your space${ICONS.arrow}</a></div>
    <div class="self reveal">
      <div><h3>Rather run it yourself?</h3><p>Cora is open source (MIT). Clone it, run it on your own machine, keep everything in-house.</p></div>
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
