import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
import { Traces } from "../src/traces.js";
import { executeTool } from "../src/tools.js";
import { fakeDocker, fakeOllama, tempHome, waitFor } from "./helpers.js";

async function fixture(t, { home = tempHome(), reply, judge } = {}) {
  const control = { reply: reply || (() => ({ content: "Controllo completato." })), judge: judge || (() => JSON.stringify({ met: true, reason: "Risultato confermato dagli strumenti." })) };
  const ollama = await fakeOllama((body) => /^Giudichi se/.test(body.messages[0]?.content || "")
    ? { content: control.judge(body) } : control.reply(body));
  const app = startCora({ home, host: "127.0.0.1", port: 0, adminPassword: "fixture-password", sessionKey: "fixture-session", insecureCookies: true,
    useResidentSubscriptions: false, cloudUrl: "", cloudKey: "", cloudSpace: "", discordToken: "", telegramToken: "", botTokenFor: () => "",
    ollamaUrl: ollama.url, ollamaKey: "fixture-key", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    ownerInstructions: "/missing/AGENTS.md", sshAuthorizedKeys: "/missing/keys", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000 });
  await app.ready;
  app.store.updateSettings({ defaultModel: "ollama/test-model", maxAgentTurns: 0 });
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await app.stop(); await ollama.close(); } };
  t.after(stop);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (path, { method = "GET", body, auth = true, csrf = true } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(auth ? { Cookie: cookie } : {}), ...(csrf ? { "X-Cora": "1" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const agent = app.store.createAgent({ name: "Rina", model: "ollama/test-model", tools: false, chattiness: 0 });
  const create = async (extra = {}) => {
    const result = await request(`/api/agents/${agent.id}/routines`, { method: "POST", body: { kind: "reminder", name: "Consegna", runAt: "2050-02-03T09:30:00+01:00", channelId: `web-${agent.id}`, prompt: "Controlla la ricevuta e riporta il risultato.", ...extra } });
    assert.equal(result.status, 201);
    return result.data;
  };
  return { app, home, agent, create, request, control, stop };
}

test("a reminder runs once, checks real evidence even with goal mode off, and persists in the archive", async (t) => {
  const f = await fixture(t);
  let steps = 0;
  f.control.reply = () => ++steps === 1 ? { tool_calls: [{ function: { name: "remember", arguments: { fact: "Ricevuta ORBIT controllata: esito positivo." } } }] } : { content: "Ricevuta ORBIT verificata." };
  f.control.judge = (body) => {
    assert.match(body.messages[1].content, /remember[\s\S]*Ricevuta ORBIT controllata/);
    assert.match(body.messages[1].content, /Messaggio finale effettivamente consegnato/);
    return JSON.stringify({ met: true, reason: "Ricevuta confermata." });
  };
  const reminder = await f.create();
  assert.equal(f.app.store.settings.goalMode, false);
  assert.equal((await f.request(`/api/routines/${reminder.id}/run`, { method: "POST" })).status, 202);
  await waitFor(() => f.app.store.routine(reminder.id, { archived: true }).archiveReason === "completed");
  assert.equal((await f.request(`/api/routines/${reminder.id}/run`, { method: "POST" })).status, 404);
  assert.equal((await f.app.orchestrator.runRoutine(reminder)).status, "archived");
  f.app.scheduler.tick(new Date("2051-01-01T09:00:00Z"));
  assert.equal(steps, 2);
  const history = (await f.request(`/api/routines/history?agentId=${f.agent.id}`)).data;
  assert.equal(history.total, 1);
  assert.equal(history.items[0].status, "completed");
  assert.equal(history.items[0].verification.met, true);
  assert.ok(history.items[0].traceId);
  assert.ok(history.items[0].verification.traceId);
  await f.stop();
  const reopened = new Store(f.home);
  try { assert.equal(reopened.routines().length, 0); assert.equal(reopened.routineArchive().total, 1); assert.equal(reopened.routineHistory().items[0].output, "Ricevuta ORBIT verificata."); }
  finally { reopened.close(); }
});

test("an unsuccessful reminder remains open, never automatically repeats, and a manual retry retains both attempts", async (t) => {
  const f = await fixture(t, { judge: () => JSON.stringify({ met: false, reason: "La ricevuta non c'è." }) });
  const reminder = await f.create({ runAt: "2020-01-01T09:00:00Z" });
  assert.equal((await f.app.orchestrator.runRoutine(reminder)).status, "unverified");
  assert.ok(f.app.store.routine(reminder.id));
  for (let minute = 0; minute < 3; minute++) f.app.scheduler.tick(new Date(`2050-02-03T10:0${minute}:00Z`));
  assert.equal(f.app.store.routineHistory().total, 1);
  f.control.judge = () => JSON.stringify({ met: true, reason: "Ricevuta presente." });
  assert.equal((await f.app.orchestrator.runRoutine(reminder, { manual: true })).status, "completed");
  assert.deepEqual(f.app.store.routineHistory().items.map((run) => run.status), ["completed", "unverified"]);
});

test("a missing verifier, invalid verdict or owner dependency never becomes a successful reminder", async (t) => {
  const f = await fixture(t);
  for (const output of ["not JSON", JSON.stringify({ met: true, blocked: true, reason: "Verdetto contraddittorio." }), JSON.stringify({ met: false, blocked: true, reason: "Serve un permesso." })]) {
    f.control.judge = () => output;
    const reminder = await f.create({ name: output.slice(0, 12) });
    assert.equal((await f.app.orchestrator.runRoutine(reminder)).status, "blocked");
    assert.equal(f.app.store.routine(reminder.id).archivedAt, null);
  }
  const reminder = await f.create({ name: "Provider offline" });
  const chat = f.app.llm.chat.bind(f.app.llm);
  f.app.llm.chat = (options) => /^Giudichi se/.test(options.messages[0]?.content || "") ? Promise.reject(new Error("fixture verifier unavailable")) : chat(options);
  assert.equal((await f.app.orchestrator.runRoutine(reminder)).status, "blocked");
  assert.equal(f.app.store.routineArchive().total, 0);
});

test("busy threads defer reminders without consuming them, then overdue reminders execute exactly once", async (t) => {
  const f = await fixture(t);
  const reminder = await f.create({ runAt: "2020-01-01T09:00:00Z" });
  f.app.orchestrator.threadWork.set(reminder.channelId, "other-agent");
  f.app.scheduler.tick(new Date("2050-01-01T12:01:00Z"));
  assert.equal(f.app.store.routine(reminder.id).lastStatus, "skipped");
  assert.equal(f.app.store.routineHistory().items[0].status, "skipped");
  f.app.orchestrator.threadWork.delete(reminder.channelId);
  f.app.scheduler.tick(new Date("2050-01-01T12:02:00Z"));
  f.app.scheduler.tick(new Date("2050-01-01T12:03:00Z"));
  await waitFor(() => f.app.store.routine(reminder.id, { archived: true }).archiveReason === "completed");
  assert.deepEqual(f.app.store.routineHistory().items.map((run) => run.status), ["completed", "skipped"]);
});

test("archiving during execution cancels stale tools and preserves the task and its stopped attempt", async (t) => {
  const f = await fixture(t);
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  f.control.reply = async () => { entered.resolve(); await gate.promise; return { tool_calls: [{ function: { name: "remember", arguments: { fact: "STALE ACTION" } } }] }; };
  const reminder = await f.create();
  const pending = f.app.orchestrator.runRoutine(reminder);
  await entered.promise;
  await f.request(`/api/routines/${reminder.id}`, { method: "DELETE" });
  gate.resolve();
  assert.equal((await pending).status, "stopped");
  assert.equal(f.app.store.routineArchive().items[0].archiveReason, "cancelled");
  assert.equal(f.app.store.routineHistory().items[0].status, "stopped");
  assert.ok(!f.app.store.memories(f.agent.id).some((item) => item.text === "STALE ACTION"));
});

test("agents can create reminders and search only their own persisted executions without computer access", async (t) => {
  const f = await fixture(t);
  const ctx = { agent: f.agent, store: f.app.store, channelId: `web-${f.agent.id}`, channelLabel: (id) => id, formatWhen: (date) => new Date(date).toISOString() };
  assert.match((await executeTool({ name: "set_reminder", args: { name: "Richiamo", run_at: "2050-02-03T09:00:00Z", prompt: "Ricordami ORBIT." } }, ctx)).text, /created/);
  const reminder = f.app.store.routines(f.agent.id)[0];
  await f.app.orchestrator.runRoutine(reminder);
  const other = f.app.store.createAgent({ name: "Altro" });
  const foreign = f.app.store.createRoutine(other.id, { kind: "reminder", name: "PRIVATE OTHER", runAt: "2050-01-01T00:00:00Z", prompt: "Private", channelId: "web" });
  f.app.store.recordRoutineRun(foreign.id, "error", "PRIVATE OTHER");
  const history = await executeTool({ name: "routine_history", args: { query: "Richiamo", agentId: other.id } }, ctx);
  assert.equal(JSON.parse(history.text).total, 1);
  assert.ok(!history.text.includes("PRIVATE OTHER"));
  assert.equal(JSON.parse((await executeTool({ name: "routine_history", args: { archived: true } }, ctx)).text).items[0].archiveReason, "completed");
  assert.equal((await executeTool({ name: "set_reminder", args: { id: foreign.id, enabled: false } }, ctx)).text.startsWith("error:"), true);
});

test("archive API enforces auth and CSRF, validates exact dates, paginates and retains results after agent removal", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/routines/history", { auth: false })).status, 401);
  assert.equal((await f.request("/api/routines/archive", { auth: false })).status, 401);
  const path = `/api/agents/${f.agent.id}/routines`;
  const body = { kind: "reminder", name: "Bad", prompt: "Check", channelId: "web", runAt: "tomorrow" };
  assert.equal((await f.request(path, { method: "POST", body, csrf: false })).status, 403);
  for (const runAt of ["tomorrow", "2050-01-01T12:00", "2050-13-01T12:00:00Z", "2050-02-31T12:00:00Z", "2050-01-01T24:00:00Z"]) assert.equal((await f.request(path, { method: "POST", body: { ...body, runAt } })).status, 400);
  for (let index = 0; index < 3; index++) {
    const routine = await f.create({ kind: "routine", name: "Legacy " + index, schedule: "0 9 * * *" });
    await f.app.orchestrator.runRoutine(routine);
    await f.request(`/api/routines/${routine.id}`, { method: "DELETE" });
  }
  const page = (await f.request("/api/routines/history?kind=routine&limit=2&offset=1&query=Legacy")).data;
  assert.equal(page.total, 3); assert.equal(page.items.length, 2);
  f.app.store.deleteAgent(f.agent.id);
  assert.equal(f.app.store.routineHistory().total, 3);
  assert.equal(f.app.store.routineArchive().total, 3);
  assert.equal(f.app.store.routineArchive().items[0].agentName, "Rina");
});

test("restart resumes a persisted reminder from its evidence rather than firing a fresh occurrence", async (t) => {
  const home = tempHome(), seed = new Store(home);
  const agent = seed.createAgent({ name: "Ripresa", tools: false, model: "ollama/test-model" });
  seed.updateSettings({ defaultModel: "ollama/test-model", maxAgentTurns: 0 });
  const reminder = seed.createRoutine(agent.id, { kind: "reminder", name: "Già spedito", runAt: "2020-01-01T00:00:00Z", prompt: "Controlla la ricevuta, non spedire due volte.", channelId: `web-${agent.id}` });
  const run = seed.beginRoutineRun(reminder);
  const traces = new Traces({ store: seed });
  const trace = traces.start({ agentId: agent.id, kind: "reminder", channelId: reminder.channelId, model: agent.model, prompt: `[Attività programmata: ${reminder.id}]\nCompito:\nControlla la ricevuta.` });
  trace.add({ type: "tool", name: "say", args: { text: "Spedito" }, result: "RECEIPT_42 already sent", ok: true });
  seed.saveTrace(trace); seed.attachRoutineTrace(run.id, trace.id); seed.close();
  let resumed = false;
  const f = await fixture(t, { home, reply: (body) => { assert.match(body.messages[1].content, /Cora si è riavviata[\s\S]*RECEIPT_42 already sent/); resumed = true; return { content: "Ricevuta presente, nessuna nuova spedizione." }; } });
  await waitFor(() => f.app.store.routine(reminder.id, { archived: true }).archiveReason === "completed");
  assert.ok(resumed);
  assert.equal(f.app.store.routineHistory({ agentId: agent.id }).total, 1);
  assert.equal(f.app.store.routineHistory({ agentId: agent.id }).items[0].id, run.id);
});

test("concurrent manual requests share one attempt and rescheduling cannot archive or consume the new occurrence", async (t) => {
  const f = await fixture(t);
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  f.control.reply = async () => { entered.resolve(); await gate.promise; return { content: "Old invocation." }; };
  const reminder = await f.create();
  await Promise.all([1, 2].map(() => f.request(`/api/routines/${reminder.id}/run`, { method: "POST" })));
  await entered.promise;
  assert.equal(f.app.store.pendingRoutineRuns().length, 1);
  await f.request(`/api/routines/${reminder.id}`, { method: "PUT", body: { runAt: "2055-01-01T10:00:00Z" } });
  gate.resolve();
  await waitFor(() => !f.app.orchestrator.threadWork.has(reminder.channelId));
  assert.equal(f.app.store.routine(reminder.id).runAt, "2055-01-01T10:00:00.000Z");
  assert.equal(f.app.store.routine(reminder.id).lastStatus, null);
  assert.equal(f.app.store.routineArchive().total, 0);
  f.control.reply = () => ({ content: "New invocation verified." });
  assert.equal((await f.app.orchestrator.runRoutine(reminder, { manual: true })).status, "completed");
  assert.deepEqual(f.app.store.routineHistory().items.map((run) => run.status), ["completed", "stopped"]);
});

test("a stop written while offline prevents scheduler recovery of an interrupted reminder", async (t) => {
  const home = tempHome(), seed = new Store(home);
  const agent = seed.createAgent({ name: "Ripresa", tools: false, model: "ollama/test-model" });
  const reminder = seed.createRoutine(agent.id, { kind: "reminder", name: "Stop offline", runAt: "2020-01-01T00:00:00Z", prompt: "Check receipt.", channelId: `web-${agent.id}` });
  const run = seed.beginRoutineRun(reminder);
  const trace = new Traces({ store: seed }).start({ agentId: agent.id, kind: "reminder", channelId: reminder.channelId, prompt: `[Attività programmata: ${reminder.id}]` });
  seed.attachRoutineTrace(run.id, trace.id);
  seed.appendArchive(reminder.channelId, { id: "offline-stop", at: Date.now() + 10, authorName: "Owner", kind: "owner", content: "Ripresa, fermati" });
  seed.close();
  let calls = 0;
  const f = await fixture(t, { home, reply: () => { calls++; return { content: "Should never run." }; } });
  assert.equal(calls, 0);
  assert.equal(f.app.store.routine(reminder.id).enabled, false);
  assert.equal(f.app.store.routineHistory({ agentId: agent.id }).items[0].status, "stopped");
});

test("existing routine traces and last results migrate once without inventing a success verification", () => {
  const home = tempHome(), seed = new Store(home);
  const agent = seed.createAgent({ name: "Legacy" });
  const traced = seed.createRoutine(agent.id, { name: "Old trace", schedule: "0 9 * * *", channelId: "web", prompt: "Old task" });
  const fallback = seed.createRoutine(agent.id, { name: "Old last result", schedule: "0 9 * * *", channelId: "web", prompt: "Another old task" });
  Object.assign(fallback, { lastRunAt: "2026-01-01T00:00:00Z", lastStatus: "posted", lastOutput: "Saved last result." }); seed.writeRoutine(fallback);
  const trace = new Traces({ store: seed }).start({ agentId: agent.id, kind: "routine", channelId: "web", prompt: `È il momento della tua routine "${traced.name}".\n\nCompito:\nOld task\n\n` });
  trace.finish({ status: "done", output: "Saved trace result." }); seed.setValue("routineHistoryImported", false); seed.close();
  for (let reopen = 0; reopen < 2; reopen++) {
    const store = new Store(home);
    try { const history = store.routineHistory(); assert.equal(history.total, 2); assert.ok(history.items.every((run) => run.historical && run.verification === null)); assert.ok(history.items.some((run) => run.output === "Saved last result.")); }
    finally { store.close(); }
  }
});


test("archived results survive trace retention without exposing broken reasoning links", async (t) => {
  const f = await fixture(t);
  const reminder = await f.create();
  await f.app.orchestrator.runRoutine(reminder);
  const original = f.app.store.routineHistory().items[0];
  assert.equal(original.traceAvailable, true);
  assert.equal(original.verificationAvailable, true);
  f.app.store.stmt("DELETE FROM traces WHERE id = ? OR id = ?").run(original.traceId, original.verification.traceId);
  const history = (await f.request("/api/routines/history")).data.items[0];
  assert.equal(history.traceAvailable, false);
  assert.equal(history.verificationAvailable, false);
  assert.equal(history.output, original.output);
  assert.equal(history.verification.met, true);
});


test("an interrupted reminder on an inactive transport records one failure and requires an explicit retry", async (t) => {
  const home = tempHome(), seed = new Store(home);
  seed.updateSettings({ transport: "telegram" });
  const agent = seed.createAgent({ name: "Ripresa", tools: false, model: "ollama/test-model" });
  const reminder = seed.createRoutine(agent.id, { kind: "reminder", name: "Inactive transport", runAt: "2020-01-01T00:00:00Z", prompt: "Check receipt.", channelId: "123456789012345678" });
  const run = seed.beginRoutineRun(reminder);
  const trace = new Traces({ store: seed }).start({ agentId: agent.id, kind: "reminder", channelId: reminder.channelId, prompt: `[Attività programmata: ${reminder.id}]` });
  seed.attachRoutineTrace(run.id, trace.id); seed.close();
  const f = await fixture(t, { home });
  assert.equal(f.app.store.pendingRoutineRuns().length, 0);
  assert.equal(f.app.store.routine(reminder.id).lastStatus, "error");
  f.app.scheduler.tick(new Date("2050-01-01T12:01:00Z"));
  assert.equal(f.app.store.routineHistory({ agentId: agent.id }).total, 1);
});
