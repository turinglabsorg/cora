import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSubscriptionUsage } from "./subscription-usage.js";

const failure = (code, retryAfterMs = 0) => Object.assign(new Error("Subscription usage unavailable"), { code, retryAfterMs });

async function jsonFile(path) {
  if ((await stat(path)).size > 65536) throw failure("AUTH_REQUIRED");
  return JSON.parse(await readFile(path, "utf8"));
}

function keychain(service) {
  return new Promise((resolve) => execFile("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], { timeout: 8000, maxBuffer: 65536 }, (error, output) => {
    if (error) return resolve(null);
    try {
      const text = output.trim();
      resolve(JSON.parse(/^(?:[a-f0-9]{2})+$/i.test(text) ? Buffer.from(text, "hex").toString("utf8") : text));
    } catch { resolve(null); }
  }));
}

async function credentials(provider, directory, resident) {
  if (provider === "claude") {
    const suffix = resident && !process.env.CLAUDE_CONFIG_DIR ? "" : `-${createHash("sha256").update(directory.normalize("NFC")).digest("hex").slice(0, 8)}`;
    let data = process.platform === "darwin" ? await keychain(`Claude Code-credentials${suffix}`) : null;
    if (!data) data = await jsonFile(join(directory, ".credentials.json")).catch(() => null);
    const token = data?.claudeAiOauth?.accessToken;
    if (typeof token === "string" && token) return { token };
  } else if (provider === "grok") {
    const data = await jsonFile(join(directory, "auth.json")).catch(() => ({}));
    const keys = Object.keys(data).sort(), preferred = keys.filter((key) => key === "https://auth.x.ai" || key.startsWith("https://auth.x.ai::"));
    const entries = (preferred.length ? preferred : keys).map((key) => data[key]).filter((entry) => typeof entry?.key === "string" && entry.key);
    const entry = entries.find((item) => Date.parse(item.expires_at) > Date.now() + 300000) || entries[0];
    if (entry) return { token: entry.key, userId: typeof entry.user_id === "string" ? entry.user_id : "" };
  }
  throw failure("AUTH_REQUIRED");
}

async function responseJSON(response) {
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const delay = /^\d+(?:\.\d+)?$/.test(retry || "") ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    await response.body?.cancel();
    throw failure("RATE_LIMITED", Math.max(0, delay || 0));
  }
  if (!response.ok) { await response.body?.cancel(); throw failure([401, 403].includes(response.status) ? "AUTH_REQUIRED" : "UNAVAILABLE"); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > 256 * 1024) { await response.body.cancel().catch(() => {}); throw failure("UNAVAILABLE"); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// The child consumes only the selected native session; only numeric quota snapshots leave it.
export async function readNativeUsage({ provider, directory, resident = false, credentialReader = credentials, request = fetch }) {
  if (!["claude", "grok"].includes(provider)) throw failure("UNSUPPORTED");
  const auth = await credentialReader(provider, directory, resident);
  const headers = { Authorization: `Bearer ${auth.token}` };
  if (provider === "claude") Object.assign(headers, { "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.0" });
  else { headers["X-XAI-Token-Auth"] = "xai-grok-cli"; if (auth.userId) headers["x-userid"] = auth.userId; }
  const get = async (url) => responseJSON(await request(url, { headers, redirect: "error", signal: AbortSignal.timeout(12000) }));
  let data = await get(provider === "claude" ? "https://api.anthropic.com/api/oauth/usage" : "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
  let windows = parseSubscriptionUsage(provider, data);
  if (provider === "grok" && !windows.length) { data = await get("https://cli-chat-proxy.grok.com/v1/billing"); windows = parseSubscriptionUsage(provider, data); }
  return { normalized: true, windows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  readNativeUsage({ provider: process.argv[2], directory: resolve(process.argv[3]), resident: process.argv[4] === "resident" }).then(
    (value) => process.stdout.write(JSON.stringify(value)),
    (error) => { process.stdout.write(JSON.stringify({ error: ["AUTH_REQUIRED", "RATE_LIMITED", "UNSUPPORTED"].includes(error.code) ? error.code : "UNAVAILABLE", retryAfterMs: Number(error.retryAfterMs) || 0 })); process.exitCode = 1; },
  );
}
