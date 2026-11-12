import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { nameTokens, scrubPersonal, sealPackage } from "../src/agent-transfer.js";
import { encodePng } from "../src/png.js";
import { passKeys, signPass } from "../src/pass.js";
import { Store } from "../src/store.js";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { CHANNEL, GUILD, MAIN_TOKEN, OWNER, fakeDiscord, fakeDocker, tempHome, waitFor } from "./helpers.js";

const keys = passKeys("fixture-agent-transfer-signing-seed-0123456789abcdef");
const DISCORD_LINK = "https://discord.com/channels/1521874685690642564/1570040957879980082";
const FORBIDDEN = [/sebastiano/i, /\bSeb\b/, /Bianchi/i, /dopamina\.test/i, /333[\s.-]?123/, /1521874685690642564/, /1570040957879980082/, /ghp_/, /discord:3/, /\b10\.1\.2\.3\b/, /access_token/];

test("the privacy filter takes out addresses, numbers, ids, tokens and the names of the space's people", () => {
  const names = nameTokens(["Sebastiano Rossi", "marta.bianchi", "Nico"], { keep: ["Nico"] });
  assert.ok(names.includes("sebastiano") && names.includes("bianchi") && !names.includes("nico"), "agent names stay: they are colleagues, not people");
  const { text, removed } = scrubPersonal(`Seb (sebastiano@dopamina.test, +39 333 123 4567, 3331234567) vuole il report su ${DISCORD_LINK} e https://api.example.test/v1?access_token=abc#x; Marta Bianchi è su discord:300000000000000001, IP 10.1.2.3, token ghp_abcdefghijklmnop1234, agente ag_0123456789ab. Nico fa il deploy.`, { names });
  for (const pattern of FORBIDDEN) assert.doesNotMatch(text, pattern);
  assert.match(text, /\[persona\] \(\[email\], \[telefono\], \[telefono\]\)/);
  assert.match(text, /https:\/\/api\.example\.test\/v1[^?]/, "a link keeps its address, not its query");
  assert.match(text, /Nico fa il deploy/);
  assert.ok(removed.email && removed.phone >= 2 && removed.id >= 3 && removed.ip && removed.link && removed.secret && removed.person >= 3);
  assert.deepEqual(scrubPersonal("Il 12/11/2026 alle 16:40 verifica healthz 200 su c202e8b.").removed, {}, "dates, times and commit hashes are not personal data");
});

