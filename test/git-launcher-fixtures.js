import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function gitLauncherFixture({ enabled = true, email = "git@usecora.space" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "cora Git launcher "));
  const bin = join(directory, "bin");
  const remoteTmp = join(directory, "remote temp");
  mkdirSync(bin); mkdirSync(remoteTmp);
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: directory, USER: "fixture", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C", LANG: "C", TMPDIR: remoteTmp };
  const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
  const script = readFileSync(new URL("../src/desktop-git.sh", import.meta.url), "utf8").replace("__CORA_ENABLED__", enabled ? "1" : "0").replace("__CORA_EMAIL__", quote(email));
  writeFileSync(join(bin, "git"), script, { mode: 0o755 });
  writeFileSync(join(bin, "ssh.mjs"), readFileSync(new URL("../src/desktop-ssh.mjs", import.meta.url)), { mode: 0o755 });
  const fake = join(directory, "ssh-server");
  writeFileSync(fake, `#!${process.execPath}
const {spawnSync}=require('node:child_process');const {writeFileSync}=require('node:fs');
const args=process.argv.slice(2);writeFileSync(${JSON.stringify(join(directory, "ssh-args.json"))},JSON.stringify(args));
const command=args.at(-1)||'';
if(!command.startsWith('sh -c ')&&!command.startsWith('bash ')&&!command.startsWith('git ')&&!command.startsWith('cd ')&&!command.startsWith('exit ')&&!command.startsWith('printf ')&&!command.startsWith('test '))process.exit(0);
const result=spawnSync('/bin/bash',['-c',command],{stdio:'inherit',env:{...process.env,PATH:'/usr/bin:/bin',SHELL:'/bin/bash'}});process.exit(result.status??1);
`, { mode: 0o755 });
  chmodSync(fake, 0o755);
  writeFileSync(join(bin, "policy.json"), JSON.stringify({ enabled, email, ssh: fake }));
  const run = (command, args, { input, extraEnv = {} } = {}) => spawnSync(command, args, { env: { ...env, ...extraEnv }, input, encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
  const git = (args, options) => run(join(bin, "git"), ["-C", directory, ...args], options);
  const raw = (args) => {
    const result = run("/usr/bin/git", ["-C", directory, ...args]);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  raw(["init", "--quiet"]); raw(["config", "user.name", "Repository Owner"]); raw(["config", "user.email", "owner@example.test"]); raw(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(directory, "change.txt"), "Approved code\n"); raw(["add", "change.txt"]);
  return { directory, bin, remoteTmp, env, git, raw, run, quote, ssh: (args, options) => run(process.execPath, [join(bin, "ssh.mjs"), ...args], options) };
}

export function gitSetupFixture() {
  const directory = mkdtempSync(join(tmpdir(), "cora Git setup "));
  const bin = join(directory, "bin");mkdirSync(bin);
  const root = join(directory, "managed");
  const docker = join(directory, "docker");
  const calls = join(directory, "calls.jsonl");
  writeFileSync(docker, `#!${process.execPath}
const {spawnSync}=require('node:child_process');const {readFileSync,appendFileSync}=require('node:fs');
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify(args.slice(0,8))+'\\n');
if(args[0]!=='exec'||!args.includes('root'))process.exit(99);
const at=args.indexOf('--input-type=module');if(at<0||args[at+1]!=='-e')process.exit(98);
const program=args[at+2].replaceAll('/usr/local/lib/cora-git',${JSON.stringify(root)}).replaceAll('/usr/local/bin',${JSON.stringify(bin)});
const result=spawnSync(process.execPath,['--input-type=module','-e',program],{input:readFileSync(0)});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
`, { mode: 0o755 });
  return { directory, bin, root, docker, calls };
}
