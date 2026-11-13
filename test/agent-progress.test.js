import { test } from "node:test";
import assert from "node:assert/strict";
import { assessProgress, progressWindows } from "../src/agent-progress.js";

const agent = { id: "worker", name: "Worker" };
const settings = { decisionModel: "ollama/judge", decisionBackups: [{ model: "ollama/backup", subscriptionId: "sub_backup", credentialId: "" }], language: "en" };
const windows = [{ id: "before", steps: [{ type: "tool", name: "shell", result: "1 failing test" }] }, { id: "after", steps: [{ type: "tool", name: "shell", result: "0 failing tests" }] }];
function fixture(handler) {
  const calls = [];
  return { calls, isAgentic: (model) => model.startsWith("codex/"), chat: async (args) => { calls.push(args); return { text: JSON.stringify(await handler(args)), usage: { input: 3, output: 2 } }; }, runAgent: async (args) => { calls.push(args); return { text: JSON.stringify(await handler(args)) }; } };
}
const check = (llm, extra = {}) => assessProgress({ llm, settings, agent, channelId: "only-this-thread", request: "Fix and verify the requested behavior", windows, ...extra });

test("a productive verdict continues without limiting turn count and receives tool outcomes", async () => {
  const llm = fixture((args) => { const data = JSON.parse(args.messages[1].content); assert.equal(data.channelId, "only-this-thread"); assert.equal(data.agent.id, agent.id); assert.match(JSON.stringify(data.windows), /0 failing tests/); assert.deepEqual(args.tools, []); return { loop: false, reason: "Tests improved.", evidence: [] }; });
  const verdict = await check(llm);
  assert.equal(verdict.available, true); assert.equal(verdict.loop, false); assert.equal(llm.calls.length, 1);
});

test("a loop requires two distinct supplied windows and a specific reason", async () => {
  for (const evidence of [["before", "before"], ["invented", "after"], []]) {
    const llm = fixture(() => ({ loop: true, reason: "No change.", evidence }));
    const verdict = await check(llm);
    assert.equal(verdict.available, false); assert.equal(verdict.loop, false);
  }
  const llm = fixture(() => ({ loop: true, reason: "The same unchanged input was resubmitted.", evidence: ["before", "after"] }));
  const verdict = await check(llm); assert.equal(verdict.loop, true); assert.deepEqual(verdict.evidence, ["before", "after"]);
});

test("invalid primary output uses only the configured reserve and its account", async () => {
  const llm = fixture((args) => args.model === settings.decisionModel ? { malformed: true } : { loop: false, reason: "A correction was verified.", evidence: [] });
  assert.equal((await check(llm)).available, true); assert.deepEqual(llm.calls.map((item) => item.model), ["ollama/judge", "ollama/backup"]); assert.equal(llm.calls[1].subscriptionId, "sub_backup");
});

test("judge failure is distinguished from a confirmed loop and aborts remain authoritative", async () => {
  const llm = fixture(() => { throw new Error("unavailable"); });
  const verdict = await check(llm); assert.equal(verdict.available, false); assert.equal(verdict.loop, false);
  const controller = new AbortController(); controller.abort(); await assert.rejects(check(llm, { signal: controller.signal }), { name: "AbortError" });
});

test("subscription judges run with no tools and the selected account", async () => {
  const llm = fixture((args) => { assert.deepEqual(args.tools, []); assert.equal(args.execute, null); assert.equal(args.subscriptionId, "sub_judge"); return { loop: false, reason: "Work advances.", evidence: [] }; });
  const verdict = await check(llm, { settings: { ...settings, decisionModel: "codex/judge", decisionSubscriptionId: "sub_judge" } });
  assert.equal(verdict.available, true); assert.equal(llm.calls.length, 1);
});

test("insufficient history does not manufacture a loop verdict", async () => {
  const llm = fixture(() => { throw new Error("must not call"); });
  assert.equal((await check(llm, { windows: windows.slice(0, 1) })).loop, false); assert.equal(llm.calls.length, 0);
});

test("evidence windows exclude reasoning, bound payloads and retain actual results", () => {
  const result = progressWindows([{ id: "trace", goal: "g".repeat(2000), output: "x".repeat(2000), steps: [{ type: "thinking", text: "private reasoning" }, ...Array.from({ length: 30 }, (_, i) => ({ type: "tool", name: "shell", args: { command: `stage ${i}` }, result: `Verified stage ${i}` }))] }]);
  assert.equal(result[0].steps.length, 12); assert.equal(result[0].goal.length, 1600); assert.equal(result[0].result.length, 1600); assert.doesNotMatch(JSON.stringify(result), /private reasoning/); assert.match(JSON.stringify(result), /Verified stage 29/);
});


test("a timed-out primary leaves a full independent attempt for its backup", async () => {
  const calls = [], attempts = [];
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const llm = { isAgentic: () => false, async chat(args) {
      calls.push(args);
      if (args.model === settings.decisionModel) return new Promise((_, reject) => args.signal.addEventListener("abort", () => reject(args.signal.reason), { once: true }));
      assert.equal(args.signal.aborted, false);
      return { text: '{"loop":false,"reason":"New results.","evidence":[]}' };
    } };
    const verdict = await check(llm, { timeoutMs: 15, onAttempt: (attempt) => attempts.push(attempt) });
    assert.equal(verdict.available, true);
    assert.deepEqual(calls.map((item) => item.model), ["ollama/judge", "ollama/backup"]);
    assert.deepEqual(attempts.map((item) => item.status), ["timeout", "accepted"]);
    assert.deepEqual(verdict.attempts, attempts);
  } finally { clearInterval(keepAlive); }
});

test("invalid verdicts and failures have bounded diagnostics without raw provider output", async () => {
  const marker = "private-provider-content";
  const llm = fixture(({ model }) => { if (model === settings.decisionModel) return { loop: true, reason: marker, evidence: ["invented"] }; throw new Error("429 " + marker); });
  const verdict = await check(llm);
  assert.equal(verdict.available, false);
  assert.deepEqual(verdict.attempts.map((item) => item.status), ["invalid_evidence", "rate_limit"]);
  assert.doesNotMatch(JSON.stringify(verdict), new RegExp(marker));
});

test("owner cancellation during a decision does not start a fallback", async () => {
  const controller = new AbortController();
  const llm = fixture(() => { controller.abort(); throw controller.signal.reason; });
  await assert.rejects(check(llm, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(llm.calls.length, 1);
});


test("non-JSON replies are recorded as invalid verdicts before trying the backup", async () => {
  let calls = 0;
  const llm = { isAgentic: () => false, chat: async () => ({ text: ++calls === 1 ? "I cannot answer as JSON." : '{"loop":false,"reason":"Work advanced.","evidence":[]}' }) };
  const verdict = await check(llm);
  assert.equal(verdict.available, true);
  assert.deepEqual(verdict.attempts.map((item) => item.status), ["invalid_verdict", "accepted"]);
});
