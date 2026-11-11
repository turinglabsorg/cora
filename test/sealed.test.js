import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { executeTool } from "../src/tools.js";
import { ownerRoom } from "../src/rooms.js";

const CLIENT_CHANNEL = "1570000000000000001";

test("a sealed agent keeps only its own memories, never reads or feeds the owner's brain, and keeps only what it was given by name", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  f.app.boxes.inspect = async () => ({ exists: false });
  const create = async (actor, body) => {
    const result = await f.request(actor, "/api/agents", { method: "POST", body: { tools: false, ...body } });
    assert.equal(result.status, 201); return f.app.store.agent(result.data.id);
  };
  const normal = await create(f.alice, { name: "Alice crew" });
  let zozzo = await create(f.alice, { name: "Zozzo", core: "ZOZZO_CARD" });
  f.app.store.updateAgent(zozzo.id, { channelIds: [CLIENT_CHANNEL] });
  f.app.store.addMemory(f.app.knowledge.memoryKey(normal), "ORBIT_OWNER_POOL", "manual");
  f.app.store.addMemory(zozzo.id, "ORBIT_ZOZZO_OWN", "manual");

  const { store, artifacts, knowledge } = f.app;
  store.writeVaultSecret({ id: "vs_named", name: "ZOZZO_KEY", agents: [zozzo.id], createdBy: { kind: "user", id: f.alice.user.id } });
  store.writeVaultSecret({ id: "vs_all", name: "TEAM_KEY", agents: ["*"], createdBy: { kind: "user", id: f.alice.user.id } });
  const named = artifacts.createFolder({ path: "clienti/zozzo", description: "Zozzo", writers: [zozzo.id], createdBy: { kind: "user", id: f.alice.user.id } });
  const team = artifacts.createFolder({ path: "interno/roadmap", description: "Roadmap", writers: ["*"], createdBy: { kind: "user", id: f.alice.user.id } });
  store.setValue("keyConnectors", [{ service: "asana", status: "connected", agents: [zozzo.id, normal.id] }]);
  assert.equal(f.app.vault.canUse(store.vaultSecret("TEAM_KEY"), zozzo), true, "before the seal the team rules apply");

  const path = `/api/agents/${zozzo.id}/knowledge`;
  assert.equal((await f.request(f.bob, path, { method: "PUT", body: { sealed: true } })).status, 403);
  const sealed = await f.request(f.alice, path, { method: "PUT", body: { sealed: true } });
  assert.equal(sealed.status, 200); assert.equal(sealed.data.sealed, true);
  zozzo = store.agent(zozzo.id);

  // Sealing keeps what was given to it by name; the rules for every agent stop applying.
  assert.deepEqual(store.vaultSecret("ZOZZO_KEY").agents, [zozzo.id]);
  assert.equal(f.app.vault.canUse(store.vaultSecret("ZOZZO_KEY"), zozzo), true);
  assert.deepEqual(store.artifactFolder(named.id).writers, [zozzo.id]);
  assert.deepEqual(store.value("keyConnectors")[0].agents, [zozzo.id, normal.id]);
  assert.equal(f.app.vault.canUse(store.vaultSecret("TEAM_KEY"), zozzo), false);
  assert.equal(artifacts.canWrite(store.artifactFolder(team.id), zozzo), false);
  assert.equal(artifacts.canWrite(store.artifactFolder(team.id), normal), true);

  // Card, diary and its own memories stay; the owner's pool and the brain do not reach it.
  assert.equal(store.agent(zozzo.id).core, "ZOZZO_CARD");
  assert.match(f.app.brain.memoryContext(zozzo, "orbit"), /ORBIT_ZOZZO_OWN/);
  assert.doesNotMatch(f.app.brain.memoryContext(zozzo, "orbit"), /ORBIT_OWNER_POOL/);
  assert.doesNotMatch(f.app.brain.memoryContext(normal, "orbit"), /ORBIT_ZOZZO_OWN/);
  await knowledge.ownerBrain(f.alice.user.id).write({ slug: "orbit", kind: "client", title: "Orbit", body: "ORBIT_OWNER_PAGE", author: "librarian" });
  assert.equal(await f.app.brain.brainContext("orbit", zozzo), "");
  assert.match(await f.app.brain.brainContext("orbit", normal), /Orbit/);

  const ctx = { agent: zozzo, store, knowledge, artifacts, memory: f.app.brain.memory, companyBrain: f.app.companyBrain, channelIds: f.app.brain.channelIdsFor(zozzo), channelLabel: String, formatWhen: String, requester: { kind: "owner", id: f.alice.user.id }, boxes: {} };
  for (const name of ["brain_search", "brain_page", "brain_note"]) assert.match((await executeTool({ name, args: { query: "orbit", slug: "orbit", text: "ZOZZO_LEAK" } }, ctx)).text, /sealed/);
  assert.equal((await knowledge.ownerBrain(f.alice.user.id).notes()).length, 0, "a sealed agent never writes into the owner's brain");
  const saved = await executeTool({ name: "remember", args: { fact: "ORBIT_CLIENT_FACT", shared: true } }, ctx);
  assert.match(saved.text, /own memories/);
  assert.ok(store.memories(zozzo.id).some((item) => item.text === "ORBIT_CLIENT_FACT"));
  assert.ok(!store.memories(knowledge.memoryKey(normal)).some((item) => item.text === "ORBIT_CLIENT_FACT"));
  assert.doesNotMatch((await executeTool({ name: "recall", args: { query: "ORBIT" } }, ctx)).text, /OWNER_POOL/);
  assert.match((await executeTool({ name: "share_file", args: { agent: normal.name, path: "/home/agent/work/x" } }, ctx)).text, /sealed/);
  assert.match((await executeTool({ name: "artifact_log", args: { folder: team.path } }, ctx)).text, /not available/);
  assert.deepEqual(JSON.parse((await executeTool({ name: "artifact_folders", args: {} }, ctx)).text).folders.map((item) => item.folder), ["clienti/zozzo"]);

  // What is said with it, or where only it listens, stays out of the owner's brain; it hears no salotto.
  const now = Date.now();
  assert.equal(knowledge.messageOwner({ channelId: "web-" + zozzo.id, kind: "owner", authorId: f.alice.user.id, at: now, content: "x" }), "");
  assert.equal(knowledge.messageOwner({ channelId: CLIENT_CHANNEL, kind: "human", authorId: f.alice.user.id, at: now, content: "x" }), "");
  assert.equal(knowledge.messageOwner({ channelId: "1570000000000000099", kind: "agent", agentId: zozzo.id, at: now, content: "x" }), "");
  assert.equal(knowledge.messageOwner({ channelId: "web-" + normal.id, kind: "owner", authorId: f.alice.user.id, at: now, content: "x" }), f.alice.user.id);
  store.appendArchive("web-" + zozzo.id, { id: "sealed-room", kind: "owner", authorId: f.alice.user.id, authorName: "alice", at: now, content: "ORBIT_SEALED_ROOM_PRIVATE" });
  store.appendArchive("web-" + normal.id, { id: "open-room", kind: "owner", authorId: f.alice.user.id, authorName: "alice", at: now, content: "ORBIT_OPEN_ROOM" });
  await f.app.librarian.forOwner(f.alice.user.id).run();
  const archive = JSON.stringify(await knowledge.ownerBrain(f.alice.user.id).searchArchive("ORBIT"));
  assert.match(archive, /ORBIT_OPEN_ROOM/); assert.doesNotMatch(archive, /SEALED_ROOM/);
  // Agents listening everywhere by default stay out of the channel it was put in alone; named there, it is shared again.
  assert.deepEqual(f.app.orchestrator.agentsFor(CLIENT_CHANNEL).map((agent) => agent.id), [zozzo.id]);
  assert.ok(!f.app.brain.channelIdsFor(normal).includes(CLIENT_CHANNEL));
  store.updateAgent(normal.id, { channelIds: [CLIENT_CHANNEL] });
  assert.deepEqual(f.app.orchestrator.agentsFor(CLIENT_CHANNEL).map((agent) => agent.id).sort(), [normal.id, zozzo.id].sort());
  assert.equal(knowledge.messageOwner({ channelId: CLIENT_CHANNEL, kind: "human", authorId: f.alice.user.id, at: now, content: "x" }), f.alice.user.id);
  // In a channel shared with other agents it works as usual: they know each other there, while its brain stays closed.
  assert.match(f.app.brain.systemPrompt(store.agent(zozzo.id), {}), /Alice crew/);
  assert.match(f.app.brain.systemPrompt(store.agent(normal.id), {}), /Zozzo/);
  assert.equal(await f.app.brain.brainContext("orbit", store.agent(zozzo.id)), "");
  store.updateAgent(normal.id, { channelIds: [] });
  assert.ok(!f.app.orchestrator.agentsFor(ownerRoom(f.alice.user.id)).some((agent) => agent.id === zozzo.id));
  assert.ok(f.app.orchestrator.agentsFor(ownerRoom(f.alice.user.id)).some((agent) => agent.id === normal.id));

  // Its prompt says it is sealed; colleagues it shares no channel with are not listed, and it is not listed to them.
  const prompt = f.app.brain.systemPrompt(zozzo, {});
  assert.match(prompt, /## Agente sigillato/); assert.doesNotMatch(prompt, /Alice crew|Memorie del tuo proprietario/);
  assert.doesNotMatch(f.app.brain.systemPrompt(normal, {}), /Zozzo/);

  // Only its owners open it: not the owner of the space, not another person.
  assert.equal((await f.request(f.admin, `/api/agents/${zozzo.id}/memories`)).status, 403);
  assert.equal((await f.request(f.bob, `/api/agents/${zozzo.id}/memories`)).status, 403);
  const own = (await f.request(f.alice, `/api/agents/${zozzo.id}/memories`)).data;
  assert.equal(own.sealed, true); assert.deepEqual(own.facts.map((item) => item.text).sort(), ["ORBIT_CLIENT_FACT", "ORBIT_ZOZZO_OWN"]);
  assert.equal((await f.request(f.alice, `/api/agents/${zozzo.id}`, { method: "PUT", body: { sealed: false } })).status, 200);
  assert.equal(store.agent(zozzo.id).sealed, true, "the seal changes only from the Brain card");

  // Unsealed, it finds its memories and its owner's again, and keeps what it was given.
  assert.equal((await f.request(f.alice, path, { method: "PUT", body: { sealed: false } })).data.sealed, false);
  const open = store.agent(zozzo.id);
  const context = f.app.brain.memoryContext(open, "orbit");
  assert.match(context, /ORBIT_ZOZZO_OWN/); assert.match(context, /ORBIT_CLIENT_FACT/); assert.match(context, /ORBIT_OWNER_POOL/);
  assert.equal(f.app.vault.canUse(store.vaultSecret("TEAM_KEY"), open), true);
  assert.deepEqual(store.value("keyConnectors")[0].agents, [zozzo.id, normal.id]);
  assert.equal(f.app.vault.canUse(store.vaultSecret("ZOZZO_KEY"), open), true);
});

