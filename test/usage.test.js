import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { fakeCli, waitFor } from "./helpers.js";
import { deepSeekUsage } from "../src/usage.js";

test("DeepSeek pricing uses disjoint cache buckets, authoritative totals and bounded time tariffs", () => {
  const offpeak = { startedAt: Date.parse("2026-11-09T20:00:00Z"), endedAt: Date.parse("2026-11-09T20:01:00Z") };
  const tokens = { inputTokens: 1000000, cacheReadTokens: 9000000, outputTokens: 1000000, totalTokens: 11000000 };
  const usage = deepSeekUsage("deepseek-flash", tokens, offpeak);
  assert.equal(usage.in, 10000000);
  assert.equal(usage.meter.costs[0].amount, 0.777);
  assert.equal(usage.meter.costs[0].maxAmount, 0.777);
  const peak = deepSeekUsage("deepseek-flash", tokens, { startedAt: Date.parse("2026-11-09T06:10:00Z"), endedAt: Date.parse("2026-11-09T06:11:00Z") });
  assert.equal(peak.meter.costs[0].maxAmount, 1.554, "a possible Chinese holiday does not become a false exact peak charge");
  const weekend = deepSeekUsage("deepseek-v4-pro", tokens, { startedAt: Date.parse("2026-11-14T06:10:00Z"), endedAt: Date.parse("2026-11-14T06:11:00Z") });
  assert.equal(weekend.meter.costs[0].amount, 2.838);
  assert.equal(weekend.meter.costs[0].maxAmount, 2.838);
  assert.equal(deepSeekUsage("deepseek-flash", { inputTokens: 100, outputTokens: 5 }, offpeak).meter.unpriced, 1);
  assert.equal(deepSeekUsage("unknown", tokens, offpeak).meter.costs.length, 0);
  assert.equal(deepSeekUsage("deepseek-flash", null, offpeak).meter.modelSteps, 1);
});

test("live DeepSeek usage is durable before completion, survives failure and cancellation, and remains owner scoped", async (t) => {
  const cli = fakeCli();
  const f = await knowledgeWorld({ deepseekBin: cli.dsh, deepseekKey: "fixture-deepseek", subscriptionUsageIntervalMs: 0 });
  t.after(() => f.close());
  const agent = f.app.store.createAgent({ name: "Metered", brainOwnerId: f.alice.user.id, model: "deepseek/deepseek-flash", enabled: false });
  const run = async (failure, cancel = false) => {
    cli.set({ reply: "Done", dshUsages: [{ inputTokens: 100, cacheReadTokens: 900, outputTokens: 10, totalTokens: 1010 }, null], dshPauseMs: 400, dshError: failure });
    const trace = f.app.traces.start({ agentId: agent.id, kind: "chat", model: agent.model, channelId: `web-${agent.id}` });
    trace.goal = "One goal";
    const controller = new AbortController();
    const pending = f.app.llm.runAgent({ model: agent.model, system: "fixture", prompt: "test", tools: [], execute: () => {}, timeoutMs: 10000, signal: controller.signal,
      onUsage: (usage) => trace.spent(usage) }).then(result => { trace.finish({ status: "done", output: result.text }); return result; }, error => { trace.finish({ status: cancel ? "stopped" : "error", error: error.message }); return null; });
    await waitFor(() => f.app.store.trace(trace.id)?.meter?.modelSteps === 2);
    const stored = f.app.store.trace(trace.id);
    assert.equal(stored.status, "running");
    assert.equal(stored.tokensIn, 1000);
    assert.equal(stored.meter.unpriced, 1);
    assert.ok(stored.meter.costs[0].amount > 0);
    assert.equal((await f.request(f.alice, `/api/traces/${trace.id}`)).data.meter.modelSteps, 2);
    assert.equal((await f.request(f.bob, `/api/traces/${trace.id}`)).status, 403);
    if (cancel) controller.abort();
    await pending;
    assert.equal(f.app.store.trace(trace.id).meter.modelSteps, 2);
    return trace;
  };
  const first = await run(true);
  assert.equal(f.app.store.trace(first.id).status, "error");
  const second = await run(false, true);
  assert.equal(f.app.store.trace(second.id).status, "stopped");
  const goals = (await f.request(f.alice, `/api/agents/${agent.id}/goals`)).data.goals;
  assert.equal(goals[0].turns, 2);
  assert.equal(goals[0].meter.modelSteps, 4);
  assert.equal(goals[0].meter.unpriced, 2);
  assert.equal(goals[0].tokensIn, 2000);
  assert.equal((await f.request(f.bob, `/api/agents/${agent.id}/goals`)).status, 403);
  f.app.store.db.prepare("UPDATE traces SET meter = NULL WHERE id = ?").run(first.id);
  const historical = (await f.request(f.alice, `/api/traces/${first.id}`)).data;
  assert.equal(historical.meter, null, "missing historical prices and internal counts are never backfilled as zero");
  assert.equal(f.app.store.goalUsage(agent.id)[0].meter.unpriced, 2);
  assert.equal(f.app.store.goalUsage(agent.id)[0].meter.unknownModelSteps, 1, "partly known internal-step totals remain a lower bound");
});

test("OrcaRouter costs come from the provider receipt, with bounded settling retries and unavailable-cost recovery", async (t) => {
  let receiptCalls = 0, mode = "settling";
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/generation")) {
      receiptCalls += 1;
      if (mode === "unavailable") { res.writeHead(501); res.end("{}"); }
      else if (receiptCalls === 1) { res.writeHead(404); res.end("{}"); }
      else res.end(JSON.stringify({ data: { total_cost: 0.0123 } }));
    } else if (req.url === "/models") res.end(JSON.stringify({ data: [{ id: "fixture" }] }));
    else { res.setHeader("X-Orca-Request-Id", "fixture-receipt"); res.end(JSON.stringify({ choices: [{ message: { content: "Done" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const f = await knowledgeWorld({ orcaUrl: `http://127.0.0.1:${server.address().port}`, orcaKey: "fixture-orca", subscriptionUsageIntervalMs: 0 });
  t.after(async () => { await f.close(); await new Promise(resolve => server.close(resolve)); });
  const result = await f.app.llm.chat({ model: "orcarouter/fixture", messages: [{ role: "user", content: "test" }] });
  assert.equal(result.usage.meter.costs[0].amount, 0.0123);
  assert.equal(result.usage.meter.costs[0].estimated, false);
  assert.equal(receiptCalls, 2);
  mode = "unavailable";
  const missing = await f.app.llm.chat({ model: "orcarouter/fixture", messages: [{ role: "user", content: "test" }] });
  assert.equal(missing.text, "Done");
  assert.equal(missing.usage.meter.unpriced, 1);
  assert.equal(receiptCalls, 3, "a disabled receipt endpoint is not retried");
});
