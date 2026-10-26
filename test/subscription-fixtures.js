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
const directory = process.env.CODEX_HOME || process.env.CLAUDE_CONFIG_DIR;
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
    if (!account) { process.stderr.write("Login expired · Please run /login"); process.exit(1); }
    const text = "Identity: " + account.email;
    if (provider === "claude") line({ type: "result", result: text });
    else { fs.writeFileSync(argv[argv.indexOf("-o") + 1], text); line({ type: "item.completed", item: { type: "agent_message", text } }); }
  });
}
`;
  for (const provider of ["claude", "codex"]) {
    writeFileSync(join(root, provider), source);
    chmodSync(join(root, provider), 0o755);
  }
  return {
    claude: join(root, "claude"), codex: join(root, "codex"),
    set: (value) => writeFileSync(control, JSON.stringify(value)),
    calls: () => { try { return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } },
  };
}
