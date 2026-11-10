import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { Orchestrator } from "../src/orchestrator.js";
import { Store } from "../src/store.js";
import { hostname } from "node:os";
import { ThreadSessions, machineBoot, pidAlive, sessionFailure } from "../src/thread-sessions.js";
import { fakeDocker, fakeOllama, tempHome } from "./helpers.js";
import { startCora } from "../src/main.js";
import { knowledgeWorld } from "./knowledge-fixtures.js";

function sessions() {
  const store = new Store(tempHome());
  return { store, sessions: new ThreadSessions(store) };
}

test("spend limit and a dropped connection are instance failures; a stop is not", () => {
  assert.equal(sessionFailure(new Error("claude: You've hit your individual spend limit")), true);
  assert.equal(sessionFailure(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(sessionFailure(new Error("Individual quota reached. Resets in 166h32m5s.")), false);
  assert.equal(sessionFailure(new Error("The operation was aborted")), false);
  assert.equal(sessionFailure(new Error("fermata dal pannello")), false);
});

test("one agent holds a single live session in a thread; a colleague holds another", () => {
  const { store, sessions: live } = sessions();
  const first = live.begin({ agentId: "ag_a", channelId: "ch", kind: "chat" });
  assert.ok(first);
  assert.equal(live.begin({ agentId: "ag_a", channelId: "ch", kind: "chat" }), null);
  const second = live.begin({ agentId: "ag_b", channelId: "ch", kind: "chat" });
  assert.ok(second);
  assert.notEqual(second.id, first.id);
  live.finish(first);
  live.finish(second);
  assert.equal(store.activeThreadSessions().length, 0);
  assert.equal(store.threadSession(first.id).status, "done");
  store.close();
});

test("a session with no live process can be taken again", () => {
  const { store, sessions: live } = sessions();
  const stale = store.openThreadSession({ agentId: "ag_a", channelId: "ch", kind: "chat", boot: "previous", host: "old" });
  const next = live.begin({ agentId: "ag_a", channelId: "ch", kind: "chat" });
  assert.ok(next);
  assert.equal(store.threadSession(stale.id).status, "interrupted");
  live.finish(next);
  store.close();
});

test("restart kills the previous process before a new session starts", async () => {
  const { store } = sessions();
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  child.unref();
  try {
    const stale = store.openThreadSession({ agentId: "ag_a", channelId: "ch", kind: "chat", boot: "previous", host: hostname(), machine: machineBoot(), pid: child.pid });
    const live = new ThreadSessions(store);
    live.reap();
    assert.equal(store.threadSession(stale.id).status, "killed");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(pidAlive(child.pid), false);
  } finally {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* already stopped */ }
    store.close();
  }
});

test("a pid saved before a reboot or on another machine is never killed and never holds the thread", async () => {
  const { store } = sessions();
  const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  child.unref();
  try {
    const rebooted = store.openThreadSession({ agentId: "ag_a", channelId: "ch", kind: "chat", boot: "previous", host: hostname(), machine: "another-boot", pid: child.pid });
    const elsewhere = store.openThreadSession({ agentId: "ag_b", channelId: "ch", kind: "chat", boot: "previous", host: "other-host", machine: machineBoot(), pid: child.pid });
    const live = new ThreadSessions(store);
    assert.equal(live.blocking("ag_a", "ch"), null);
    live.reap();
    assert.equal(store.threadSession(rebooted.id).status, "killed");
    assert.equal(store.threadSession(elsewhere.id).status, "killed");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(pidAlive(child.pid), true);
    const next = live.begin({ agentId: "ag_a", channelId: "ch", kind: "chat" });
    assert.ok(next);
    live.finish(next);
  } finally {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* already stopped */ }
    store.close();
  }
});

