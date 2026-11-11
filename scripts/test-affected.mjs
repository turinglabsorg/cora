#!/usr/bin/env node
// Runs only the tests that cover the files changed against a base ref (default origin/main).
// Usage: node scripts/test-affected.mjs [--base <ref>] [--full] [--dry-run]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = option("--base", "origin/main");
const dryRun = flag("--dry-run");

// Shared core: every test path goes through these files, so a change here runs the whole suite.
const FULL = [
  /^package(-lock)?\.json$/,
  /^src\/(main|store|orchestrator|brain|tools|mcp-server|bridge|cli|llm|config|thread-state|rooms|channels|harnesses)\.m?js$/,
  /^test\/(helpers|panel)\.js$/,
];

// Paths that no test exercises.
const NONE = [/^docs\//, /\.md$/, /^LICENSE$/, /^\.gitignore$/, /^deploy\//, /^bin\/(icons|login-link|cli-smoke|hermes-smoke)\.mjs$/, /^web\/.*\.(png|svg|webmanifest)$/, /^scripts\/test-affected\.mjs$/, /^node_modules$/];

const PANEL = {
  files: ["connections", "key-connectors", "hermes-keys", "access", "permissions"],
  cora: ["external configuration MCP", "shared owner controls", "panel auth", "routine workspaces", "subscription preparation", "manual subscription codes", "Claude OAuth", "device-code"],
};

// Each area: the paths it owns, the test files that cover it and the cora.test.js groups (name prefixes).
const AREAS = [
  { name: "panel", paths: [/^web\/(app|i18n|index|sw)\.(js|html)$/, /^web\/styles\.css$/, /^src\/web\.js$/], ...PANEL },
  { name: "hermes keys", paths: [/^src\/(hermes-keys|credentials)\.js$/], files: ["hermes-keys", "deepseek", "connections"], cora: ["what runs the models"] },
  { name: "connectors", paths: [/^src\/connectors\//, /^test\/google-connector-fixtures\.js$/], files: ["key-connectors", "connections"], cora: ["external configuration MCP returns a browser handoff"] },
  { name: "artifacts", paths: [/^src\/(artifacts|share-host|share-drive)\.js$/], files: ["artifacts", "artifact-shares", "cloud"], cora: ["artifact "] },
  { name: "vault", paths: [/^src\/(vault|secrets|send-pages)\.js$/, /^web\/send\.js$/], files: ["vault"], cora: [] },
  { name: "voice", paths: [/^src\/voice\.js$/], files: ["voice"], cora: ["voice "] },
  { name: "character", paths: [/^src\/character\.js$/], files: ["character"], cora: ["agent character sheet"] },
  { name: "usage", paths: [/^src\/(usage|provider-usage|subscription-usage|subscription-usage-worker)\.js$/], files: ["usage", "deepseek"], cora: ["subscription usage"] },
  { name: "subscriptions", paths: [/^src\/(subscriptions|subscription-browser|gemini-profile|gemini-quota)\.js$/, /^src\/subscription-terminal\.py$/, /^test\/subscription-fixtures\.js$/], files: ["connections", "model-catalogs"], cora: ["per-agent subscription", "subscription ", "manual subscription", "Claude OAuth", "device-code", "Gemini "] },
  { name: "mail", paths: [/^src\/(mail-domains|email-channel|desktop-mail|desktop-mailbox)\.m?js$/, /^src\/mail\//, /^test\/mail-fixtures\.js$/], files: ["mail-domains", "key-connectors"], cora: ["a managed default email domain", "agent mailboxes", "email channel"] },
  { name: "discord", paths: [/^src\/(discord|agent-bots)\.js$/], files: ["units"], cora: ["agents in Discord", "Discord ", "listening without a dedicated bot", "shared listening", "direct messages"] },
  { name: "telegram", paths: [/^src\/(telegram|telegram-bots|telegram-setup)\.js$/], files: ["permissions"], cora: ["agents in Telegram", "Telegram "] },
  { name: "slack", paths: [/^src\/(slack|slack-bots|slack-apps)\.js$/], files: ["units"], cora: ["agents in Slack", "a fresh memory boundary", "the space owner connects Slack"] },
  { name: "process usage", paths: [/^src\/process-usage\.js$/], files: ["process-usage"] },
  { name: "thread sessions", paths: [/^src\/thread-sessions\.js$/], files: ["thread-sessions", "reminders"], cora: ["thread goal lifecycle"] },
  { name: "scheduler", paths: [/^src\/(scheduler|traces)\.js$/], files: ["reminders", "units"], cora: ["routine workspaces"] },
  { name: "knowledge", paths: [/^src\/(company-brain|librarian|brain-db|knowledge|memory|context)\.js$/, /^test\/knowledge-fixtures\.js$/], files: ["brain", "context", "usage"], cora: ["owner memory", "shared agent owners", "an agent CLI cannot inherit", "a Brain link", "an external agent Brain", "immediate company brain"] },
  { name: "desktop", paths: [/^src\/(box|desktop-github|desktop-git-setup|desktop-ssh|git-attribution|github-apps)\.m?js$/, /^src\/desktop-git\.sh$/, /^box\//, /^test\/git-launcher-fixtures\.js$/], files: ["file-sharing", "github", "artifacts"], cora: ["Cora commit attribution", "automatic attribution", "desktop Git attribution", "git_commit"] },
  { name: "access", paths: [/^src\/(access-invitations|pass)\.js$/, /^test\/invitation-fixtures\.js$/], files: ["access", "cloud", "permissions"], cora: ["access invitations", "invitation delivery", "panel auth", "sharing recipients", "owner isolation", "agent permissions"] },
  { name: "cloud", paths: [/^cloud\//], files: ["cloud"], cora: ["hosted on usecora.space"] },
  { name: "images", paths: [/^src\/(images|png|avatar)\.js$/], files: ["units"], cora: ["router image", "Discord images", "Telegram photos", "Telegram reply photos", "conversation image"] },
  { name: "doc", paths: [/^src\/doc\.js$/], files: [], cora: ["doc in the Cora harness"] },
  { name: "panel MCP", paths: [/^src\/panel-mcp\.js$/], files: [], cora: ["external configuration MCP"] },
  { name: "notifications", paths: [/^src\/push\.js$/], files: [], cora: ["notifications and requests"] },
  { name: "on-prem", paths: [/^bin\/run\.sh$/], files: [], cora: ["installed on the customer's own machine"] },
];

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = [...new Set([
  ...git("diff", "--name-only", `${base}...HEAD`),
  ...git("diff", "--name-only", "HEAD"),
  ...git("ls-files", "--others", "--exclude-standard"),
])];

const full = flag("--full") ? ["--full"] : changed.filter((f) => FULL.some((r) => r.test(f)));
const files = new Set(["units"]);
const cora = new Set();
const areas = new Set();
const unknown = [];
for (const f of changed) {
  if (FULL.some((r) => r.test(f)) || NONE.some((r) => r.test(f))) continue;
  const test = f.match(/^test\/([a-z0-9-]+)\.test\.js$/);
  if (test) { files.add(test[1]); continue; }
  const hits = AREAS.filter((a) => a.paths.some((r) => r.test(f)));
  if (!hits.length) { unknown.push(f); continue; }
  for (const a of hits) { areas.add(a.name); a.files.forEach((x) => files.add(x)); a.cora.forEach((x) => cora.add(x)); }
}

const nodeArgs = ["--disable-warning=ExperimentalWarning", "--test"];
const run = (extra, list) => {
  console.log(`$ node --test ${extra.join(" ")} ${list.join(" ")}`);
  if (dryRun) return 0;
  return spawnSync(process.execPath, [...nodeArgs, ...extra, ...list], { stdio: "inherit" }).status ?? 1;
};

console.log(`changed against ${base}: ${changed.length} file(s)`);
if (full.length || unknown.length) {
  const why = full.length ? `shared core changed (${full.join(", ")})` : `no test mapping for ${unknown.join(", ")}`;
  console.log(`FULL SUITE: ${why}`);
  const all = readdirSync("test").filter((f) => f.endsWith(".test.js")).map((f) => `test/${f}`);
  process.exit(run([], all));
}
if (!areas.size && files.size === 1) {
  console.log("Only docs/deploy files changed: running the fast unit tests.");
}
console.log(`areas: ${[...areas].join(", ") || "none"}`);
const list = [...files].map((f) => `test/${f}.test.js`).filter((f) => existsSync(f) && (f !== "test/cora.test.js" || !cora.size));
let status = run([], list);
if (cora.size && !files.has("cora")) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `^(${[...cora].map(escape).join("|")})`;
  status = run([`--test-name-pattern=${pattern}`], ["test/cora.test.js"]) || status;
}
process.exit(status);
