import { test } from "node:test";
import assert from "node:assert/strict";
import { issueKeys, threadLeak, threadTopics } from "../src/thread-topics.js";

const G = "1521874685690642564";
const channels = [
  { id: "1", name: "lab", guildId: G, thread: false },
  { id: "1569622836681904228", name: "REF-23 handover", guildId: G, thread: true, parentId: "1" },
  { id: "1569410375882121336", name: "REF-62 — razionalizzazione pagine Admin", guildId: G, thread: true, parentId: "1" },
  { id: "5", name: "ACD-73 pipeline", guildId: G, thread: true, parentId: "1" },
  { id: "6", name: "REF-62 altrove", guildId: "other", thread: true, parentId: "9" },
];
const at = (id) => threadTopics(channels, channels.find((item) => item.id === id));

test("issue keys: real keys only, once each", () => {
  assert.deepEqual(issueKeys("REF-62, REF-66 e ACD-73; ancora REF-62"), ["REF-62", "REF-66", "ACD-73"]);
  assert.deepEqual(issueKeys("UTF-8, ISO-8601, SHA-256, GPT-4, COVID-19, PR-12, ref-62, XREF-62a"), []);
});

test("a thread's topic comes from its name; the same server's other threads own their issues", () => {
  const handover = at("1569622836681904228");
  assert.deepEqual(handover.topic, ["REF-23"]);
  assert.deepEqual([...handover.others.keys()], ["REF-62", "ACD-73"], "another server's thread is not a place for this one");
  assert.deepEqual(at("1").topic, [], "a channel is not a thread: no topic");
});

test("another thread's work is a leak; this thread's issue, a question asked here and a short pointer are not", () => {
  const handover = at("1569622836681904228");
  assert.equal(threadLeak("Briefings chiusa su REF-62, ora Source Health.", handover).key, "REF-62");
  assert.equal(threadLeak("REF-23: REF-25 chiusa, REF-62 lo seguo di là", handover), null);
  assert.equal(threadLeak("REF-62 è In Progress.", { ...handover, asked: ["REF-62"] }), null);
  assert.equal(threadLeak("REF-62 la seguo qui: https://discord.com/channels/1521874685690642564/1569410375882121336", handover), null);
  assert.equal(threadLeak("REF-99 non ha un thread", handover), null);
  assert.equal(threadLeak("Briefings chiusa su REF-62", at("1")), null, "a channel without a topic is never refused");
});