test("an agent leaves one space as a file or a link and arrives in another without personal data", async (t) => {
  const discord = await fakeDiscord();
  const docker = fakeDocker();
  const common = { host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", useResidentSubscriptions: false,
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, telegramToken: "", ollamaKey: "test-ollama-key", orcaKey: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse",
    botTokenFor: () => "", docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys" };
  const sourceHome = tempHome();
  const source = startCora({ ...common, home: sourceHome, sessionKey: "fixture-transfer-source", cloudSpace: "alpha", discordToken: "" });
  const targetHome = tempHome();
  const seed = new Store(targetHome);
  seed.updateSettings({ guildIds: [GUILD], ownerIds: [OWNER] });
  seed.close();
  const target = startCora({ ...common, home: targetHome, sessionKey: "fixture-transfer-target", cloudSpace: "beta", discordToken: MAIN_TOKEN, discordApi: discord.url, agentImportAllowLocal: true });
  await Promise.all([source.ready, target.ready]);
  t.after(async () => { await Promise.all([source.stop(), target.stop()]); await discord.close(); });
  await waitFor(() => target.discord.state === "ready", { what: "target gateway" });
  const client = (app, space) => {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    return {
      base,
      login: async (who) => (await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: `${space}.usecora.test`, emailVerified: true, ...who }) })}`, { redirect: "manual" })).headers.get("set-cookie")?.split(";")[0] || "",
      call: async (cookie, path, { method = "GET", body } = {}) => {
        const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, data, headers: response.headers, text };
      },
    };
  };
  const alpha = client(source, "alpha"), beta = client(target, "beta");
  const owner = await alpha.login({ sub: "ac_seb", role: "owner", name: "Sebastiano Rossi", email: "sebastiano@dopamina.test" });
  await alpha.call(owner, "/api/access", { method: "PUT", body: { domains: ["dopamina.test"] } });
  const member = await alpha.login({ sub: "ac_marta", role: "member", name: "Marta Bianchi", email: "marta@dopamina.test" });

  const made = await alpha.call(owner, "/api/agents", { method: "POST", body: {
    name: "Radix", model: "ollama/test-model", chattiness: 0.3, tools: true, color: "#336699",
    personality: "Custode della memoria. Rispondi a Sebastiano (sebastiano@dopamina.test) in modo asciutto.",
    character: { enabled: true, scores: { prudenza: 17 } },
  } });
  assert.equal(made.status, 201);
  const radix = made.data;
  source.store.setCore(radix.id, "Il proprietario è Sebastiano Rossi (Seb, sebastiano@dopamina.test, +39 333 123 4567). Regola: verifica sempre healthz dopo un deploy.");
  source.store.setAvatarImage(radix.id, encodePng(512, 512, Buffer.alloc(512 * 512 * 4, 200)));
  source.store.appendArchive(CHANNEL, { id: "m1", at: Date.now(), authorId: "300000000000000009", authorName: "Marta Bianchi", kind: "human", content: "ciao" });
  const memoryKey = source.knowledge.ownerMemory ? source.knowledge.memoryKey(radix) : radix.id;
  source.store.addMemory(memoryKey, "Per i deploy si usa un worktree separato e poi si verifica healthz 200.");
  source.store.addMemory(memoryKey, "Seb preferisce risposte brevi e odia le conferme inutili.");
  source.store.addMemory(memoryKey, `Il thread di riferimento è ${DISCORD_LINK}, token ghp_abcdefghijklmnop1234.`);
  source.store.createRoutine(radix.id, { name: "Giro mattutino", schedule: "0 9 * * 1-5", channelId: CHANNEL, prompt: `Controlla le issue aperte e scrivi a sebastiano@dopamina.test un riepilogo; server 10.1.2.3.` });
  source.store.createRoutine(radix.id, { kind: "reminder", name: "Ricordo passato", runAt: "2020-01-01T09:00:00+01:00", channelId: CHANNEL, prompt: "vecchio" });
  source.store.createRoutine(radix.id, { kind: "reminder", name: "Ricordo futuro", runAt: "2099-01-01T09:00:00+01:00", channelId: CHANNEL, prompt: "Ricontrolla il rilascio." });
  source.vault.put({ name: "RADIX_DEPLOY_KEY", value: "fixture-value-never-exported", agents: [radix.id], by: { kind: "user", id: "ac_seb", name: "Sebastiano" } });

  // Only whoever manages the agent's memory takes it out.
  assert.equal((await alpha.call(member, `/api/agents/${radix.id}/export`)).status, 403);
  assert.equal((await alpha.call(member, `/api/agents/${radix.id}/export/file`, { method: "POST", body: {} })).status, 403);

  const preview = await alpha.call(owner, `/api/agents/${radix.id}/export`);
  assert.equal(preview.status, 200);
  for (const pattern of FORBIDDEN) assert.doesNotMatch(JSON.stringify({ ...preview.data, agent: { ...preview.data.agent, id: "" }, links: [] }), pattern);
  assert.deepEqual(preview.data.routines.map((routine) => routine.name), ["Giro mattutino", "Ricordo futuro"], "a reminder already past stays home");
  assert.deepEqual(preview.data.memories.map((memory) => memory.include), [true, false, true], "a memory about a person goes only when the owner picks it");
  assert.deepEqual(preview.data.requirements.secrets, ["RADIX_DEPLOY_KEY"]);
  assert.equal(preview.data.avatar.uploaded, true);

  const file = await alpha.call(owner, `/api/agents/${radix.id}/export/file`, { method: "POST", body: {} });
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-disposition"), /attachment; filename="radix\.cora-agent\.json"/);
  const pack = file.data;
  assert.equal(pack.format, "cora-agent");
  assert.equal(pack.version, 1);
  for (const pattern of [...FORBIDDEN, /fixture-value-never-exported/, new RegExp(radix.id), new RegExp(CHANNEL), /ac_seb/, /brainOwnerId/, /channelId/]) assert.doesNotMatch(file.text, pattern);
  assert.equal(pack.payload.memories.length, 2);
  assert.equal(pack.payload.routines.length, 2);
  assert.match(pack.payload.core, /verifica sempre healthz/);
  assert.match(pack.payload.avatar, /^data:image\/png;base64,/);

  // Links: a set number of downloads, then gone; a revoked one is gone at once.
  const link = await alpha.call(owner, `/api/agents/${radix.id}/export/links`, { method: "POST", body: { days: 1, downloads: 2, choice: { memories: [] } } });
  assert.equal(link.status, 201);
  const linkPath = new URL(link.data.url).pathname;
  assert.match(linkPath, /^\/agent-packages\/[A-Za-z0-9_-]{43}$/);
  assert.equal(link.data.counts.memories, 0, "the owner's choice holds in the link");
  const anonymous = await fetch(`${alpha.base}${linkPath}`);
  assert.equal(anonymous.status, 200, "the link opens without an account");
  assert.equal((await anonymous.json()).payload.memories.length, 0);
  const revoked = await alpha.call(owner, `/api/agents/${radix.id}/export/links`, { method: "POST", body: { days: 7, downloads: 5 } });
  assert.equal((await alpha.call(owner, `/api/agents/${radix.id}/export/links/${revoked.data.id}`, { method: "DELETE" })).data.status, "revoked");
  assert.equal((await fetch(`${alpha.base}${new URL(revoked.data.url).pathname}`)).status, 410);
  assert.equal((await fetch(`${alpha.base}/agent-packages/${"x".repeat(43)}`)).status, 410);

  // The other space reads the link once (second and last download), then the link is spent.
  const sara = await beta.login({ sub: "ac_sara", role: "owner", name: "Sara Verdi", email: "sara@other.test" });
  const agentsBefore = target.store.agents().length;
  const crossUrl = `${alpha.base}${linkPath}`;
  const staged = await beta.call(sara, "/api/agent-imports/preview", { method: "POST", body: { url: crossUrl } });
  assert.equal(staged.status, 200, JSON.stringify(staged.data));
  assert.equal(staged.data.name.requested, "Radix");
  assert.equal(staged.data.memories.length, 0);
  assert.ok(staged.data.channels.some((channel) => channel.id === CHANNEL), "the routines can be bound to this space's channels");
  assert.deepEqual(staged.data.requirements.secrets, [{ name: "RADIX_DEPLOY_KEY", present: false }]);
  assert.equal((await fetch(`${alpha.base}${linkPath}`)).status, 410, "two downloads, then the link is spent");
  assert.equal((await beta.call(sara, "/api/agent-imports/preview", { method: "POST", body: { url: crossUrl } })).status, 410);

  // Refusals create nothing.
  const tampered = structuredClone(pack); tampered.payload.core = "altro";
  assert.match((await beta.call(sara, "/api/agent-imports/preview", { method: "POST", body: { file: JSON.stringify(tampered) } })).data.error, /SHA-256/);
  assert.match((await beta.call(sara, "/api/agent-imports/preview", { method: "POST", body: { file: JSON.stringify({ ...pack, version: 9 }) } })).data.error, /Versione/);
  assert.equal((await beta.call(sara, "/api/agent-imports/preview", { method: "POST", body: { file: JSON.stringify(sealPackage({ ...pack.payload, core: "x".repeat(5 * 1024 * 1024) })) } })).status, 413);
  assert.match((await alpha.call(owner, "/api/agent-imports/preview", { method: "POST", body: { url: crossUrl } })).data.error, /HTTPS/, "a plain http link is refused");
  assert.match((await alpha.call(owner, "/api/agent-imports/preview", { method: "POST", body: { url: `https://127.0.0.1:1${linkPath}` } })).data.error, /indirizzo Internet pubblico/, "a space that does not allow local links refuses a private address");
  assert.equal(target.store.agents().length, agentsBefore);

  // From the file: an existing name is refused, the suggested one goes through.
  await beta.call(sara, "/api/agents", { method: "POST", body: { name: "Radix", model: "ollama/test-model" } });
  const fromFile = await beta.call(sara, "/api/agent-imports/preview", { method: "POST", body: { file: file.text } });
  assert.equal(fromFile.status, 200);
  assert.equal(fromFile.data.name.taken, true);
  assert.equal(fromFile.data.name.suggestion, "Radix 2");
  const stranger = await beta.login({ sub: "ac_other", role: "member", name: "Other", email: "other@other.test" });
  assert.equal((await beta.call(stranger, "/api/agent-imports", { method: "POST", body: { id: fromFile.data.id, name: "Radix 3" } })).status, 401, "a person not admitted to the space imports nothing");
  assert.equal((await beta.call(sara, "/api/agent-imports", { method: "POST", body: { id: fromFile.data.id, name: "Radix" } })).status, 409);
  assert.equal((await beta.call(sara, "/api/agent-imports", { method: "POST", body: { id: fromFile.data.id, name: "Radix 2", routines: { 0: "999999999999999999" } } })).status, 400, "a channel of another space is refused");
  const done = await beta.call(sara, "/api/agent-imports", { method: "POST", body: { id: fromFile.data.id, name: "Radix 2", routines: { 0: CHANNEL, 1: "skip" } } });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.deepEqual(done.data.created, { routines: 1, memories: 2, procedures: 0, skippedProcedures: 0 });
  const imported = target.store.agent(done.data.agent.id);
  assert.notEqual(imported.id, radix.id);
  assert.equal(imported.enabled, false, "an imported agent starts switched off");
  assert.equal(imported.brainOwnerId, target.store.panelUsers().find((person) => person.email === "sara@other.test").id);
  assert.equal(imported.color, "#336699");
  assert.match(imported.personality, /Custode della memoria/);
  assert.ok(imported.avatarUpload, "its picture travels with it");
  assert.match(imported.core, /\[persona\]/);
  const routines = target.store.routines(imported.id);
  assert.deepEqual(routines.map((routine) => [routine.name, routine.channelId, routine.enabled, routine.schedule]), [["Giro mattutino", CHANNEL, false, "0 9 * * 1-5"]]);
  assert.deepEqual(target.store.memories(imported.id).map((memory) => memory.source), ["import", "import"]);
  assert.equal((await beta.call(sara, "/api/agent-imports", { method: "POST", body: { id: fromFile.data.id, name: "Radix 4" } })).status, 410, "a preview is used once");
  assert.ok(target.store.recentActivity(20).some((entry) => /importato Radix 2 da file: 1 routine, 2 ricordi/.test(entry.text)));
});

