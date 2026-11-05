#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(directory, "policy.json"), "utf8"));
const original = process.argv.slice(2);
const takesValue = new Set(["B", "b", "c", "D", "E", "e", "F", "I", "i", "J", "L", "l", "m", "O", "o", "p", "Q", "R", "S", "W", "w"]);
let commandAt = -1;
let passthrough = !policy.enabled || process.env.CORA_GIT_ATTRIBUTION === "0";
for (let index = 0; index < original.length; index++) {
  const arg = original[index];
  if (arg === "--") { commandAt = index + 2; break; }
  if (!arg.startsWith("-") || arg === "-") { commandAt = index + 1; break; }
  for (let at = 1; at < arg.length; at++) {
    const option = arg[at];
    if ("GNOQsVW".includes(option)) passthrough = true;
    if (takesValue.has(option)) {
      if (at === arg.length - 1) index += 1;
      break;
    }
  }
}
const command = commandAt >= 0 ? original.slice(commandAt).join(" ") : "";
if (!command || /^\s*['"]?(?:[^\s'"]*\/)?(?:git-(?:upload-pack|receive-pack|upload-archive)|scp|(?:internal-)?sftp(?:-server)?|rsync)['"]?(?:\s|$)/.test(command)) passthrough = true;
const quote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
let args = original;
if (!passthrough) {
  const git = readFileSync(join(directory, "git"), "utf8");
  const launcher = `cora_git_dir=$(mktemp -d "\${TMPDIR:-/tmp}/cora-git.XXXXXXXX") || exit 1
trap 'rm -rf -- "$cora_git_dir"' EXIT
cora_real_git=$(command -v git || true)
if [ -z "$cora_real_git" ]; then "\${SHELL:-/bin/sh}" -c ${quote(command)}; exit $?; fi
printf %s ${quote(git)} > "$cora_git_dir/git" || exit 1
chmod 700 "$cora_git_dir/git" || exit 1
printf '%s\\n' '[ -z "\${CORA_PREVIOUS_BASH_ENV:-}" ] || . "$CORA_PREVIOUS_BASH_ENV"' 'export PATH="'"$cora_git_dir"':$PATH"' > "$cora_git_dir/bash-env"
PATH="$cora_git_dir:$PATH" CORA_GIT_REAL="$cora_real_git" CORA_PREVIOUS_BASH_ENV="\${BASH_ENV:-}" BASH_ENV="$cora_git_dir/bash-env" "\${SHELL:-/bin/sh}" -c ${quote(command)}
exit $?`;
  args = [...original.slice(0, commandAt), `sh -c ${quote(launcher)}`];
}
const child = spawn(policy.ssh || "/usr/bin/ssh", args, { stdio: "inherit" });
child.on("error", () => { process.exitCode = 127; });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
