import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { fakeDocker, tempHome } from "./helpers.js";

async function fixture(t) {
  const home = tempHome();
  const residentDirectories = { claude: join(home, "resident-claude"), codex: join(home, "resident-codex") };
  for (const directory of Object.values(residentDirectories)) mkdirSync(directory);
  const ownerInstructions = join(home, "owner-AGENTS.md");
  writeFileSync(ownerInstructions, "# Shared instructions\nFollow the fixture rules.\n");
  writeFileSync(join(residentDirectories.claude, "CLAUDE.md"), "# Claude resident\nLocal fixture notes.\n");
  writeFileSync(join(residentDirectories.codex, "AGENTS.md"), "# Codex resident\nNot loaded when --ignore-rules is set.\n");
  const app = startCora({ home, residentDirectories, ownerInstructions, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session", useResidentSubscriptions: false,
    cloudUrl: "", cloudKey: "", cloudSpace: "", discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (path = "/api/context", auth = true) => {
    const response = await fetch(`${base}${path}`, { headers: auth ? { Cookie: cookie } : {} });
    return { status: response.status, data: await response.json() };
  };
  return { app, home, residentDirectories, ownerInstructions, request };
}

test("Context shows the actual common instructions, source metadata and provider rule handling", async (t) => {
  const { app, ownerInstructions, request } = await fixture(t);
  app.store.updateSettings({ sharedMemory: "Team fixture memory." });
  const response = await request();
  assert.equal(response.status, 200);
  const owner = response.data.sources.find((source) => source.id === "owner");
  assert.equal(owner.status, "applied");
  assert.equal(owner.path, ownerInstructions);
  assert.equal(owner.content, app.brain.ownerInstructions());
  assert.ok(owner.updatedAt);
  const claude = response.data.sources.find((source) => source.id === "resident-claude-CLAUDE.md");
  assert.equal(claude.status, "detected");
  assert.match(claude.content, /Local fixture notes/);
  const codex = response.data.sources.find((source) => source.id === "resident-codex-AGENTS.md");
  assert.equal(codex.status, "excluded");
  assert.match(codex.content, /ignore-rules/);
  assert.equal(response.data.sources.find((source) => source.id === "shared-memory").content, "Team fixture memory.");
  writeFileSync(ownerInstructions, "# Updated rules\nFresh fixture instructions.");
  utimesSync(ownerInstructions, new Date(), new Date(Date.now() + 1000));
  assert.match((await request()).data.sources.find((source) => source.id === "owner").content, /Fresh fixture instructions/);
});

test("Context requires authentication, ignores arbitrary paths, and refuses links to credential-shaped files", async (t) => {
  const { home, residentDirectories, request } = await fixture(t);
  assert.equal((await request("/api/context", false)).status, 401);
  const forbidden = join(home, "fixture-auth.json");
  writeFileSync(forbidden, '{"fixture_private_value":"fixture-do-not-expose"}');
  symlinkSync(forbidden, join(residentDirectories.codex, "AGENTS.override.md"));
  const response = await request(`/api/context?path=${encodeURIComponent(forbidden)}`);
  assert.equal(response.status, 200);
  const link = response.data.sources.find((source) => source.id === "resident-codex-AGENTS.override.md");
  assert.equal(link.available, false);
  assert.equal(link.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(response.data), /fixture-do-not-expose|fixture_private_value/);
  assert.ok(response.data.sources.some((source) => source.status === "missing"));
});

test("Context bounds the preview to the same common instruction limit and only includes existing managed notes", async (t) => {
  const { app, home, ownerInstructions, request } = await fixture(t);
  writeFileSync(ownerInstructions, "a".repeat(70000));
  utimesSync(ownerInstructions, new Date(), new Date(Date.now() + 2000));
  const account = app.store.createSubscription({ provider: "claude", label: "Team notes" });
  const profile = join(home, "subscriptions", account.id);
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "CLAUDE.md"), "# Managed account notes");
  app.store.createSubscription({ provider: "codex", label: "Empty profile" });
  const response = await request();
  const owner = response.data.sources.find((source) => source.id === "owner");
  assert.equal(owner.content.length, 60000);
  assert.equal(owner.truncated, true);
  assert.equal(owner.content, app.brain.ownerInstructions());
  const managed = response.data.sources.filter((source) => source.scope === "account");
  assert.equal(managed.length, 1);
  assert.equal(managed[0].accountLabel, "Team notes");
});