test("a new agent can be created sealed and then lives only where it is put", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  f.app.boxes.inspect = async () => ({ exists: false });
  const result = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Cliente", sealed: true, tools: false } });
  assert.equal(result.status, 201); assert.equal(result.data.sealed, true);
  const agent = f.app.store.agent(result.data.id);
  assert.deepEqual(f.app.brain.channelIdsFor(agent), ["web-" + agent.id]);
  assert.ok(!f.app.orchestrator.agentsFor(ownerRoom(f.alice.user.id)).some((item) => item.id === agent.id));
  assert.ok(f.app.orchestrator.agentsFor("web-" + agent.id).some((item) => item.id === agent.id));
});

for (const ownerMemory of [true, false]) test(`sealed boundaries also hold with ownerMemory=${ownerMemory}: prompts, archives, sleep, stale tools and private panel`, async (t) => {
  const f = await knowledgeWorld({ ownerMemory }); t.after(f.close);
  f.app.boxes.inspect = async () => ({ exists: false });
  const { store, knowledge, brain, artifacts } = f.app;
  artifacts.syncBrain = async () => {};
  const created = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Isolated fixture", sealed: true, enabled: true, tools: false } });
  const agent = store.agent(created.data.id);
  const other = store.createAgent({ name: "Foreign fixture", brainOwnerId: f.alice.user.id, tools: false });
  const foreign = store.addMemory(ownerMemory ? knowledge.memoryKey(other) : "shared", "SENTINEL_FOREIGN_FACT", "manual");
  store.addMemory(agent.id, "SENTINEL_OWN_FACT", "manual");
  store.saveContextDocument({ name: "shared-context.md", content: "SENTINEL_SHARED_DOCUMENT", enabled: true });
  const now = Date.now();
  for (const [who, text] of [[agent,"SENTINEL_OWN_CHAT"],[other,"SENTINEL_FOREIGN_CHAT"]]) store.appendArchive("web-" + who.id, { id: "msg-" + who.id, kind: "owner", authorId: f.alice.user.id, authorName: "alice", at: now, content: text });
  const ctx = { agent, store, knowledge, artifacts, memory: brain.memory, companyBrain: f.app.companyBrain, channelIds: brain.channelIdsFor(agent), channelLabel: String, formatWhen: String, boxes: {} };
  const recalled = (await executeTool({ name: "recall", args: { query: "SENTINEL" } }, ctx)).text;
  assert.match(recalled, /SENTINEL_OWN_FACT|SENTINEL_OWN_CHAT/);
  assert.doesNotMatch(recalled, /SENTINEL_FOREIGN|SHARED_DOCUMENT/);
  assert.doesNotMatch(brain.systemPrompt(agent, {}), /SENTINEL_SHARED_DOCUMENT|Foreign fixture/);
  const consolidation = brain.applySleep(agent, { add: [{ text: "SENTINEL_SLEEP_PRIVATE", shared: true }], update: [{ id: foreign.id, text: "CORRUPTED" }], remove: [foreign.id] });
  assert.equal(consolidation.noted, 0);
  assert.ok(store.memories(agent.id).some((fact) => fact.text === "SENTINEL_SLEEP_PRIVATE"));
  assert.equal(store.findMemory(foreign.id).memory.text, "SENTINEL_FOREIGN_FACT");
  for (const path of [`/api/agents/${agent.id}`, `/api/agents/${agent.id}/memories`, `/api/agents/${agent.id}/knowledge`]) {
    assert.equal((await f.request(f.bob, path)).status, 403, path);
    assert.equal((await f.request(f.admin, path)).status, 403, path);
  }
  assert.ok(!(await f.request(f.bob, "/api/state")).data.agents.some((item) => item.id === agent.id));
  artifacts.createFolder({ path: "scope/allowed", description: "Allowed", writers: [agent.id], createdBy: { kind: "user", id: f.alice.user.id } });
  artifacts.createFolder({ path: "scope/foreign", description: "Foreign", writers: [other.id], createdBy: { kind: "user", id: f.alice.user.id } });
  assert.match((await executeTool({ name: "artifact_share", args: { folder: "scope", label: "scope-probe" } }, ctx)).text, /not assigned/);
  store.updateAgent(agent.id, { sealed: false });
  let called = false;
  ctx.boxes.ensure = async () => { called = true; };
  assert.match((await executeTool({ name: "shell", args: { command: "true" } }, ctx)).text, /cambiata/);
  assert.equal(called, false, "a stale worker cannot use any tool after the seal changes");
});

