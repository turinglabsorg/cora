import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Boxes, SEALED_FIREWALL } from "../src/box.js";

function docker() {
  const dir = mkdtempSync(join(tmpdir(), "cora-sealed-docker-"));
  const log = join(dir, "calls.log");
  const path = join(dir, "docker");
  writeFileSync(path, `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  image) echo sha256:test; exit 0 ;;
  network) [ "$2" = inspect ] && exit 1; echo ok; exit 0 ;;
  inspect)
    case "$2" in cora-net-*) printf '{"Running":true}\\t{"6080/tcp":[{"HostIp":"127.0.0.1","HostPort":"1"}],"22/tcp":[{"HostIp":"127.0.0.1","HostPort":"2201"}]}\\tguard-id\\tsealed-v1\\n'; exit 0 ;; esac
    printf '{"Running":true,"Status":"running"}\\t{"6080/tcp":[{"HostIp":"127.0.0.1","HostPort":"1"}],"22/tcp":[{"HostIp":"127.0.0.1","HostPort":"2201"}]}\\tsha256:test\\t/home/agent,/var/lib/cora,\\t%s\\n' "$(cat "${dir}/network" 2>/dev/null || echo bridge)"; exit 0 ;;
  *) echo ok; exit 0 ;;
esac
`);
  chmodSync(path, 0o755);
  return { path, calls: () => readFileSync(log, "utf8").trim().split("\n"), network: (name) => writeFileSync(join(dir, "network"), name), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("desktops never reach each other: a sealed one has a network of its own and never joins the tailnet", async (t) => {
  const fake = docker(); t.after(fake.close);
  const sealed = new Set(["ag_sealed"]);
  const boxes = new Boxes({ docker: fake.path, image: "cora-box", timezone: "Europe/Rome", access: () => ({ sshPort: 2201, keys: [] }), sealed: (id) => sealed.has(id) });

  await boxes.create({ id: "ag_sealed", name: "Cliente" });
  const calls = fake.calls();
  assert.ok(calls.some((line) => line.startsWith("network create") && line.includes("enable_icc=false") && line.endsWith(" cora-sealed-ag_sealed")));
  const run = calls.find((line) => line.startsWith("run ") && line.includes("--name cora-box-"));
  assert.match(run, /--network container:cora-net-ag_sealed/);
  assert.doesNotMatch(run, /docker\.sock|--privileged|--cap-add/);
  assert.match(run, /--cap-drop NET_RAW/);
  assert.match(SEALED_FIREWALL, /100\.64\.0\.0\/10/);
  assert.match(SEALED_FIREWALL, /:OUTPUT DROP/);
  assert.deepEqual(run.match(/-v \S+/g).map((volume) => volume.split(":").at(-1)), ["/home/agent", "/var/lib/cora"], "only its own two volumes, nothing of the host");
  assert.ok(calls.some((line) => line.includes("tailscale logout")), "whatever its volume kept, it logs out of the tailnet");
  assert.ok(!calls.some((line) => line.includes("tailscale up") || line.includes("tailscale set")));
  await assert.rejects(boxes.tailscaleConnect({ id: "ag_sealed", name: "Cliente" }), /sigillato/);

  await boxes.create({ id: "ag_open", name: "Aperto" });
  const open = fake.calls().filter((line) => line.startsWith("run ")).at(-1);
  assert.match(open, /--network cora-desktops /);
  assert.ok(fake.calls().some((line) => line.startsWith("network create") && line.includes("enable_icc=false") && line.endsWith(" cora-desktops")), "on the shared bridge desktops cannot talk to each other");
  for (const line of fake.calls().filter((item) => item.startsWith("run ") && !item.includes("--network container:"))) {
    assert.deepEqual(line.match(/-p \S+/g), ["-p 127.0.0.1::6080", "-p 127.0.0.1:2201:22"], "ports are published on the host's loopback only");
  }

  // On the wrong network a box is out of date, so the next upgrade rebuilds it; volumes stay.
  fake.network("bridge");
  assert.equal((await boxes.inspect("ag_sealed")).outdated, true);
  assert.equal((await boxes.inspect("ag_open")).outdated, true, "a desktop still on Docker's default bridge moves to cora-desktops");
  fake.network("cora-desktops");
  assert.equal((await boxes.inspect("ag_open")).outdated, false);
  fake.network("container:guard-id");
  assert.equal((await boxes.inspect("ag_sealed")).outdated, false);
  sealed.delete("ag_sealed");
  assert.equal((await boxes.inspect("ag_sealed")).outdated, true, "unsealed, it goes back to the desktops' network");
});
