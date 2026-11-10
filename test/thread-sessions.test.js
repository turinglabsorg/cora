import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { Orchestrator } from "../src/orchestrator.js";
import { Store } from "../src/store.js";
import { ThreadSessions, pidAlive, sessionFailure } from "../src/thread-sessions.js";
import { fakeDocker, fakeOllama, tempHome } from "./helpers.js";
import { startCora } from "../src/main.js";

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
    const stale = store.openThreadSession({ agentId: "ag_a", channelId: "ch", kind: "chat", boot: "previous", host: "old", pid: child.pid });
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
