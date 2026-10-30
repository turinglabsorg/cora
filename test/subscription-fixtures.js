import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Provider-shaped login processes with isolated identities and no real credentials. */
export function identityCli() {
  const root = mkdtempSync(join(tmpdir(), "cora-identities-"));
  const control = join(root, "control.json");
  const calls = join(root, "calls.jsonl");
  writeFileSync(control, JSON.stringify({ complete: false }));
  const source = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const provider = path.basename(process.argv[1]);
const argv = process.argv.slice(2);
// Grok runs in Cora's own home and reads the login where GROK_AUTH_PATH says; Muse keeps it in XDG_CONFIG_HOME.
const directory = process.env.CODEX_HOME || process.env.CLAUDE_CONFIG_DIR || (process.env.GROK_AUTH_PATH ? path.dirname(process.env.GROK_AUTH_PATH) : process.env.GROK_HOME) || process.env.XDG_CONFIG_HOME;
if (!directory) process.exit(9);
const marker = path.join(directory, "fixture-account.json");
const state = () => JSON.parse(fs.readFileSync(${JSON.stringify(control)}, "utf8"));
const saved = () => { try { return JSON.parse(fs.readFileSync(marker, "utf8")); } catch { return null; } };
const save = () => { const account = { email: path.basename(directory) + "@example.test", planType: "pro", type: "chatgpt" }; fs.writeFileSync(marker, JSON.stringify(account)); return account; };
const line = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
if (argv.includes("app-server")) {
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", (text) => {
    const message = JSON.parse(text);
    if (!message.id) return;
    const reply = (result) => line({ id: message.id, result });
    if (message.method === "initialize") return reply({});
    if (message.method === "account/read") return reply({ account: saved(), requiresOpenaiAuth: true });
    if (message.method === "account/login/start") {
      if (state().fail) { line({ id: message.id, error: { message: "fixture login failed with private provider detail" } }); return; }
      reply({ type: "chatgptDeviceCode", loginId: "fixture-login", verificationUrl: state().evilUrl || "https://auth.openai.com/codex/device", userCode: "TEST-ONLY" });
      const timer = setInterval(() => { if (state().complete) { clearInterval(timer); save(); line({ method: "account/login/completed", params: { success: true } }); } }, 50);
    }
  });
} else if (argv[0] === "login" && (provider === "grok" || provider === "muse")) {
  const code = state().evilUrl ? "EVIL-CODE" : "TEST-ONLY";
  const url = state().evilUrl || (provider === "grok" ? "https://accounts.x.ai/oauth2/device?user_code=" + code : "https://auth.meta.com/oauth/device/?code=" + code);
  process.stdout.write("Open this page to sign in:\\n  " + url + "\\nconfirm this code matches:\\n  " + code + "\\n\\nWaiting for approval...\\n");
  const timer = setInterval(() => { if (state().complete) { clearInterval(timer); save(); process.stdout.write("Logged in.\\n"); process.exit(0); } }, 50);
} else if (argv[0] === "models" && provider === "grok") {
  process.stdout.write(saved() ? "You are logged in with grok.com.\\n\\nAvailable models:\\n  * grok-4.7 (default)\\n" : "You are not authenticated.\\n");
} else if (argv[0] === "usage" && provider === "muse") {
  process.stdout.write(saved() ? "Tier: Muse Code High Usage\\nWindow: 0% used\\n" : "muse usage: not logged in: run \`muse login\` first\\n");
} else if (argv[0] === "auth" && argv[1] === "status") {
  const account = saved();
  line({ loggedIn: Boolean(account), authMethod: account ? "claude.ai" : "none", email: account?.email || "", subscriptionType: account?.planType || "", configDirectory: state().wrongDirectory ? "/global-profile" : directory });
  process.exit(account ? 0 : 1);
} else if ((argv[0] === "auth" && argv[1] === "logout") || argv.includes("logout")) {
  fs.rmSync(marker, { force: true }); process.exit(0);
} else if (argv[0] === "auth" && argv[1] === "login") {
  process.stdout.write("https://claude.com/cai/oauth/authorize?code=true&state=fixture\\nPaste code here > ");
  readline.createInterface({ input: process.stdin }).on("line", (code) => {
    if (code !== "fixture-authorization-code") process.exit(1);
    save(); process.exit(0);
  });
} else {
  const input = [];
  process.stdin.on("data", (chunk) => input.push(chunk));
  process.stdin.on("end", () => {
    const account = saved();
    const record = { provider, directory, argv, account: account?.email, inheritedKeys: Object.keys(process.env).filter((key) => /TOKEN|API_KEY|AUTH_TOKEN/.test(key)) };
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(record) + "\\n");
    if (!account) { process.stderr.write(provider === "grok" ? "Not signed in. Run \`grok login\` to authenticate." : "Login expired · Please run /login"); process.exit(1); }
    const text = "Identity: " + account.email;
    if (provider === "claude" || provider === "grok") line({ type: "result", result: text });
    else if (provider === "muse") line({ payload_type: "run.terminal.completed", payload: { terminal: "completed", text } });
    else { fs.writeFileSync(argv[argv.indexOf("-o") + 1], text); line({ type: "item.completed", item: { type: "agent_message", text } }); }
  });
}
`;
  for (const provider of ["claude", "codex", "grok", "muse"]) {
    writeFileSync(join(root, provider), source);
    chmodSync(join(root, provider), 0o755);
  }
  return {
    claude: join(root, "claude"), codex: join(root, "codex"), grok: join(root, "grok"), muse: join(root, "muse"),
    set: (value) => writeFileSync(control, JSON.stringify(value)),
    calls: () => { try { return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } },
  };
}
