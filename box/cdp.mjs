#!/usr/bin/env node
// Talk to the Chromium the owner can see, over its debugging port: the same window,
// the same session, no automation flags. Pixels come from the computer tool; this is
// for what pixels cannot say — the DOM, the page's own data, where the requests went.
// Cookie values and storage values are never printed: a session is not evidence.
const PORT = process.env.CORA_CDP_PORT || "9222";
const BASE = `http://127.0.0.1:${PORT}`;
const LIMIT = 60000;

const [action, ...rest] = process.argv.slice(2);
const argument = rest.join(" ");

async function targets() {
  const response = await fetch(`${BASE}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`chromium is not listening on ${PORT}`);
  return (await response.json()).filter((target) => target.type === "page");
}

/** The page in front, or the one whose url was asked for. */
async function page(match = "") {
  const pages = await targets();
  if (!pages.length) throw new Error("no page open");
  const wanted = match ? pages.find((target) => target.url.includes(match)) : null;
  return wanted || pages[0];
}

function send(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error(`${method}: timeout`)); }, 30000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      let payload;
      try { payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")); } catch { return; }
      socket.close();
      if (payload.error) reject(new Error(`${method}: ${payload.error.message}`));
      else resolve(payload.result);
    });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`${method}: cannot reach the page`)); });
  });
}

async function evaluate(target, expression) {
  const result = await send(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "the page refused the script");
  return result.result?.value;
}

const cut = (text) => String(text ?? "").slice(0, LIMIT);

const actions = {
  async targets() {
    return (await targets()).map((target) => ({ title: target.title, url: target.url }));
  },
  async text() {
    const target = await page();
    return {
      url: target.url,
      title: target.title,
      text: cut(await evaluate(target, "document.body ? document.body.innerText : ''")),
    };
  },
  async html() {
    const target = await page();
    const selector = argument || "body";
    return { url: target.url, selector, html: cut(await evaluate(target, `(document.querySelector(${JSON.stringify(selector)}) || {}).outerHTML || ''`)) };
  },
  async query() {
    const target = await page();
    return {
      url: target.url,
      matches: await evaluate(target, `[...document.querySelectorAll(${JSON.stringify(argument)})].slice(0, 50).map((node) => ({
        tag: node.tagName.toLowerCase(),
        text: (node.innerText || node.value || "").slice(0, 300),
        id: node.id || undefined,
        name: node.getAttribute("name") || undefined,
        href: node.getAttribute("href") || undefined,
      }))`),
    };
  },
  async eval() {
    const target = await page();
    return { url: target.url, value: await evaluate(target, argument) };
  },
  /** Which sessions this browser holds: names and scope, never the values. */
  async cookies() {
    const target = await page();
    const { cookies } = await send(target, "Network.getAllCookies");
    return {
      count: cookies.length,
      cookies: cookies.slice(0, 200).map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        session: cookie.session,
        expires: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null,
        size: cookie.value.length,
      })),
    };
  },
  async storage() {
    const target = await page();
    return {
      url: target.url,
      local: await evaluate(target, "Object.entries(localStorage).slice(0, 100).map(([k, v]) => ({ key: k, size: String(v).length }))"),
      session: await evaluate(target, "Object.entries(sessionStorage).slice(0, 100).map(([k, v]) => ({ key: k, size: String(v).length }))"),
    };
  },
  /** What the page actually fetched, from its own performance log. */
  async network() {
    const target = await page();
    return {
      url: target.url,
      requests: await evaluate(target, `performance.getEntriesByType("resource").slice(-60).map((entry) => ({
        url: entry.name.slice(0, 300),
        kind: entry.initiatorType,
        ms: Math.round(entry.duration),
        bytes: entry.transferSize || 0,
      }))`),
    };
  },
  async goto() {
    const target = await page();
    await send(target, "Page.navigate", { url: argument });
    return { url: argument, navigating: true };
  },
};

const run = actions[action];
if (!run) {
  console.error(`usage: cora-cdp <${Object.keys(actions).join("|")}> [argument]`);
  process.exit(2);
}
run().then(
  (result) => console.log(JSON.stringify(result)),
  (error) => { console.error(error.message); process.exit(1); },
);
