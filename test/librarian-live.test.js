import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
import { fakeDocker, fakeOllama, tempHome, waitFor } from "./helpers.js";

const LIBRARIAN = /^Sei il bibliotecario del brain aziendale/;

test("the panel follows the librarian live: what it does, the model it asks, its reasoning and the pages it writes, then keeps the last run's log", async (t) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let asked = 0;
  const ollama = await fakeOllama(async (body) => {
    if (!LIBRARIAN.test(String(body.messages[0]?.content || ""))) return { content: "PASS" };
    asked += 1;
    await held;
    return { content: JSON.stringify({ reasoning: "Una nota nuova su Acme: la scrivo nella sua pagina.", pages: [{ slug: "acme", kind: "client", title: "Acme", summary: "Cliente.", body: "- paga a 60 giorni", note: "termini di pagamento", sources: ["n1"] }, { slug: "vuota", kind: "topic", title: "Senza fonti", summary: "", body: "x", sources: [] }] }) };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ brainModel: "ollama/test-model" });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-librarian-live",
    discordToken: "", telegramToken: "", ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    brainDatabaseUrl: "pglite:memory", brainEmbedUrl: ollama.url,
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  await app.companyBrain.ready;
  app.librarian.requestRun = () => false;
  t.after(async () => {
    release();
    await app.stop();
    await ollama.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET" } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" } });
    return { status: response.status, data: await response.json() };
  };

  const idle = (await call("/api/brain")).data;
  assert.deepEqual([idle.running, idle.progress], [false, null], "nothing runs before the owner asks");

  await app.companyBrain.note({ text: "Acme paga a 60 giorni.", author: "Ada" });
  const before = Date.now();
  assert.deepEqual((await call("/api/brain/run", { method: "POST" })).data, { started: true, running: true });
  await waitFor(() => asked === 1, { what: "the librarian asks its model" });
  const busy = (await call("/api/brain")).data;
  assert.equal(busy.running, true);
  assert.deepEqual([busy.progress.batch, busy.progress.batches], [1, 1]);
  assert.ok(Date.parse(busy.progress.startedAt) >= before - 1000, "the start time is the run's");
  assert.deepEqual((await call("/api/brain/run", { method: "POST" })).data, { started: false, running: true }, "a second press does not start a second run");
  const watching = (await call("/api/brain/live")).data;
  assert.equal(watching.running, true);
  assert.deepEqual(watching.progress.events.map((event) => event.kind), ["read", "ask"]);
  assert.match(watching.progress.events[1].text, /Chiede a ollama\/test-model/);
  assert.equal(watching.progress.model, "ollama/test-model");
  assert.equal(watching.trace.id, watching.progress.traceId, "the live view follows the model call under way");
  assert.equal(watching.trace.status, "running");

  release();
  await waitFor(async () => !(await call("/api/brain")).data.running, { what: "the run ends" });
  const done = (await call("/api/brain")).data;
  assert.equal(done.progress, null);
  assert.equal(done.lastRun.errors.length, 0);
  assert.deepEqual(done.lastRun.log.map((event) => event.kind), ["read", "ask", "reasoning", "page", "skip", "done"]);
  assert.match(done.lastRun.log[2].text, /Una nota nuova su Acme/);
  assert.match(done.lastRun.log[4].text, /Scarta «Senza fonti»: nessuna fonte citata/);
  assert.equal(done.lastRun.log[3].slug, "acme");
  assert.match(done.lastRun.log[3].text, /^Crea «Acme»: termini di pagamento/);
  assert.match(done.lastRun.log[5].text, /1 pagina nuova, 0 aggiornate, 1 scartata/);
  const trace = (await call(`/api/traces/${done.lastRun.traceIds[0]}`));
  assert.equal(trace.status, 200, "the owner opens the reasoning of the last run's model call");
  assert.equal((await call("/api/brain/live")).data.progress, null);
  assert.equal(asked, 1);
});
