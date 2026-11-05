import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
async function install() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { git, ssh, enabled, email } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const root = "/usr/local/lib/cora-git";
  for (const name of ["git", "ssh"]) {
    const bin = `/usr/local/bin/${name}`;
    let info;
    try { info = lstatSync(bin); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (info && (!info.isSymbolicLink() || readlinkSync(bin) !== `${root}/${name === "ssh" ? "ssh.mjs" : "git"}`)) throw new Error(`refusing to replace an existing ${name} launcher`);
  }
  mkdirSync(root, { recursive: true, mode: 0o755 });
  const write = (name, content, mode) => {
    const file = `${root}/${name}`;
    if (existsSync(file) && readFileSync(file, "utf8") === content) return;
    const temporary = `${file}.${process.pid}.new`;
    writeFileSync(temporary, content, { mode });
    renameSync(temporary, file);
  };
  write("git", git, 0o755);
  write("ssh.mjs", ssh, 0o755);
  write("policy.json", JSON.stringify({ enabled, email, ssh: "/usr/bin/ssh" }), 0o644);
  for (const [name, target] of [["git", "git"], ["ssh", "ssh.mjs"]]) {
    const bin = `/usr/local/bin/${name}`;
    if (!existsSync(bin)) symlinkSync(`${root}/${target}`, bin);
  }
}

install().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
