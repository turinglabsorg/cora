import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Store a secret in this machine's hush vault. The value goes in on stdin,
 * sealed to the machine's own box key and opened straight into the vault, so
 * it never touches a command line or a clear-text file. An existing name is
 * replaced.
 */
export function hushStore(name, value, { bin = "hush", home = process.env.HUSH_HOME || join(homedir(), ".hush") } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, HUSH_HOME: home };
    const seal = spawn(bin, ["box", "seal", "--to", "self", "--uses", "1", "--pubkey-file", join(home, "box.pub")], { env, stdio: ["pipe", "pipe", "pipe"] });
    const open = spawn(bin, ["box", "open", name], { env, stdio: ["pipe", "pipe", "pipe"] });
    const errors = [];
    let pending = 2;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      seal.kill();
      open.kill();
      reject(error);
    };
    const done = (step) => (code) => {
      if (code !== 0) return fail(new Error(`hush box ${step} exited ${code}${errors.length ? `: ${errors.join(" ").trim().slice(0, 300)}` : ""}`));
      if (--pending === 0 && !failed) resolve();
    };
    for (const child of [seal, open]) {
      child.on("error", fail);
      child.stderr.on("data", (chunk) => errors.push(String(chunk)));
    }
    seal.stdout.pipe(open.stdin);
    open.stdout.resume();
    seal.on("close", done("seal"));
    open.on("close", done("open"));
    seal.stdin.end(value);
  });
}