test("seal changes wait for desktop isolation, reject busy agents and retry a failed transition without reopening tools", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const { store, knowledge } = f.app;
  const created = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Transition fixture", tools: false } });
  const before = store.agent(created.data.id);
  const endpoint = `/api/agents/${before.id}/knowledge`;
  knowledge.isBusy = () => true;
  assert.equal((await f.request(f.alice, endpoint, { method: "PUT", body: { sealed: true } })).status, 409);
  assert.equal(store.agent(before.id).sealed, false);
  knowledge.isBusy = () => false;
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  knowledge.onSealChanged = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  let finished = false;
  const request = f.request(f.alice, endpoint, { method: "PUT", body: { sealed: true } }).then((value) => { finished = true; return value; });
  await started;
  assert.equal(finished, false);
  const current = store.agent(before.id);
  const blocked = await executeTool({ name: "shell", args: { command: "true" } }, { agent: current, knowledge, store });
  assert.match(blocked.text, /aggiornamento/);
  release();assert.equal((await request).status, 200);
  knowledge.onSealChanged = async () => { throw new Error("fixture firewall failure"); };
  assert.equal((await f.request(f.alice, endpoint, { method: "PUT", body: { sealed: true } })).status, 500);
  let retried = false;
  knowledge.onSealChanged = async () => { retried = true; };
  assert.equal((await f.request(f.alice, endpoint, { method: "PUT", body: { sealed: true } })).status, 200);
  assert.equal(retried, true);
});
