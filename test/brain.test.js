import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
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
  discord.say({ content: "Ada, quanto ci mette Acme a pagare?" });
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

  // The night's backups: Cora's database and the brain.
  await app.scheduler.backup("2026-11-03");
  assert.ok(existsSync(join(home, "backups", "cora-2026-11-03.db")));
  const saved = JSON.parse(readFileSync(join(home, "backups", "brain-2026-11-03.json"), "utf8"));
  assert.deepEqual(saved.pages.map((page) => page.slug).sort(), ["acme", "giulia-ferri"]);
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
