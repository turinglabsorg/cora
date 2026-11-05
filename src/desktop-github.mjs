// Runs on an agent's desktop, as the agent: the GitHub App's hour-long token where git and gh read it.
// Input on stdin: { token, login, name, email } to sign in, or { remove: true } to sign out.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const home = process.env.HOME || "/home/agent";
const dir = `${home}/.config/cora`;
const tokenFile = `${dir}/github-token`;
const hosts = `${home}/.config/gh/hosts.yml`;
const MARK = "# written by Cora: the agent's GitHub App, renewed every hour\n";
const git = (...args) => execFileSync("git", ["config", "--global", ...args], { stdio: ["ignore", "ignore", "pipe"] });

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.remove) {
    rmSync(tokenFile, { force: true });
    try { git("--unset-all", "credential.https://github.com.helper"); } catch {}
    // The app's identity goes with it: commits made afterwards are not signed as its bot.
    let email = "";
    try { email = execFileSync("git", ["config", "--global", "user.email"], { encoding: "utf8" }).trim(); } catch {}
    if (email.endsWith("[bot]@users.noreply.github.com")) for (const key of ["user.name", "user.email"]) try { git("--unset", key); } catch {}
    if (existsSync(hosts) && readFileSync(hosts, "utf8").startsWith(MARK)) rmSync(hosts, { force: true });
  } else {
    const token = String(input.token || "");
    if (!/^[\w.-]{20,}$/.test(token)) throw new Error("the token is missing");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(tokenFile, token, { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    // git asks this helper for github.com: the file is read at each push, so a renewal needs nothing else.
    git("--replace-all", "credential.https://github.com.helper", '!f() { test "$1" = get || exit 0; echo username=x-access-token; printf "password=%s\\n" "$(cat "$HOME/.config/cora/github-token")"; }; f');
    if (input.name) git("user.name", String(input.name));
    if (input.email) git("user.email", String(input.email));
    mkdirSync(`${home}/.config/gh`, { recursive: true, mode: 0o700 });
    writeFileSync(hosts, `${MARK}github.com:\n    oauth_token: ${token}\n    user: ${String(input.login || "")}\n    git_protocol: https\n`, { mode: 0o600 });
    chmodSync(hosts, 0o600);
  }
} catch (error) {
  // One plain line for Cora to show, not a stack trace.
  process.stderr.write(`${String(error.message).split("\n")[0]}\n`);
  process.exit(1);
}
