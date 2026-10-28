import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Boxes } from "../src/box.js";
import { tempHome } from "./helpers.js";

const source = "ag_aaaaaaaaaaaa";
const recipient = "ag_bbbbbbbbbbbb";

function desktops() {
  const directory = tempHome();
  const sourceHome = join(directory, `cora-box-${source}`);
  const recipientHome = join(directory, `cora-box-${recipient}`);
  mkdirSync(join(sourceHome, "work"), { recursive: true });
  mkdirSync(recipientHome);
  const docker = join(directory, "docker");
  writeFileSync(docker, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const args=process.argv.slice(2),index=args.findIndex(arg=>arg.startsWith('cora-box-'));
if(args[0]!=='exec'||index<0||args[index+1]!=='python3')process.exit(1);
const root=path.join(${JSON.stringify(directory)},args[index]);
const script=args[index+3].replaceAll('/home/agent',root);
const parameters=args.slice(index+4).map(arg=>arg.startsWith('/home/agent/')?root+arg.slice('/home/agent'.length):arg);
const result=spawnSync('python3',['-c',script,...parameters],{input:fs.readFileSync(0),maxBuffer:20*1024*1024});
const output=script.includes('print(json.dumps')?Buffer.from(result.stdout.toString().replaceAll(root,'/home/agent')):result.stdout;
process.stdout.write(output);process.stderr.write(result.stderr);process.exit(result.status??1);
`);
  chmodSync(docker, 0o755);
  return { boxes: new Boxes({ docker, image: "test", timezone: "UTC" }), sourceHome, recipientHome };
}

test("desktop file delivery verifies binary bytes, creates the recipient work folder and is safe to retry", async () => {
  const { boxes, sourceHome, recipientHome } = desktops();
  const data = Buffer.concat([Buffer.from("case,status\nexample,closed\n"), Buffer.from([0, 1, 128, 255])]);
  writeFileSync(join(sourceHome, "work", "cases.csv"), data);
  const receipt = await boxes.shareFile(source, recipient, "/home/agent/work/cases.csv");
  const expected = createHash("sha256").update(data).digest("hex");
  assert.deepEqual(receipt, { path: `/home/agent/work/shared/${source}/cases-${expected.slice(0, 12)}.csv`, sha256: expected, bytes: data.length });
  const delivered = join(recipientHome, receipt.path.slice("/home/agent/".length));
  assert.deepEqual(readFileSync(delivered), data);
  assert.equal(statSync(delivered).mode & 0o777, 0o600);
  assert.deepEqual(await boxes.shareFile(source, recipient, "/home/agent/work/cases.csv"), receipt);
  assert.equal(readdirSync(join(recipientHome, "work", "shared", source)).length, 1);
  writeFileSync(delivered, "recipient's existing changes");
  await assert.rejects(boxes.shareFile(source, recipient, "/home/agent/work/cases.csv"), /different contents; left unchanged/);
  assert.equal(readFileSync(delivered, "utf8"), "recipient's existing changes");
  assert.deepEqual(readFileSync(join(sourceHome, "work", "cases.csv")), data);
});

test("desktop file delivery rejects source escapes, oversized files and destination symlinks", async () => {
  const { boxes, sourceHome, recipientHome } = desktops();
  const outside = join(sourceHome, "private.txt");
  writeFileSync(outside, "not authorized for sharing");
  symlinkSync(outside, join(sourceHome, "work", "escape.txt"));
  await assert.rejects(boxes.shareFile(source, recipient, "/home/agent/private.txt"), /only files/);
  await assert.rejects(boxes.shareFile(source, recipient, "/home/agent/work/../private.txt"), /only files/);
  await assert.rejects(boxes.shareFile(source, recipient, "/home/agent/work/escape.txt"), /source must be a regular file within/);
  writeFileSync(join(sourceHome, "work", "large.bin"), Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(boxes.shareFile(source, recipient, "/home/agent/work/large.bin"), /larger than 8 MB/);
  assert.equal(existsSync(join(recipientHome, "work")), false);
  writeFileSync(join(sourceHome, "work", "cases.csv"), "safe content");
  mkdirSync(join(recipientHome, "work"));
  const unrelated = join(recipientHome, "unrelated");
  mkdirSync(unrelated);
  symlinkSync(unrelated, join(recipientHome, "work", "shared"));
  await assert.rejects(boxes.shareFile(source, recipient, "/home/agent/work/cases.csv"), /Not a directory|symbolic links/);
  assert.deepEqual(readdirSync(unrelated), []);
});
