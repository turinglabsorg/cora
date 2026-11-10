import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { Store, brainChain } from "../src/store.js";
import { fakeDocker, fakeOllama, tempHome, waitFor } from "./helpers.js";

const LIBRARIAN = /^Sei il bibliotecario del brain aziendale/;
const SLEEP = /^Sei un sistema di consolidamento della memoria/;

test("the librarian's backups keep the brain and the agents' sleep going when the first model cannot answer", async (t) => {
  const asked = [];
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    asked.push([body.model, LIBRARIAN.test(system) ? "librarian" : SLEEP.test(system) ? "sleep" : "other"]);
    if (body.model === "broken-model") throw new Error("out of credits");
    if (LIBRARIAN.test(system)) return { content: JSON.stringify({ pages: [] }) };
    if (SLEEP.test(system)) return { content: JSON.stringify({ core: "", add: [], update: [], remove: [], diary: "Ho dormito con la riserva." }) };
    return { content: "PASS" };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ brainModel: "claude/claude-opus-5-5", brainBackups: [{ model: "ollama/broken-model" }, { model: "ollama/test-model" }, { model: "ollama/test-model" }, { model: "" }] });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-librarian-backups",
    discordToken: "", telegramToken: "", ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    brainDatabaseUrl: "pglite:memory", brainEmbedUrl: ollama.url,
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  await app.companyBrain.ready;
  app.librarian.requestRun = () => false;
  const notices = [];
  const messages = [];
  app.librarian.notify = async (notice) => { notices.push(notice); };
  app.librarian.messageOwner = async (text) => { messages.push(text); return true; };
  t.after(async () => {
    await app.stop();
    await ollama.close();
  });

  // Doubles and entries without a model are dropped when saved; at most three backups.
  assert.deepEqual(app.store.settings.brainBackups.map((entry) => entry.model), ["ollama/broken-model", "ollama/test-model"]);
  assert.deepEqual(brainChain(app.store.settings).map((entry) => entry.model), ["claude/claude-opus-5-5", "ollama/broken-model", "ollama/test-model"]);
  assert.throws(() => app.store.updateSettings({ brainBackups: [{ model: "nonsense" }] }), /modello non valido/);

  await app.companyBrain.note({ text: "Acme paga a 60 giorni.", author: "Ada" });
  const run = await app.librarian.run();
  assert.equal(run.status, "done", "the night is not lost when the first model is disconnected");
  assert.equal(run.model, "ollama/test-model", "the run says which model did the work");
  assert.deepEqual(asked.filter(([, kind]) => kind === "librarian").map(([model]) => model), ["broken-model", "test-model"]);
  const librarianTraces = app.store.traces("librarian").map((trace) => [trace.model, trace.status]);
  assert.ok(librarianTraces.some(([model, status]) => model === "claude/claude-opus-5-5" && status === "error"), "the failure stays visible in the traces");
  assert.equal(notices.length, 1);
  assert.match(messages[0], /modello di riserva ollama\/test-model/);
  assert.match(messages[0], /claude\/claude-opus-5-5 non ha risposto \(subscription da collegare\)/);

  // The owner hears about it once a day, not on every run.
  await app.companyBrain.note({ text: "Le riunioni sono il martedì.", author: "Ada" });
  assert.equal((await app.librarian.run()).status, "done");
  assert.equal(messages.length, 1);

  // When no model answers the run fails, says why, and the owner hears that too.
  app.store.updateSettings({ brainBackups: [{ model: "ollama/broken-model" }] });
  await app.companyBrain.note({ text: "Giulia è la referente.", author: "Ada" });
  const down = await app.librarian.run();
  assert.equal(down.status, "partial");
  assert.match(down.errors[0], /Nessun modello del bibliotecario ha risposto/);
  assert.equal(messages.length, 2);
  assert.match(messages[1], /Nessun modello del bibliotecario ha risposto/);
  assert.equal((await app.companyBrain.notes()).length, 1, "the note waits for the next run");

  // An agent whose own model cannot answer still sleeps, on the space's backups.
  app.store.updateSettings({ brainBackups: [{ model: "ollama/broken-model" }, { model: "ollama/test-model" }] });
  const agent = app.store.createAgent({ name: "Ada", model: "ollama/test-model" });
  const sleeper = { ...agent, model: "claude/claude-opus-5-5" };
  const slept = await app.brain.sleep(sleeper, { force: true });
  assert.equal(slept.status, "done");
  assert.equal(slept.diary, true);
  assert.deepEqual(asked.filter(([, kind]) => kind === "sleep").map(([model]) => model), ["broken-model", "test-model"]);
  await waitFor(() => app.store.diary(agent.id).length === 1, { what: "the diary page" });
});