test("with owner memory, only the agent's owner exports it, procedures travel and land in the importer's brain for review", async (t) => {
  const world = await knowledgeWorld();
  t.after(() => world.close());
  const { app, alice, bob, admin, request } = world;
  const agent = (await request(alice, "/api/agents", { method: "POST", body: { name: "Vera", model: "ollama/test-model", personality: "Analista scettica." } })).data;
  app.store.addMemory(app.knowledge.memoryKey(agent), "Prima di affermare qualcosa si verifica e si cita la fonte.");
  const page = await request(alice, "/api/brain/pages", { method: "POST", body: { kind: "procedure", title: "Rilascio settimanale", summary: "Come si rilascia", body: "1. Deploy in staging.\n2. Verifica healthz.\n3. Scrivi ad alice@owner.test." } });
  assert.equal(page.status, 201, JSON.stringify(page.data));
  assert.equal((await request(bob, `/api/agents/${agent.id}/export`)).status, 403, "another owner does not take someone else's agent");
  assert.equal((await request(admin, `/api/agents/${agent.id}/export`)).status, 403, "neither does the administrator of the space");
  const preview = await request(alice, `/api/agents/${agent.id}/export`);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.procedures.map((item) => [item.title, item.include]), [["Rilascio settimanale", false]], "a procedure naming a person waits for the owner's choice");
  assert.doesNotMatch(preview.data.procedures[0].body, /alice@owner\.test/);
  const fileResponse = await fetch(`${world.base}/api/agents/${agent.id}/export/file`, { method: "POST", headers: { ...alice.headers, "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ choice: { procedures: [preview.data.procedures[0].slug] } }) });
  const file = await fileResponse.text();
  assert.equal(JSON.parse(file).payload.procedures.length, 1);
  assert.equal(JSON.parse(file).payload.memories.length, 1);
  const staged = await request(bob, "/api/agent-imports/preview", { method: "POST", body: { file } });
  assert.equal(staged.status, 200);
  assert.equal(staged.data.brain, true);
  const done = await request(bob, "/api/agent-imports", { method: "POST", body: { id: staged.data.id, name: "Vera di Bob" } });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.deepEqual(done.data.created, { routines: 0, memories: 1, procedures: 1, skippedProcedures: 0 });
  const imported = app.store.agent(done.data.agent.id);
  assert.equal(imported.brainOwnerId, bob.user.id);
  assert.equal((await request(alice, `/api/agents/${imported.id}/export`)).status, 403, "the copy belongs to whoever imported it");
  const queue = await app.knowledge.forUser(bob.user).reviewQueue();
  assert.ok(queue.some((item) => /Rilascio settimanale/.test(JSON.stringify(item))), "the procedure waits for the importer's review");
});
