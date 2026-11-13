import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Artifacts, cleanTreePath, mergeTrees, treeDelta } from "../src/artifacts.js";
import { Boxes } from "../src/box.js";
import { Store } from "../src/store.js";
import { tempHome } from "./helpers.js";

const NICO = { id: "ag_aaaaaaaaaaaa", name: "Nico", enabled: true, tools: true };
const VERA = { id: "ag_bbbbbbbbbbbb", name: "Vera", enabled: true, tools: true };
const OWNER = { id: "local-owner", name: "Owner", role: "owner" };
const MEMBER = { id: "u_member", name: "Sara", role: "member" };
const REQUESTER = { kind: "owner", id: "1", name: "Owner" };

/** Desktops as folders: docker exec runs the real Python against <dir>/cora-box-<id>, streams and all. */
function desktops() {
  const directory = tempHome();
  const homes = {};
  for (const agent of [NICO, VERA]) {
    homes[agent.id] = join(directory, `cora-box-${agent.id}`);
    mkdirSync(join(homes[agent.id], "work"), { recursive: true });
  }
  const docker = join(directory, "docker");
  writeFileSync(docker, `#!${process.execPath}
const path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const args=process.argv.slice(2),index=args.findIndex(arg=>arg.startsWith('cora-box-'));
fs.appendFileSync(${JSON.stringify(join(directory, "calls.log"))},args.slice(0,index+2).join(' ')+'\\n');
if(args[0]!=='exec'||index<0||args[index+1]!=='python3')process.exit(1);
const root=path.join(${JSON.stringify(directory)},args[index]);
const script=args[index+3].replaceAll('/home/agent',root);
const parameters=args.slice(index+4).map(arg=>arg.startsWith('/home/agent/')?root+arg.slice('/home/agent'.length):arg);
const child=spawn('python3',['-c',script,...parameters],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
`);
  chmodSync(docker, 0o755);
  const store = new Store(join(directory, "cora"));
  for (const [position, agent] of [NICO, VERA].entries()) store.db.prepare("INSERT INTO agents (id, position, data) VALUES (?, ?, ?)").run(agent.id, position, JSON.stringify(agent));
  store.db.prepare("INSERT INTO panel_users (id, name, email, role, source, created_at, last_seen_at) VALUES (?, ?, ?, 'member', 'cloud', 0, 0)").run(MEMBER.id, MEMBER.name, "sara@example.test");
  const notices = [];
  const pushes = [];
  const artifacts = new Artifacts({
    store, home: join(directory, "cora"), boxes: new Boxes({ docker, image: "test", timezone: "UTC" }),
    push: { notify: async (message) => { pushes.push(message); } }, notice: async (channelId, text) => { notices.push({ channelId, text }); },
  });
  const write = (agent, file, content) => {
    const target = join(homes[agent.id], "work", file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  };
  const sent = () => readFileSync(join(directory, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { artifacts, store, homes, write, sent, notices, pushes, directory };
}

const sha = (text) => createHash("sha256").update(text).digest("hex");

test("paths from a desktop are checked here, whatever the desktop claims", () => {
  assert.equal(cleanTreePath("site/index.html"), "site/index.html");
  for (const bad of ["", "../x", "a/../b", "a//b", "./a", "a\\b", "a\u0000b", "_cora/files.json", "é"]) assert.throws(() => cleanTreePath(bad), bad);
});

test("a three-way merge keeps disjoint changes and stops on the same file changed twice", () => {
  const tree = (entries) => new Map(Object.entries(entries).map(([path, value]) => [path, { sha: value, size: 1 }]));
  const base = tree({ "a.txt": "1", "b.txt": "1" });
  const head = tree({ "a.txt": "2", "b.txt": "1" });
  const mine = tree({ "a.txt": "1", "b.txt": "3", "c.txt": "1" });
  const merged = mergeTrees(base, head, mine);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(Object.fromEntries([...merged.tree].map(([path, file]) => [path, file.sha])), { "a.txt": "2", "b.txt": "3", "c.txt": "1" });
  const clash = mergeTrees(base, head, tree({ "a.txt": "9", "b.txt": "1" }));
  assert.deepEqual(clash.conflicts, ["a.txt"]);
  assert.equal(mergeTrees(base, head, tree({ "a.txt": "9", "b.txt": "1" }), { force: true }).tree.get("a.txt").sha, "9");
  assert.deepEqual(treeDelta(base, mine), { added: ["c.txt"], modified: ["b.txt"], deleted: ["a.txt"].filter(() => false) });
});

test("a push of a folder proposes a commit, sends only what the folder lacks, and is served only once approved", async () => {
  const { artifacts, store, write, sent, notices, pushes } = desktops();
  write(NICO, "site/index.html", "<h1>Acme</h1>");
  write(NICO, "site/css/style.css", "h1{color:red}");
  write(NICO, "site/node_modules/x/index.js", "ignored");
  write(NICO, "site/.git/HEAD", "ref");
  await assert.rejects(artifacts.push({ agent: NICO, folder: "clienti/acme/sito", path: "/home/agent/work/site", message: "prima versione" }), /there is no folder clienti\/acme\/sito yet.*ask the person/s);
  await assert.rejects(artifacts.push({ agent: NICO, folder: "clienti/acme/sito", path: "/home/agent/work/site", create: { title: "Sito Acme", description: "Il sito per Acme" } }), /only while a person is asking you/);
  const first = await artifacts.push({ agent: NICO, folder: "clienti/acme/sito", path: "/home/agent/work/site", message: "prima versione", requester: REQUESTER, channelId: "c1",
    create: { title: "Sito Acme", description: "Il sito per Acme", kind: "site" } });
  assert.equal(first.commit.status, "proposed");
  assert.equal(first.commit.files, 2);
  assert.deepEqual(first.commit.changes.added.paths, ["css/style.css", "index.html"]);
  assert.equal(first.folder.policy, "review", "a folder an agent creates always waits for review");
  assert.equal(store.artifactFolder(first.folder.id).head, "", "nothing is served before approval");
  assert.match(artifacts.pushReceipt(first), /^PROPOSED, waiting for review by the owner: it is NOT served yet/);
  assert.match(artifacts.pushReceipt(first), /skipped: .*\.git \(ignored\).*node_modules \(ignored\)/);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /Nico ha proposto «prima versione» in \*\*clienti\/acme\/sito\*\*/);
  assert.equal(pushes.length, 1);

  await assert.rejects(artifacts.review(first.commit.id, { decision: "approve", user: MEMBER }), /decidono sui commit solo il proprietario e i revisori/);
  const approved = await artifacts.review(first.commit.id, { decision: "approve", user: OWNER });
  assert.equal(approved.commit.status, "published");
  assert.equal(store.artifactFolder(first.folder.id).head, first.commit.id);
  assert.match(notices.at(-1).text, /Owner ha pubblicato «prima versione» di Nico in \*\*clienti\/acme\/sito\*\*/);

  write(NICO, "site/index.html", "<h1>Acme 2</h1>");
  const before = sent().filter((line) => line.includes("python3")).length;
  const second = await artifacts.push({ agent: NICO, folder: "clienti/acme/sito", path: "/home/agent/work/site", message: "titolo nuovo" });
  assert.equal(second.send.length, 1, "only the changed file travels");
  assert.equal(second.send[0].path, "index.html");
  assert.equal(sent().filter((line) => line.includes("python3")).length - before, 2, "a list and one transfer");
  assert.deepEqual(second.commit.changes.modified.paths, ["index.html"]);
  const unchanged = await artifacts.push({ agent: NICO, folder: "clienti/acme/sito", path: "/home/agent/work/site", message: "di nuovo" });
  assert.equal(unchanged.nothing, true);
  assert.match(unchanged.text, /already has exactly these files/);
});

test("holding a hash is not having the file: a folder never lends its files to another", async () => {
  const { artifacts, write } = desktops();
  write(NICO, "secret-report/report.txt", "quarterly numbers");
  const first = await artifacts.push({ agent: NICO, folder: "finanza/report", path: "/home/agent/work/secret-report", requester: REQUESTER, create: { description: "Report riservati" } });
  await artifacts.review(first.commit.id, { decision: "approve", user: OWNER });
  write(VERA, "copy/report.txt", "quarterly numbers");
  const copy = await artifacts.push({ agent: VERA, folder: "marketing/copia", path: "/home/agent/work/copy", requester: REQUESTER, create: { description: "Copie" } });
  assert.equal(copy.send.length, 1, "Vera must send the bytes herself even though the server holds the same file");
});

test("refused and skipped files: secrets by name or by content, links, escapes and the work folder itself", async () => {
  const { artifacts, write, homes } = desktops();
  const folder = { folder: "prove/varie", requester: REQUESTER, create: { description: "Prove" } };
  write(NICO, "a/.env", "KEY=1");
  write(NICO, "a/page.html", "ok");
  await assert.rejects(artifacts.push({ agent: NICO, path: "/home/agent/work/a", ...folder }), /look like secrets.*a?\.env/s);
  write(NICO, "b/config.js", "const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';\n");
  await assert.rejects(artifacts.push({ agent: NICO, path: "/home/agent/work/b", ...folder }), /config\.js \(line 1\) contains what looks like a token/);
  write(NICO, "c/ok.txt", "fine");
  writeFileSync(join(homes[NICO.id], "outside.txt"), "private");
  symlinkSync(join(homes[NICO.id], "outside.txt"), join(homes[NICO.id], "work", "c", "escape.txt"));
  const pushed = await artifacts.push({ agent: NICO, path: "/home/agent/work/c", ...folder });
  assert.deepEqual(pushed.commit.changes.added.paths, ["ok.txt"]);
  assert.match(artifacts.pushReceipt(pushed), /escape\.txt \(symlink\)/);
  await assert.rejects(artifacts.push({ agent: NICO, path: "/home/agent/work", ...folder }), /not the whole work folder/);
  await assert.rejects(artifacts.push({ agent: NICO, path: "/home/agent/notes.txt", ...folder }), /inside \/home\/agent\/work/);
  await assert.rejects(artifacts.push({ agent: NICO, path: "/home/agent/work/../outside.txt", ...folder }), /choose a file or a folder inside .*\/work/);
});

test("two agents' disjoint proposals both publish; the same file changed by both is a conflict a reviewer may force", async () => {
  const { artifacts, store, write } = desktops();
  write(NICO, "doc/a.md", "a1");
  write(NICO, "doc/b.md", "b1");
  const start = await artifacts.push({ agent: NICO, folder: "team/doc", path: "/home/agent/work/doc", requester: REQUESTER, create: { description: "Documenti" } });
  await artifacts.review(start.commit.id, { decision: "approve", user: OWNER });
  write(NICO, "doc/a.md", "a2 by Nico");
  write(VERA, "doc/b.md", "b2 by Vera");
  const nico = await artifacts.push({ agent: NICO, folder: "team/doc", path: "/home/agent/work/doc/a.md" });
  const vera = await artifacts.push({ agent: VERA, folder: "team/doc", path: "/home/agent/work/doc/b.md" });
  await artifacts.review(nico.commit.id, { decision: "approve", user: OWNER });
  assert.equal(artifacts.mergeability(store.artifactCommit(vera.commit.id)).state, "rebase");
  const rebased = await artifacts.review(vera.commit.id, { decision: "approve", user: OWNER });
  assert.equal(rebased.commit.status, "published");
  assert.equal(rebased.commit.rebasedFrom.base, start.commit.id);
  const served = artifacts.treeOf(store.artifactFolder(start.folder.id).head);
  assert.equal(served.get("a.md").sha, sha("a2 by Nico"));
  assert.equal(served.get("b.md").sha, sha("b2 by Vera"));

  write(NICO, "doc/a.md", "a3 by Nico");
  write(VERA, "doc/a.md", "a3 by Vera");
  const first = await artifacts.push({ agent: NICO, folder: "team/doc", path: "/home/agent/work/doc/a.md" });
  const second = await artifacts.push({ agent: VERA, folder: "team/doc", path: "/home/agent/work/doc/a.md" });
  await artifacts.review(first.commit.id, { decision: "approve", user: OWNER });
  const clash = await artifacts.review(second.commit.id, { decision: "approve", user: OWNER });
  assert.deepEqual(clash.conflict, ["a.md"]);
  assert.equal(clash.commit.status, "conflict");
  const forced = await artifacts.review(second.commit.id, { decision: "force", user: OWNER });
  assert.equal(forced.commit.status, "published");
  assert.equal(artifacts.treeOf(store.artifactFolder(start.folder.id).head).get("a.md").sha, sha("a3 by Vera"));
});

test("a newer proposal from the same agent replaces the unreviewed one and keeps its files; mirror deletes", async () => {
  const { artifacts, store, write } = desktops();
  write(NICO, "s/one.txt", "1");
  const first = await artifacts.push({ agent: NICO, folder: "prove/mirror", path: "/home/agent/work/s/one.txt", requester: REQUESTER, create: { description: "Prove" } });
  write(NICO, "s/two.txt", "2");
  const second = await artifacts.push({ agent: NICO, folder: "prove/mirror", path: "/home/agent/work/s/two.txt" });
  assert.equal(store.artifactCommit(first.commit.id).status, "superseded");
  assert.equal(second.commit.supersedes, first.commit.id);
  assert.deepEqual([...artifacts.readTree(second.commit.tree).keys()].sort(), ["one.txt", "two.txt"]);
  await artifacts.review(second.commit.id, { decision: "approve", user: OWNER });
  write(NICO, "only/three.txt", "3");
  const mirror = await artifacts.push({ agent: NICO, folder: "prove/mirror", path: "/home/agent/work/only", mirror: true });
  assert.deepEqual(mirror.commit.changes.deleted.paths, ["one.txt", "two.txt"]);
  assert.deepEqual(mirror.commit.changes.added.paths, ["three.txt"]);
});

test("restore publishes an older version as a new commit; a direct folder publishes at once", async () => {
  const { artifacts, store, write } = desktops();
  const folder = artifacts.createFolder({ path: "comunicati", description: "Comunicati stampa", policy: "direct", createdBy: { kind: "user", id: OWNER.id, name: "Owner" } });
  write(NICO, "c/v.txt", "v1");
  const one = await artifacts.push({ agent: NICO, folder: "comunicati", path: "/home/agent/work/c/v.txt" });
  assert.equal(one.commit.status, "published");
  assert.match(artifacts.pushReceipt(one), /^PUBLISHED/);
  write(NICO, "c/v.txt", "v2");
  const two = await artifacts.push({ agent: NICO, folder: "comunicati", path: "/home/agent/work/c/v.txt" });
  assert.equal(store.artifactFolder(folder.id).head, two.commit.id);
  await assert.rejects(artifacts.restore(folder.id, one.commit.id, MEMBER), /ripristinano una versione solo il proprietario/);
  const restored = await artifacts.restore(folder.id, one.commit.id, OWNER);
  assert.equal(restored.status, "published");
  assert.equal(store.artifactFolder(folder.id).head, restored.id);
  assert.equal(artifacts.treeOf(restored.id).get("v.txt").sha, sha("v1"));
  assert.throws(() => artifacts.createFolder({ path: "comunicati/2026", createdBy: null }), /dentro o sopra la cartella comunicati/);
});

test("pull writes the served version onto a desktop, and a push from there builds on it", async () => {
  const { artifacts, store, write, homes } = desktops();
  write(NICO, "site/index.html", "home");
  write(NICO, "site/img/logo.svg", "<svg/>");
  const first = await artifacts.push({ agent: NICO, folder: "siti/landing", path: "/home/agent/work/site", requester: REQUESTER, create: { description: "Landing" } });
  await artifacts.review(first.commit.id, { decision: "approve", user: OWNER });
  const text = await artifacts.pull({ agent: VERA, folder: "siti/landing" });
  assert.match(text, /pulled siti\/landing at commit/);
  const pulled = join(homes[VERA.id], "work", "artifacts", "siti", "landing");
  assert.equal(readFileSync(join(pulled, "img", "logo.svg"), "utf8"), "<svg/>");
  assert.equal(JSON.parse(readFileSync(join(pulled, ".cora-artifact.json"), "utf8")).commit, first.commit.id);
  await assert.rejects(artifacts.pull({ agent: VERA, folder: "siti/landing" }), /already has files/);
  writeFileSync(join(pulled, "about.html"), "about");
  const pushed = await artifacts.push({ agent: VERA, folder: "siti/landing", path: "/home/agent/work/artifacts/siti/landing" });
  assert.equal(pushed.commit.base, first.commit.id);
  assert.deepEqual(pushed.commit.changes.added.paths, ["about.html"]);
  assert.ok(!readdirSync(pulled).includes(".cora-artifact.json") || !artifacts.readTree(pushed.commit.tree).has(".cora-artifact.json"), "the marker never enters the tree");
  assert.equal(store.artifactFolder(first.folder.id).head, first.commit.id);
});

test("the collector keeps every file a commit points at and drops the rest after the grace period", async () => {
  const { artifacts, store, write } = desktops();
  write(NICO, "g/keep.txt", "keep");
  await artifacts.push({ agent: NICO, folder: "prove/gc", path: "/home/agent/work/g", requester: REQUESTER, create: { description: "Prove" } });
  const orphan = artifacts.putBytes("orphan");
  store.db.prepare("UPDATE artifact_objects SET created_at = 0").run();
  assert.equal(artifacts.collect(), 1);
  assert.equal(artifacts.hasObject(orphan), false);
  assert.equal(artifacts.hasObject(sha("keep")), true);
});

test("artifact level policy is shared by the space owner identities on legacy shared spaces", () => {
  const { artifacts } = desktops();
  const folder = artifacts.createFolder({ path: "crm/legacy-shared/report" });
  artifacts.updateLevelPolicy("crm", { policy: "direct" }, OWNER);
  const cloudOwner = { id: "cloud-owner", role: "owner" };
  assert.equal(artifacts.levelPolicy("crm", cloudOwner).policy, "direct");
  assert.equal(artifacts.folderView(folder).policy, "direct");
  artifacts.updateLevelPolicy("crm", { policy: "review" }, cloudOwner);
  assert.equal(artifacts.levelPolicy("crm", OWNER).policy, "review");
  assert.equal(artifacts.folderView(folder).policy, "review");
});