test("an instance error opens one replacement and a stop does not", async () => {
  const { store, sessions: live } = sessions();
  const orch = { sessions: live, store, log() {} };
  let calls = 0;
  const replaced = await Orchestrator.prototype.withSession.call(orch, { id: "ag_a" }, "ch", "chat", async () => {
    calls += 1;
    if (calls === 1) throw new Error("claude: You've hit your individual spend limit");
    return { text: "ok" };
  });
  assert.equal(replaced.busy, false);
  assert.equal(replaced.value.text, "ok");
  assert.equal(calls, 2);
  const rows = store.threadSessions();
  assert.equal(rows.filter((row) => row.status === "error").length, 1);
  assert.equal(rows.filter((row) => row.status === "done").length, 1);

  calls = 0;
  await assert.rejects(() => Orchestrator.prototype.withSession.call(orch, { id: "ag_a" }, "ch", "chat", async () => {
    calls += 1;
    live.stop("ag_a", "ch");
    throw new Error("The operation was aborted");
  }));
  assert.equal(calls, 1);
  assert.equal(store.activeThreadSessions().length, 0);
  store.close();
});

test("the thread board shows one flow per agent and stop ends only that flow", async (t) => {
  const ollama = await fakeOllama(() => ({ content: "PASS" }));
  const app = startCora({
    home: tempHome(), host: "127.0.0.1", port: 0, adminPassword: "fixture-password", sessionKey: "fixture-session", insecureCookies: true,
    useResidentSubscriptions: false, cloudUrl: "", cloudKey: "", cloudSpace: "", discordToken: "", telegramToken: "", botTokenFor: () => "",
    ollamaUrl: ollama.url, ollamaKey: "fixture-key", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    ownerInstructions: "/missing/AGENTS.md", sshAuthorizedKeys: "/missing/keys", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000,
  });
  t.after(async () => { await app.stop(); await ollama.close(); });
  await app.ready;
  const nico = app.store.createAgent({ name: "Nico" });
  const vera = app.store.createAgent({ name: "Vera" });
  const channelId = "155500000000000099";
  app.orchestrator.sessions.begin({ agentId: nico.id, channelId, kind: "chat" });
  app.orchestrator.sessions.begin({ agentId: vera.id, channelId, kind: "routine" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, body) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "X-Cora": "1", "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const open = await call("/api/threads");
  assert.equal(open.status, 200);
  const row = open.body.threads.find((thread) => thread.id === channelId);
  assert.ok(row);
  assert.deepEqual(row.flows.map((flow) => flow.agentName).sort(), ["Nico", "Vera"]);
  assert.equal(row.flows.every((flow) => flow.status === "active"), true);
  const stopped = await call("/api/threads/stop", { id: channelId, agentId: nico.id });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.stopped, 1);
  const after = await call("/api/threads");
  const flows = after.body.threads.find((thread) => thread.id === channelId).flows;
  assert.equal(flows.find((flow) => flow.agentId === nico.id).status, "stopped");
  assert.equal(flows.find((flow) => flow.agentId === vera.id).status, "active");
  const anon = await fetch(base + "/api/threads/close", { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ id: channelId }) });
  assert.equal(anon.status, 401);
});

