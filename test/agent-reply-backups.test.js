import assert from "node:assert/strict";
import { test } from "node:test";
import { accountUnavailable } from "../src/brain.js";
import { startCora } from "../src/main.js";
import { Store, replyChain } from "../src/store.js";
import { CHANNEL, OWNER, fakeDocker, fakeOllama, tempHome } from "./helpers.js";

test("an account that cannot answer is told apart from any other failure", () => {
  for (const message of ["subscription da collegare", "Claude: not logged in, collega la subscription", "ollama 500: out of credits", "429 rate limit", "You've hit your usage limit", "401 Unauthorized", "Insufficient Balance", "invalid api key"]) {
    assert.equal(accountUnavailable(new Error(message)), true, message);
  }
  assert.equal(accountUnavailable(Object.assign(new Error("quota"), { code: "GEMINI_QUOTA_EXHAUSTED" })), true);
  for (const message of ["boom", "subscription in aggiornamento, riprova", "ENOENT"]) assert.equal(accountUnavailable(new Error(message)), false, message);
  assert.equal(accountUnavailable(Object.assign(new Error("401"), { name: "AbortError" })), false, "a stopped turn never moves to a backup");
});

test("an agent whose own account cannot answer replies on the space's backups, never after it started working", async (t) => {
  const asked = [];
  let script = null;
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    if (!/^Sei Nico\./.test(system)) return { content: /^Giudichi/.test(system) ? JSON.stringify({ met: true, reason: "" }) : "NESSUNO" };
    asked.push(body.model);
    if (script) return script(body);
    if (body.model === "broken-model") throw new Error("out of credits");
    return { content: `Eccomi, rispondo con ${body.model}.` };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ ownerIds: [OWNER], brainBackups: [{ model: "ollama/broken-model" }], decisionBackups: [{ model: "ollama/test-model" }, { model: "ollama/broken-model" }] });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-reply-backups",
    discordToken: "", telegramToken: "", ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  const logged = [];
  const log = app.brain.log;
  app.brain.log = (entry) => { logged.push(entry); return log?.(entry); };
  t.after(async () => {
    await app.stop();
    await ollama.close();
  });

  const created = app.store.createAgent({ name: "Nico", model: "ollama/test-model" });
  const nico = { ...created, model: "codex/gpt-6-sol", subscriptionId: undefined };
  assert.deepEqual(replyChain(app.store.settings, nico).map((entry) => entry.model), ["codex/gpt-6-sol", "ollama/broken-model", "ollama/test-model"],
    "its own model first, then the brain's and the decision maker's backups, each once");

  const said = [];
  const turn = (agent) => app.brain.chatTurn({
    agent, forced: true, computer: false, channel: { id: CHANNEL, name: "general" },
    history: [{ id: "m1", kind: "owner", authorId: OWNER, authorName: "Seb", content: "@Nico ci sei?", at: Date.now(), addressed: [agent.id] }],
    say: async (text) => { said.push(text); return { ok: true, text: "posted" }; }, inbox: () => [], postFile: async () => ({}), onMessageHandled: () => {},
  });

  const reply = await turn(nico);
  assert.match(reply.text, /Eccomi, rispondo con test-model/, "the disconnected account no longer leaves the agent mute");
  assert.deepEqual(asked, ["broken-model", "test-model"]);
  const warning = logged.find((entry) => entry.type === "warning" && /modello di riserva/.test(entry.text));
  assert.match(warning.text, /Nico ha risposto con il modello di riserva ollama\/test-model: codex\/gpt-6-sol: subscription da collegare · ollama\/broken-model: .*out of credits/);

  // Once a tool ran, a later account failure ends the turn: nothing is done twice on a backup.
  asked.length = 0;
  let step = 0;
  script = (body) => {
    step += 1;
    if (step === 1) return { content: "", tool_calls: [{ function: { name: "say", arguments: { text: "Ci guardo" } } }] };
    throw new Error("401 Unauthorized");
  };
  await assert.rejects(turn({ ...created, model: "ollama/test-model" }), /401 Unauthorized/);
  assert.deepEqual(said, ["Ci guardo"]);
  assert.deepEqual(asked, ["test-model", "test-model"], "no backup after the agent already spoke");

  // Any other failure is not an account problem: it surfaces as before.
  asked.length = 0;
  script = () => { throw new Error("boom"); };
  await assert.rejects(turn({ ...created, model: "ollama/test-model" }), /boom/);
  assert.deepEqual(asked, ["test-model"]);
});
