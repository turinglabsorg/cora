import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain } from "../src/brain.js";
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

function contextFixture(here, other) {
  const agent = { id: "nico", name: "Nico" };
  const brain = Object.create(Brain.prototype);
  brain.timezone = "Europe/Rome";
  brain.channels = { info: (id) => [here, other].find((item) => item.id === id), list: () => [here, other] };
  brain.channelIdsFor = () => [here.id, other.id];
  brain.channelLabel = (id) => brain.channels.info(id).name;
  brain.store = { recentElsewhere: () => [{ channelId: other.id, messages: [{ kind: "agent", agentId: agent.id, authorName: "Nico", at: Date.now(), content: "FOREIGN_WORK: continuo la ricerca segreti" }] }] };
  return { brain, agent };
}

test("thread boundaries use identity, not issue codes, titles or transport", () => {
  for (const [here, other] of [
    [{ id: "handover", name: "Refracto autogestito", parentId: "lab" }, { id: "secrets", name: "Ricerca segreti", thread: true }],
    [{ id: "handover", name: "REF-23 handover", thread: true }, { id: "secrets", name: "REF-23 secondo thread", thread: true }],
    [{ id: "sl:C12345:1760000000.123456", name: "lab", parentId: "sl:C12345", kind: "slack" }, { id: "secrets", name: "Ricerca segreti" }],
    [{ id: "general", name: "lab" }, { id: "sl:C12345:1760000000.123456", name: "lab", parentId: "sl:C12345", kind: "slack" }],
  ]) {
    const { brain, agent } = contextFixture(here, other);
    assert.doesNotMatch(brain.elsewhere(agent, here.id, brain.threadMap(agent, here.id)), /FOREIGN_WORK/);
  }
});

test("a resumed thread drops legacy elsewhere transcripts but keeps its own request and steps", async () => {
  const here = { id: "handover", name: "Refracto autogestito", parentId: "lab" };
  const { brain, agent } = contextFixture(here, { id: "secrets", name: "Ricerca segreti", parentId: "lab" });
  let input;
  brain.loop = async (args) => { input = args; return { text: "ok" }; };
  await brain.resumeTurn({ agent, channel: here, trace: { kind: "chat", startedAt: new Date().toISOString(), prompt: '<altrove dove="Ricerca segreti">FOREIGN_WORK: sidebar</altrove>\n<chat>\nSeb ★: verifica Refracto CURRENT_WORK\n</chat>', steps: [{ type: "text", text: "CURRENT_STEP" }] } });
  assert.doesNotMatch(input.user, /FOREIGN_WORK/);
  assert.match(input.user, /CURRENT_WORK/);
  assert.match(input.user, /CURRENT_STEP/);
  assert.match(input.user, /Tema di questo thread: «Refracto autogestito»/);
  assert.ok(input.topics, "resumed tools keep the same thread boundary as a fresh turn");
});

test("archived thread metadata still isolates context when the live channel cache misses", () => {
  const here = { id: "handover", name: "handover" };
  const other = { id: "secrets", name: "secrets" };
  const { brain, agent } = contextFixture(here, other);
  brain.store.value = () => ({ handover: { name: "Refracto autogestito", parentId: "lab", thread: true } });
  assert.equal(brain.threadMap(agent, here.id).current.name, "Refracto autogestito");
  assert.doesNotMatch(brain.elsewhere(agent, here.id, brain.threadMap(agent, here.id)), /FOREIGN_WORK/);
  brain.store.value = () => ({ secrets: { name: "Ricerca segreti", parentId: "lab", thread: true } });
  assert.doesNotMatch(brain.elsewhere(agent, here.id, brain.threadMap(agent, here.id)), /FOREIGN_WORK/);
});