test("the thread page keeps names, refuses channels, reopens closed threads and shows every turn", async (t) => {
  const ollama = await fakeOllama(() => ({ content: "PASS" }));
  const app = startCora({
    home: tempHome(), host: "127.0.0.1", port: 0, adminPassword: "fixture-password", sessionKey: "fixture-session", insecureCookies: true,
    useResidentSubscriptions: false, cloudUrl: "", cloudKey: "", cloudSpace: "", discordToken: "", telegramToken: "", botTokenFor: () => "",
    ollamaUrl: ollama.url, ollamaKey: "fixture-key", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    ownerInstructions: "/missing/AGENTS.md", sshAuthorizedKeys: "/missing/keys", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000,
  });
  t.after(async () => { await app.stop(); await ollama.close(); });
  await app.ready;
  const nico = app.store.createAgent({ name: "Nico" });
  const vera = app.store.createAgent({ name: "Vera" });
  const threadId = "155500000000000123";
  const channelId = "155500000000000124";
  const orch = app.orchestrator;
  const listed = [
    { id: channelId, name: "generale", kind: "discord", guildId: "g1", thread: false },
    { id: threadId, name: "REF-62 pagine Admin", kind: "discord", guildId: "g1", thread: true, parentId: channelId },
  ];
  const realList = orch.channels.list.bind(orch.channels);
  orch.channels.list = () => [...realList(), ...listed];
  const first = orch.sessions.begin({ agentId: nico.id, channelId: threadId, kind: "chat" });
  orch.sessions.finish(first);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, body) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "X-Cora": "1", "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const seen = (await call("/api/threads")).body.threads.find((thread) => thread.id === threadId);
  assert.equal(seen.name, "REF-62 pagine Admin");
  assert.equal(seen.parentName, "generale");

  // Archived on Discord: the gateway no longer lists it, the remembered name stays.
  listed.pop();
  const archived = (await call("/api/threads")).body.threads.find((thread) => thread.id === threadId);
  assert.equal(archived.name, "REF-62 pagine Admin");
  assert.equal(archived.thread, true);
  assert.equal(archived.link, `https://discord.com/channels/g1/${threadId}`);
  assert.equal(archived.open, false);

  // A whole channel is not renamed or closed from here.
  orch.sessions.finish(orch.sessions.begin({ agentId: vera.id, channelId, kind: "chat" }));
  const rename = await call("/api/threads/rename", { id: channelId, name: "nuovo" });
  assert.equal(rename.status, 400);
  const close = await call("/api/threads/close", { id: channelId });
  assert.equal(close.status, 400);

  // Closed, then someone writes again: the thread is open again.
  app.store.setValue("closedThreads", [threadId]);
  await orch.withSession(nico, threadId, "chat", async () => ({ text: "ok" }));
  assert.equal(app.store.value("closedThreads", []).includes(threadId), false);

  const trace = orch.brain.traces.start({ agentId: nico.id, kind: "chat", channelId: threadId, model: "ollama/fixture", prompt: "p", system: "s" });
  trace.add({ type: "thinking", text: "Leggo la pagina Settori" });
  const page = await call(`/api/threads/${threadId}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.thread.name, "REF-62 pagine Admin");
  const turn = page.body.traces.find((item) => item.id === trace.id);
  assert.ok(turn);
  assert.equal(turn.agentName, "Nico");
  assert.equal(turn.prompt, undefined);
  assert.equal(turn.system, undefined);
  assert.equal(turn.steps[0].text, "Leggo la pagina Settori");
  trace.finish({ status: "done", output: "Fatto" });
  const stored = (await call(`/api/threads/${threadId}`)).body.traces.find((item) => item.id === trace.id);
  assert.equal(stored.output, "Fatto");
  assert.equal(stored.steps.length, 1);
  assert.equal(stored.prompt, undefined);
  assert.equal((await call("/api/threads/155500000000000999")).status, 404);
});

test("a co-owner stops only the sessions of agents they manage and sees only their turns", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const mine = f.app.store.createAgent({ name: "Clara", brainOwnerId: f.alice.user.id, tools: false });
  const other = f.app.store.createAgent({ name: "Milo", brainOwnerId: f.bob.user.id, tools: false });
  const channelId = "155500000000000321";
  f.app.orchestrator.sessions.begin({ agentId: mine.id, channelId, kind: "chat" });
  f.app.orchestrator.sessions.begin({ agentId: other.id, channelId, kind: "chat" });
  const turnOf = (agent) => { const trace = f.app.orchestrator.brain.traces.start({ agentId: agent.id, kind: "chat", channelId }); trace.finish({ status: "done", output: agent.name }); return trace; };
  turnOf(mine); turnOf(other);
  const board = await f.request(f.alice, "/api/threads");
  const row = board.data.threads.find((thread) => thread.id === channelId);
  assert.deepEqual(row.flows.map((flow) => [flow.agentName, flow.canStop]), [["Clara", true]]);
  const page = await f.request(f.alice, `/api/threads/${channelId}`);
  assert.deepEqual(page.data.traces.map((trace) => trace.agentName), ["Clara"]);
  assert.equal((await f.request(f.alice, "/api/threads/stop", { method: "POST", body: { id: channelId, agentId: other.id } })).status, 403);
  assert.equal((await f.request(f.alice, "/api/threads/stop", { method: "POST", body: { id: channelId } })).status, 403);
  assert.equal((await f.request(f.alice, "/api/threads/rename", { method: "POST", body: { id: channelId, name: "x" } })).status, 403);
  const stopped = await f.request(f.alice, "/api/threads/stop", { method: "POST", body: { id: channelId, agentId: mine.id } });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.data.stopped, 1);
  assert.equal(f.app.store.activeThreadSession(other.id, channelId)?.status, "active");
});
