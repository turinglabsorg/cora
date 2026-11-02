import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { Store, sanitizeSettings } from "../src/store.js";
import { GUILD, MAIN_TOKEN, OWNER, STRANGER, fakeDiscord, fakeDocker, fakeOllama, tempHome, waitFor } from "./helpers.js";

const WITHOUT_COMPUTER = /## Il tuo computer\nIn questa conversazione non hai il tuo computer/;
const WITH_COMPUTER = /## Il tuo computer\nHai un tuo computer Linux/;

test("the owner lets a person in the chat put agents to work on their computers, from the panel", async (t) => {
  const keys = passKeys("fixture-permissions-signing-seed-0123456789abcdef");
  const discord = await fakeDiscord();
  const turns = [];
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    if (/^Scrivi la condizione di completamento/.test(system)) return { content: "NESSUNO" };
    if (/^Giudichi se un compito è finito/.test(system)) return { content: JSON.stringify({ met: true, reason: "" }) };
    if (/^Valuti l'intenzione/.test(system)) return { content: JSON.stringify({ intent: "update" }) };
    const name = /^Sei (\p{Lu}[^.]*)\./u.exec(system)?.[1];
    if (!name) return { content: "PASS" };
    turns.push({ name, system, user: String(body.messages.filter((message) => message.role === "user").at(-1)?.content || "") });
    return { content: `${name} qui.` };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD], ownerIds: [OWNER] });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-permissions",
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "alpha",
    discordToken: MAIN_TOKEN, discordApi: discord.url, telegramToken: "", ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(async () => {
    await app.stop();
    await Promise.all([discord.close(), ollama.close()]);
  });
  await waitFor(() => app.discord.state === "ready", { what: "gateway ready" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (who) => {
    const pass = signPass(keys.privateKey, { aud: "alpha.usecora.test", emailVerified: true, ...who });
    return (await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass })}`, { redirect: "manual" })).headers.get("set-cookie")?.split(";")[0] || "";
  };
  const request = async (cookie, path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const quiet = () => waitFor(() => app.orchestrator.quiet(), { what: "agents to stop talking", timeout: 30000 });
  const owner = await login({ sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test" });
  await request(owner, "/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const sara = await login({ sub: "ac_sara", role: "member", name: "Sara", email: "sara@company.test" });
  assert.ok(owner && sara);
  const nico = (await request(owner, "/api/agents", { method: "POST", body: { name: "Nico", model: "ollama/test-model", chattiness: 0, tools: true } })).data;
  const marta = (await request(owner, "/api/agents", { method: "POST", body: { name: "Marta", model: "ollama/test-model", chattiness: 0, tools: true } })).data;
  const lastTurn = (name) => turns.filter((turn) => turn.name === name).at(-1);
  const ask = async (name, content) => {
    const before = turns.filter((turn) => turn.name === name).length;
    discord.say({ content, author: STRANGER, username: "Sncl" });
    await waitFor(() => turns.filter((turn) => turn.name === name).length > before, { what: `${name}'s turn` });
    await quiet();
    return lastTurn(name);
  };

  // Not authorized: the agent has no computer for Sncl and would ask the owner.
  assert.match((await ask("Nico", "Nico, controlla il feed")).system, WITHOUT_COMPUTER);
  const listed = (await request(owner, "/api/permissions")).data;
  assert.equal(listed.canManage, true);
  assert.deepEqual(listed.people.map((person) => [person.id, person.name, person.transport, person.agents]), [[`discord:${STRANGER}`, "Sncl", "discord", []]], "the owner is not listed: they can do everything already");

  // A member sees the permissions but cannot give one, not even through the settings.
  const seen = await request(sara, "/api/permissions");
  assert.equal(seen.data.canManage, false);
  assert.equal((await request(sara, "/api/permissions", { method: "PUT", body: { grants: [{ id: `discord:${STRANGER}`, agents: ["*"] }] } })).status, 403);
  await request(sara, "/api/settings", { method: "PUT", body: { permissions: [{ id: `discord:${STRANGER}`, agents: ["*"] }] } });
  assert.deepEqual(app.store.settings.permissions, []);

  // Authorized on Nico only.
  const granted = await request(owner, "/api/permissions", { method: "PUT", body: { grants: [{ id: `discord:${STRANGER}`, agents: [nico.id] }] } });
  assert.equal(granted.status, 200);
  assert.deepEqual(granted.data.people[0].agents, [nico.id]);
  assert.deepEqual(app.store.settings.permissions, [{ id: `discord:${STRANGER}`, name: "Sncl", agents: [nico.id] }], "the name comes from the chat");
  const trusted = await ask("Nico", "Nico, ricontrolla il feed");
  assert.match(trusted.system, WITH_COMPUTER);
  assert.match(trusted.user, /Il proprietario ha autorizzato Sncl a farti lavorare sul tuo computer: per le sue richieste agisci come per il proprietario, senza chiedergli il via libera\./);
  assert.match((await ask("Marta", "Marta, mi aiuti?")).system, WITHOUT_COMPUTER, "Marta was not part of it");

  // Every agent, then nobody.
  await request(owner, "/api/permissions", { method: "PUT", body: { grants: [{ id: `discord:${STRANGER}`, agents: ["*"] }] } });
  assert.match((await ask("Marta", "Marta, adesso?")).system, WITH_COMPUTER);
  const removed = await request(owner, "/api/permissions", { method: "PUT", body: { grants: [] } });
  assert.deepEqual(removed.data.people[0].agents, []);
  assert.match((await ask("Nico", "Nico, ancora tu?")).system, WITHOUT_COMPUTER);
  assert.equal(marta.tools, true);
});

test("a permission names one person on one platform and real agents; one with no agent left is gone", () => {
  const cleaned = sanitizeSettings({ permissions: [
    { id: "discord:300000000000000002", name: " Sncl ", agents: ["ag_0123456789ab", "ag_0123456789ab", "nope"] },
    { id: "discord:300000000000000002", agents: ["*"] },
    { id: "slack:U0000000002", agents: ["*", "ag_0123456789ab"] },
    { id: "telegram:12345", agents: [] },
    { id: "web:owner", agents: ["*"] },
    { id: "discord:../../etc", agents: ["*"] },
  ] }).permissions;
  assert.deepEqual(cleaned, [
    { id: "discord:300000000000000002", name: "Sncl", agents: ["ag_0123456789ab"] },
    { id: "slack:U0000000002", name: "", agents: ["*"] },
  ]);
});
