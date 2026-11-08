import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { Store, sanitizeSettings } from "../src/store.js";
import { GUILD, MAIN_TOKEN, OWNER, STRANGER, TG_GROUP, TG_OWNER, TG_STRANGER, fakeDiscord, fakeDocker, fakeOllama, fakeTelegram, tempHome, waitFor } from "./helpers.js";

const WITHOUT_COMPUTER = /## Il tuo computer\nL'uso del tuo computer è abilitato nella tua scheda, ma gli strumenti per usarlo non sono disponibili in questo turno/;
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
  assert.match((await ask("Nico", "@Nico, controlla il feed")).system, WITHOUT_COMPUTER);
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
  const trusted = await ask("Nico", "@Nico, ricontrolla il feed");
  assert.match(trusted.system, WITH_COMPUTER);
  assert.match(trusted.user, /Il proprietario ha autorizzato Sncl a farti lavorare sul tuo computer: per le sue richieste agisci come per il proprietario, senza chiedergli il via libera\./);
  assert.match((await ask("Marta", "@Marta, mi aiuti?")).system, WITHOUT_COMPUTER, "Marta was not part of it");

  // Every agent, then nobody.
  await request(owner, "/api/permissions", { method: "PUT", body: { grants: [{ id: `discord:${STRANGER}`, agents: ["*"] }] } });
  assert.match((await ask("Marta", "@Marta, adesso?")).system, WITH_COMPUTER);
  const removed = await request(owner, "/api/permissions", { method: "PUT", body: { grants: [] } });
  assert.deepEqual(removed.data.people[0].agents, []);
  assert.match((await ask("Nico", "@Nico, ancora tu?")).system, WITHOUT_COMPUTER);
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

test("Telegram computer access is a current account permission, not a desktop power switch", async (t) => {
  const telegram = await fakeTelegram();
  const token = "1111111:AApermissionpermissionpermissionpermission";
  telegram.addBot(token, { id: 1111111, username: "cora_test_bot", first_name: "Cora" });
  const turns = [];
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    if (/^Valuti il disingaggio/.test(system)) return { content: '{"leave":[]}' };
    if (!system.startsWith("Sei Clara.")) return { content: "NESSUNO" };
    const user = String(body.messages.filter(message => message.role === "user").at(-1)?.content || "");
    const tools = (body.tools || []).map(tool => tool.function.name);
    turns.push({ system, user, tools });
    if (!tools.includes("shell")) return { content: "Serve il permesso per questo account Telegram, non l'accensione del desktop." };
    if (body.messages.some(message => message.role === "tool")) return { content: "Percorso verificato: /home/agent." };
    if (user.includes("Prima di chiudere")) return { content: "DONE" };
    return { tool_calls: [{ function: { name: "shell", arguments: { command: "pwd" } } }] };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ transport: "telegram", telegramChatIds: [TG_GROUP], telegramOwnerIds: [TG_OWNER] });
  const clara = seed.createAgent({ name: "Clara", model: "ollama/test-model", tools: true, ownerId: `discord:${STRANGER}` });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-permissions",
    cloudUrl: "", cloudKey: "", cloudSpace: "", discordToken: "", telegramToken: token, telegramApi: telegram.url,
    ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", botTokenFor: () => "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  t.after(async () => { await app.stop(); await Promise.all([telegram.close(), ollama.close()]); });
  await app.ready;
  await waitFor(() => app.telegram.state === "ready", { what: "Telegram polling" });
  const shellCalls = [];
  app.boxes.shell = async (id, command) => { shellCalls.push({ id, command }); return { code: 0, output: "/home/agent" }; };
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const grant = async grants => {
    const response = await fetch(`${base}/api/permissions`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ grants }) });
    assert.equal(response.status, 200);
  };
  const ask = async text => {
    const before = turns.length;
    telegram.push({ chat: { id: Number(TG_GROUP), type: "supergroup", title: "DO" }, from: { id: Number(TG_STRANGER), first_name: "Niftyz.io S" }, text });
    await waitFor(() => turns.length > before, { what: "Clara's Telegram turn" });
    await waitFor(() => app.orchestrator.quiet(), { what: "Clara's reply", timeout: 30000 });
    return turns.slice(before);
  };

  const denied = (await ask("@Clara, the desktop should be on now. Can you check pwd?"))[0];
  assert.match(denied.system, WITHOUT_COMPUTER);
  assert.match(denied.system, /Non esiste un interruttore del computer per il singolo gruppo/);
  assert.match(denied.user, new RegExp(`Cora non ha autorizzato l'account telegram:${TG_STRANGER}`));
  assert.match(denied.user, /non lo stato acceso\/spento del desktop/);
  assert.ok(!denied.tools.includes("shell"));
  assert.equal(shellCalls.length, 0);
  assert.equal(app.store.agent(clara.id).tools, true);

  await grant([{ id: `telegram:${TG_STRANGER}`, agents: [clara.id] }]);
  const allowed = await ask("@Clara, now check pwd using your computer.");
  assert.match(allowed[0].system, WITH_COMPUTER);
  assert.match(allowed[0].system, /eventuali tue vecchie risposte[\s\S]*sono superate/);
  assert.doesNotMatch(allowed[0].user, /Cora non ha autorizzato l'account/);
  assert.ok(allowed[0].tools.includes("shell"));
  assert.deepEqual(shellCalls, [{ id: clara.id, command: "pwd" }]);

  await grant([]);
  const revoked = (await ask("@Clara, check pwd once more."))[0];
  assert.match(revoked.system, WITHOUT_COMPUTER);
  assert.ok(!revoked.tools.includes("shell"));
  assert.equal(shellCalls.length, 1, "removing a permission does not switch the desktop off or keep old access");
});
