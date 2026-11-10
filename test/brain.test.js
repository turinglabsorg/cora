import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Artifacts } from "../src/artifacts.js";
import { CompanyBrain } from "../src/company-brain.js";
import { startCora } from "../src/main.js";
import { SHARED, Store } from "../src/store.js";
import { executeTool } from "../src/tools.js";
import { CHANNEL, GUILD, MAIN_TOKEN, OWNER, fakeDiscord, fakeDocker, fakeOllama, tempHome, waitFor } from "./helpers.js";

const LIBRARIAN = /^Sei il bibliotecario del brain aziendale/;

test("the librarian turns the chats into the company brain, the agents read it, and the owner reviews it in the morning", async (t) => {
  const discord = await fakeDiscord();
  const librarianPrompts = [];
  const agentTurns = [];
  let librarianAnswer = () => ({ pages: [] });
  let adaStep = 0;
  let adaScript = null;
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    const user = String(body.messages.filter((message) => message.role === "user").at(-1)?.content || "");
    if (LIBRARIAN.test(system)) {
      librarianPrompts.push(user);
      return { content: JSON.stringify(librarianAnswer(user)) };
    }
    if (/^Scrivi la condizione di completamento/.test(system)) return { content: "NESSUNO" };
    if (/^Giudichi se un compito è finito/.test(system)) return { content: JSON.stringify({ met: true, reason: "" }) };
    if (/^Valuti l'intenzione/.test(system)) return { content: JSON.stringify({ intent: "update" }) };
    if (/^Sei Ada\./.test(system)) {
      agentTurns.push({ system, user, messages: body.messages, tools: (body.tools || []).map((tool) => tool.function?.name || tool.name) });
      return adaScript ? adaScript(body, ++adaStep) : { content: "PASS" };
    }
    return { content: "PASS" };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD], ownerIds: [OWNER], brainModel: "ollama/test-model" });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-brain",
    discordToken: MAIN_TOKEN, discordApi: discord.url, ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "https://usecora.test", cloudKey: "", cloudSpace: "acme",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    brainDatabaseUrl: "pglite:memory", brainEmbedUrl: ollama.url,
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  await app.companyBrain.ready;
  app.librarian.requestRun = () => false;
  t.after(async () => {
    await app.stop();
    await Promise.all([discord.close(), ollama.close()]);
  });
  await waitFor(() => app.discord.state === "ready", { what: "gateway ready" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };

  // What was said: a decision worth keeping, and chatter that is not.
  const decision = discord.say({ content: "Abbiamo deciso con Giulia: Acme paga a 60 giorni, e Giulia Ferri è la loro referente." });
  discord.say({ content: "ciao a tutti, buon lunedì" });
  await waitFor(() => app.store.hasMessage(decision.id), { what: "the decision archived" });

  // The librarian's model writes a page with its source, and one fact it cannot trace, which is dropped.
  librarianAnswer = (prompt) => {
    const ref = /\[(m\d+)\][^\n]*Acme paga a 60 giorni/.exec(prompt)[1];
    return { pages: [
      { slug: "acme", kind: "client", title: "Acme", summary: "Cliente: paga a 60 giorni.", body: "- Pagamento a 60 giorni, deciso con Giulia.\n- Referente: [[giulia-ferri]] (Giulia Ferri).", note: "pagamento a 60 giorni e referente", sources: [ref] },
      { slug: "invented", kind: "topic", title: "Inventata", summary: "nessuna fonte", body: "un fatto che nessuno ha detto", sources: ["m999"] },
    ] };
  };
  const run = await app.librarian.run();
  assert.equal(run.status, "done");
  assert.deepEqual([run.created, run.updated, run.skipped], [1, 0, 1], "a fact with no source it can be traced to is not written");
  assert.match(librarianPrompts[0], /## Conversazioni nuove\n\[m1\]/);
  assert.match(librarianPrompts[0], /Sam ★: Abbiamo deciso con Giulia/);
  const brain = (await call("/api/brain")).data;
  assert.deepEqual([brain.enabled, brain.stats.pages, brain.stats.pending, brain.canManage], [true, 1, 1, true]);
  assert.ok(brain.stats.chunks >= 2, "the chats are searchable too");
  const acme = (await call("/api/brain/pages/acme")).data;
  assert.equal(acme.kind, "client");
  assert.equal(acme.revisions[0].author, "librarian");
  assert.equal(acme.revisions[0].review, "pending");
  assert.equal(acme.revisions[0].sources[0].id, decision.id);
  assert.match(acme.revisions[0].sources[0].quote, /Acme paga a 60 giorni/);
  assert.equal((await call("/api/brain/pages/invented")).status, 404);

  // An agent finds the page in its turn, reads it whole, and tells the librarian something new.
  await call("/api/agents", { method: "POST", body: { name: "Ada", model: "ollama/test-model", chattiness: 0, tools: false } });
  adaScript = (body, step) => {
    if (step === 1) return { tool_calls: [{ function: { name: "brain_page", arguments: { slug: "acme" } } }] };
    if (step === 2) return { tool_calls: [{ function: { name: "brain_note", arguments: { text: "Giulia Ferri di Acme è in ferie tutto agosto." } } }] };
    return { content: "Acme paga a 60 giorni; la referente è Giulia Ferri." };
  };
  discord.say({ content: "@Ada, quanto ci mette Acme a pagare?" });
  await waitFor(() => discord.state.webhookPosts.some((post) => post.username === "Ada" && /60 giorni/.test(post.content)), { what: "Ada's answer" });
  const first = agentTurns[0];
  assert.match(first.user, /Dal brain aziendale \(con brain_page leggi una pagina intera\):\n- \[acme\] Acme \(cliente\): Cliente: paga a 60 giorni\. — da rivedere/);
  assert.match(first.system, /## Il brain aziendale\n/);
  for (const name of ["brain_search", "brain_page", "brain_note"]) assert.ok(first.tools.includes(name), `${name} is offered where there is a brain`);
  const toolResults = agentTurns.at(-1).messages.filter((message) => message.role === "tool").map((message) => String(message.content));
  assert.ok(toolResults.some((text) => text.includes("Referente: [[giulia-ferri]]") && text.includes("\"reviewed\":false")), "brain_page gives the whole page and says it is not reviewed yet");
  assert.ok(toolResults.some((text) => /noted for the librarian/.test(text)));
  assert.equal((await app.companyBrain.notes())[0].author, "Ada");

  // The next run reads the note with its author.
  librarianAnswer = (prompt) => ({ pages: [{ slug: "giulia-ferri", kind: "person", title: "Giulia Ferri", summary: "Referente di Acme.", body: "- Referente di [[acme]].\n- In ferie tutto agosto.", note: "nuova persona", sources: [/\[(n\d+)\] Ada:/.exec(prompt)[1]] }] });
  const second = await app.librarian.run();
  assert.equal(second.created, 1);
  assert.match(librarianPrompts.at(-1), /## Note degli agenti e ricordi condivisi\n\[n1\] Ada: Giulia Ferri di Acme è in ferie tutto agosto\./);
  assert.deepEqual(await app.companyBrain.notes(), [], "a note is read once");
  assert.equal((await call("/api/brain/pages/giulia-ferri")).data.revisions[0].sources[0].type, "note");

  // The map: the pages, linked by their [[slug]]s, and by a title named without the link.
  assert.equal((await call("/api/brain/pages", { method: "POST", body: { title: "Fatturazione", kind: "procedure", summary: "Come partono le fatture.", body: "- Le fatture di Acme partono il 5 del mese.\n- Il portale si apre con la password: q8x2kd93hf0a (in hush come ACME_PORTAL)." } })).status, 201);
  const billing = (await call("/api/brain/pages/fatturazione")).data;
  assert.match(billing.body, /la password: \[segreto omesso\] \(in hush come ACME_PORTAL\)/, "a secret never stays in the brain, its name in hush does");
  assert.doesNotMatch(JSON.stringify(billing), /q8x2kd93hf0a/);
  assert.deepEqual([(await app.companyBrain.state("secretsScrubbed")).version, (await app.companyBrain.state("secretsScrubbed")).pages], [2, 0], "a new brain is scrubbed once, with nothing to scrub");

  // A brain written before the rule: what it already holds is scrubbed.
  await app.companyBrain.q("UPDATE brain_pages SET body = body || $2 WHERE slug = $1", ["acme", "\n- Il token: tk93hd82ks01."]);
  await app.companyBrain.q("UPDATE brain_chunks SET text = text || $2 WHERE id = $1", [`msg:${decision.id}`, " password: zz81kd02ma"]);
  assert.deepEqual(await app.companyBrain.scrubSecrets(), { pages: 1, revisions: 0, notes: 0, chunks: 1 });
  assert.match((await call("/api/brain/pages/acme")).data.body, /- Il token: \[segreto omesso\]\./);
  assert.doesNotMatch(JSON.stringify(await app.companyBrain.exportAll()), /tk93hd82ks01/);
  assert.match((await app.companyBrain.q("SELECT text FROM brain_chunks WHERE id = $1", [`msg:${decision.id}`]))[0].text, /password: \[segreto omesso\]$/);
  const graph = (await call("/api/brain/graph")).data;
  assert.deepEqual(graph.nodes.map((node) => [node.slug, node.kind, node.pending > 0]).sort(), [["acme", "client", true], ["fatturazione", "procedure", false], ["giulia-ferri", "person", true]]);
  assert.deepEqual(graph.edges.map((edge) => [[edge.source, edge.target].sort().join(" "), edge.kind]).sort(), [["acme fatturazione", "mention"], ["acme giulia-ferri", "link"]]);
  assert.equal((await call("/api/brain/pages/fatturazione", { method: "DELETE" })).status, 200);

  // The morning: a note on the phone and a DM from Cora's bot, with the link to the review.
  const digest = await app.librarian.digest();
  assert.equal(digest.status, "sent");
  assert.equal(digest.sent, true);
  const dm = discord.state.botPosts.find((post) => post.channelId === discord.state.dms.get(OWNER));
  assert.match(dm.content, /^🧠 Brain, da rivedere: 2 pagine nuove, 0 modifiche\./);
  assert.match(dm.content, /• Acme: pagamento a 60 giorni e referente/);
  assert.match(dm.content, /Valgono già; se non fai niente restano così\. Rivedi: https:\/\/acme\.usecora\.test\/#\/brain\/revisione/);
  assert.equal((await app.librarian.digest()).status, "nothing", "nothing new since: no second message");

  // The review: one page approved, one reverted, which archives it, and the agents stop seeing it.
  const queue = (await call("/api/brain/review")).data.queue;
  assert.deepEqual(queue.map((revision) => [revision.slug, revision.action, revision.previous]), [["acme", "create", null], ["giulia-ferri", "create", null]]);
  assert.deepEqual((await call("/api/brain/review", { method: "POST", body: { ids: [queue[0].id], decision: "approve" } })).data, { approved: 1, reverted: 0 });
  assert.deepEqual((await call("/api/brain/review", { method: "POST", body: { ids: [queue[1].id], decision: "revert" } })).data, { approved: 0, reverted: 1 });
  assert.equal((await call("/api/brain/pages/giulia-ferri")).data.status, "archived");
  assert.deepEqual((await app.companyBrain.search("Giulia ferie agosto")).map((page) => page.slug), ["acme"]);
  assert.equal((await call("/api/brain")).data.stats.pending, 0);

  // The owner corrects a page by hand: live and approved at once.
  const edited = await call("/api/brain/pages/acme", { method: "PUT", body: { summary: "Cliente: paga a 90 giorni dal 2027." } });
  assert.equal(edited.data.revisions[0].review, "approved");
  assert.match(edited.data.revisions[0].author, /^owner:/);
  assert.equal((await call("/api/brain")).data.stats.pending, 0);

  // The diary: one day of the brain, page changes with their authors and the agents' notes.
  const now = Date.now(), day = (from, to) => `/api/brain/diary?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`;
  const today = await call(day(now - 86400000, now + 60000));
  assert.equal(today.status, 200);
  const seen = today.data.changes.map((change) => `${change.slug}:${change.action}`);
  for (const step of ["acme:create", "acme:update", "giulia-ferri:create", "fatturazione:create"]) assert.ok(seen.includes(step), `${step} is in the diary`);
  assert.ok(today.data.changes.some((change) => change.slug === "acme" && /^owner:/.test(change.author)), "who changed it");
  assert.ok(today.data.changes.every((change) => !("body" in change)), "the diary lists changes, not whole pages");
  assert.ok(today.data.notes.some((note) => /Giulia Ferri/.test(note.text)), "the agents' notes of the day are there");
  assert.equal(today.data.before, null);
  const tomorrow = await call(day(now + 60000, now + 86400000));
  assert.deepEqual([tomorrow.data.changes.length, tomorrow.data.notes.length], [0, 0]);
  assert.ok(tomorrow.data.before, "an empty day points back to the last one with something in it");
  assert.equal((await call("/api/brain/diary?from=nope&to=nope")).status, 400);
  assert.equal((await call(day(now - 5 * 86400000, now))).status, 400, "one day at a time");

  // The night's backups: Cora's database and the brain.
  await app.scheduler.backup("2026-11-03");
  assert.ok(existsSync(join(home, "backups", "cora-2026-11-03.db")));
  const saved = JSON.parse(readFileSync(join(home, "backups", "brain-2026-11-03.json"), "utf8"));
  assert.deepEqual(saved.pages.map((page) => page.slug).sort(), ["acme", "fatturazione", "giulia-ferri"], "archived pages are kept too");
});

test("with a company brain the shared memories belong to it: agents keep their own, and sharing hands a fact to the librarian", async (t) => {
  let librarianAnswer = () => ({ pages: [] });
  const librarianPrompts = [];
  const ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    const user = String(body.messages.filter((message) => message.role === "user").at(-1)?.content || "");
    if (!LIBRARIAN.test(system)) return { content: "PASS" };
    librarianPrompts.push(user);
    // The first answer breaks its JSON with a bare quote, as a long answer sometimes does.
    if (librarianPrompts.length === 1) return { content: '{"pages": [{"slug": "studio", "title": "Lo "studio"", "body": "x"}]}' };
    return { content: JSON.stringify(librarianAnswer(user)) };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ brainModel: "ollama/test-model" });
  const old = seed.addMemory(SHARED, "Lo studio chiude il venerdì alle 16.", "manual");
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-brain-shared",
    discordToken: "", telegramToken: "", ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    brainDatabaseUrl: "pglite:memory", brainEmbedUrl: ollama.url,
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  await app.companyBrain.ready;
  app.librarian.requestRun = () => false;
  t.after(async () => {
    await app.stop();
    await ollama.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const ada = (await call("/api/agents", { method: "POST", body: { name: "Ada", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
  const sharedNow = () => app.store.memories(SHARED).map((memory) => memory.text);

  // Until the librarian has read them, the agents still have the old shared memories.
  assert.ok(app.brain.memory.facts(ada.id).some((fact) => fact.id === old.id && fact.scope === "shared"));
  let memories = (await call(`/api/agents/${ada.id}/memories`)).data;
  assert.deepEqual([memories.brain, memories.shared.length], [true, 1]);

  // A shared fact, from the agent, the panel or the night, is a note for the librarian, not a memory.
  const remembered = await executeTool({ name: "remember", args: { fact: "Il cliente Acme vuole le fatture in PDF.", shared: true } }, { agent: ada, store: app.store, memory: app.brain.memory, companyBrain: app.companyBrain, channelId: "room:test" });
  assert.match(remembered.text, /noted for the company brain/);
  assert.ok((await call(`/api/agents/${ada.id}/memories`, { method: "POST", body: { text: "Le riunioni sono il martedì.", shared: true } })).data.noted);
  const own = (await call(`/api/agents/${ada.id}/memories`, { method: "POST", body: { text: "Sam preferisce i messaggi brevi." } })).data;
  const shared = (await call(`/api/agents/${ada.id}/memories/${own.id}`, { method: "PUT", body: { shared: true } })).data;
  assert.ok(shared.noted, "sharing a memory hands it to the librarian");
  assert.deepEqual(app.store.memories(ada.id).map((memory) => memory.text), ["Sam preferisce i messaggi brevi."], "and the agent keeps its own");
  const slept = app.brain.applySleep(ada, { add: [{ text: "Giulia è la referente di Acme.", shared: true }, { text: "Ho promesso a Sam un riassunto." }] });
  assert.deepEqual([slept.added, slept.noted], [1, 1]);
  await waitFor(async () => (await app.companyBrain.notes()).length === 4, { what: "the night's note" });
  assert.deepEqual((await app.companyBrain.notes()).map((note) => [note.author, note.text]), [
    ["Ada", "Il cliente Acme vuole le fatture in PDF."],
    ["Owner", "Le riunioni sono il martedì."],
    ["Owner", "Sam preferisce i messaggi brevi."],
    ["Ada", "Giulia è la referente di Acme."],
  ]);
  assert.deepEqual(sharedNow(), ["Lo studio chiude il venerdì alle 16."], "nothing new is written as a shared memory");

  // Once the librarian has read them, they live in the brain: agents and the panel no longer show them as memories.
  librarianAnswer = (prompt) => ({ pages: [{ slug: "studio", kind: "procedure", title: "Lo studio", summary: "Orari dello studio.", body: "- Chiude il venerdì alle 16.", sources: [/\[(s\d+)\] Lo studio chiude/.exec(prompt)[1]] }] });
  const run = await app.librarian.run();
  assert.deepEqual([run.created, run.errors], [1, []], "a batch whose JSON broke is asked once more");
  assert.match(librarianPrompts[1], /La tua risposta precedente non era JSON valido/);
  assert.equal(app.companyBrain.holdsShared, true);
  assert.ok(!app.brain.memory.facts(ada.id).some((fact) => fact.scope === "shared"));
  assert.deepEqual(app.brain.memory.searchFacts(ada.id, "studio venerdì").map((fact) => fact.id), []);
  assert.doesNotMatch(app.brain.memoryContext(ada, "quando chiude lo studio?"), /venerdì/);
  memories = (await call(`/api/agents/${ada.id}/memories`)).data;
  assert.deepEqual(memories.shared, []);
  assert.deepEqual(sharedNow(), ["Lo studio chiude il venerdì alle 16."], "the old rows stay where they were, in case the brain goes away");
  assert.deepEqual((await app.companyBrain.search("studio venerdì")).map((page) => page.slug), ["studio"]);
});

test("without a brain database the panel says so and the agents' brain tools answer plainly", async (t) => {
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-nobrain",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys", brainDatabaseUrl: "",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const state = await (await fetch(`${base}/api/brain`, { headers: { Cookie: cookie } })).json();
  assert.equal(state.enabled, false);
  assert.equal((await fetch(`${base}/api/brain/pages`, { headers: { Cookie: cookie } })).status, 409);
  assert.deepEqual(await app.librarian.run(), { status: "disabled" });
  assert.equal(await app.brain.brainContext("Acme"), "");
});

test("the artifact folders are one approved brain page that follows the folders, never the commits", async (t) => {
  const home = tempHome();
  const store = new Store(home);
  const brain = new CompanyBrain({ url: "pglite:memory" });
  await brain.ready;
  t.after(async () => { await brain.close(); store.close(); });
  const artifacts = new Artifacts({ store, home, companyBrain: brain });
  const folder = artifacts.createFolder({ path: "clienti/acme/report", title: "Report Acme", description: "I report mensili di vendita per Acme.", createdBy: { kind: "user", id: "local-owner", name: "Owner" }, requestedBy: { kind: "owner", id: "1", name: "Sam" } });
  await artifacts.brainSync;
  let page = await brain.page("artefatti");
  assert.equal(page.kind, "procedure");
  assert.equal(Number(page.pending), 0, "Cora's own catalog needs no review");
  assert.match(page.body, /\*\*clienti\/acme\/report\*\* — Report Acme/);
  assert.match(page.body, /Cosa ci va: I report mensili di vendita per Acme\./);
  assert.match(page.body, /Ogni push aspetta una revisione; possono caricare: tutti gli agenti\.\n  Decisa con Sam\./);
  const version = page.version;
  artifacts.updateFolder(folder.id, { description: "Un file per mese." }, { role: "owner" });
  await artifacts.brainSync;
  page = await brain.page("artefatti");
  assert.equal(page.version, version + 1);
  assert.match(page.body, /Cosa ci va: Un file per mese\./);
  const hits = await brain.search("dove vanno i report di acme", { limit: 5 });
  assert.ok(hits.some((hit) => hit.slug === "artefatti"), "an agent's brain search finds where things go");
  artifacts.deleteFolder(folder.id);
  await artifacts.brainSync;
  assert.match((await brain.page("artefatti")).body, /Ancora nessuna cartella\./);
});
