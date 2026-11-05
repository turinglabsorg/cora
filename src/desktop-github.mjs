// Runs on an agent's desktop, as the agent: its GitHub App's hour-long tokens where git and gh read them.
// Input on stdin: { tokens: [{ account, token }], primary, login, name, email } to sign in, or { remove: true }.
// Each account the app is installed on has its own token: git picks it from the repository's owner, gh uses
// the primary one unless GH_TOKEN names another.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const home = process.env.HOME || "/home/agent";
const dir = `${home}/.config/cora`;
const perAccount = `${dir}/github-tokens`;
const tokenFile = `${dir}/github-token`;
const hosts = `${home}/.config/gh/hosts.yml`;
const MARK = "# written by Cora: the agent's GitHub App, renewed every hour\n";
const ACCOUNT = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;
const git = (...args) => execFileSync("git", ["config", "--global", ...args], { stdio: ["ignore", "ignore", "pipe"] });
// git sends the repository's path (with useHttpPath): its owner names the token; without one, the primary.
const HELPER = '!f() { test "$1" = get || exit 0; owner=; while IFS== read -r key value; do [ "$key" = path ] && owner=$(printf %s "${value%%/*}" | tr "[:upper:]" "[:lower:]"); done; file="$HOME/.config/cora/github-tokens/$owner"; { [ -n "$owner" ] && [ -r "$file" ]; } || file="$HOME/.config/cora/github-token"; echo username=x-access-token; printf "password=%s\\n" "$(cat "$file")"; }; f';

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.remove) {
    rmSync(tokenFile, { force: true });
    rmSync(perAccount, { recursive: true, force: true });
    for (const key of ["credential.https://github.com.helper", "credential.https://github.com.useHttpPath"]) try { git("--unset-all", key); } catch {}
    // The app's identity goes with it: commits made afterwards are not signed as its bot.
    let email = "";
    try { email = execFileSync("git", ["config", "--global", "user.email"], { encoding: "utf8" }).trim(); } catch {}
    if (email.endsWith("[bot]@users.noreply.github.com")) for (const key of ["user.name", "user.email"]) try { git("--unset", key); } catch {}
    if (existsSync(hosts) && readFileSync(hosts, "utf8").startsWith(MARK)) rmSync(hosts, { force: true });
  } else {
    const tokens = (Array.isArray(input.tokens) ? input.tokens : []).map((item) => ({ account: String(item.account || "").toLowerCase(), token: String(item.token || "") }));
    if (!tokens.length || tokens.some((item) => !ACCOUNT.test(item.account) || !/^[\w.-]{20,}$/.test(item.token))) throw new Error("the tokens are missing");
    const primary = tokens.find((item) => item.account === String(input.primary || "").toLowerCase()) || tokens[0];
    mkdirSync(perAccount, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    for (const item of tokens) writeFileSync(`${perAccount}/${item.account}`, item.token, { mode: 0o600 });
    for (const name of readdirSync(perAccount)) if (!tokens.some((item) => item.account === name)) rmSync(`${perAccount}/${name}`, { force: true });
    writeFileSync(tokenFile, primary.token, { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    git("--replace-all", "credential.https://github.com.helper", HELPER);
    git("credential.https://github.com.useHttpPath", "true");
    if (input.name) git("user.name", String(input.name));
    if (input.email) git("user.email", String(input.email));
    // gh's own layout (one entry per account, the active one on top), with the primary token kept in the file.
    const login = String(input.login || "");
    mkdirSync(`${home}/.config/gh`, { recursive: true, mode: 0o700 });
    writeFileSync(hosts, `${MARK}github.com:\n    users:\n        ${login}:\n            oauth_token: ${primary.token}\n    git_protocol: https\n    user: ${login}\n    oauth_token: ${primary.token}\n`, { mode: 0o600 });
    chmodSync(hosts, 0o600);
  }
} catch (error) {
  // One plain line for Cora to show, not a stack trace.
  process.stderr.write(`${String(error.message).split("\n")[0]}\n`);
  process.exit(1);
}
