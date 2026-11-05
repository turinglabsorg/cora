import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asksToStop, claimsWork, cleanReply, deliveryNote } from "../src/brain.js";
import { DIRECT_MESSAGE_INTENTS, Discord, LISTENING_INTENTS, splitMessage } from "../src/discord.js";
import { LLM } from "../src/llm.js";
import { toMrkdwn } from "../src/slack.js";
import { appManifest } from "../src/slack-bots.js";
import { mentions, spokenTo, tagged } from "../src/orchestrator.js";
import { cronMatches, nextRuns, parseCron, zonedParts } from "../src/scheduler.js";
import { drawAvatar } from "../src/avatar.js";
import { encodePng, pngSize } from "../src/png.js";
import { SHARED, Store, ftsQuery } from "../src/store.js";
import { Traces } from "../src/traces.js";
import { redactSecrets } from "../src/company-brain.js";
import { panelHarness } from "./panel.js";
import { fakeDiscord, sleep, tempHome, waitFor } from "./helpers.js";

describe("cron", () => {
  test("parses ranges, lists and steps", () => {
    const cron = parseCron("*/15 8-10 * * 1-5");
    assert.deepEqual([...cron.minute], [0, 15, 30, 45]);
    assert.deepEqual([...cron.hour], [8, 9, 10]);
    assert.ok(cron.weekday.has(5) && !cron.weekday.has(6));
    assert.throws(() => parseCron("61 * * * *"));
    assert.throws(() => parseCron("* * *"));
  });

  test("matches in the Rome timezone, across daylight saving", () => {
    const cron = parseCron("0 9 * * *");
    assert.ok(cronMatches(cron, zonedParts(new Date("2026-07-01T07:00:00Z"), "Europe/Rome")));
    assert.ok(cronMatches(cron, zonedParts(new Date("2026-12-01T08:00:00Z"), "Europe/Rome")));
    const next = nextRuns("0 9 * * *", "Europe/Rome", 2, new Date("2026-10-24T06:00:00Z"));
    assert.equal(next[0].toISOString(), "2026-10-24T07:00:00.000Z");
    assert.equal(next[1].toISOString(), "2026-10-25T08:00:00.000Z");
  });

  test("day-of-month or weekday, like cron", () => {
    const cron = parseCron("0 12 1 * 1");
    assert.ok(cronMatches(cron, { minute: 0, hour: 12, day: 1, month: 3, weekday: 4 }));
    assert.ok(cronMatches(cron, { minute: 0, hour: 12, day: 9, month: 3, weekday: 1 }));
    assert.ok(!cronMatches(cron, { minute: 0, hour: 12, day: 9, month: 3, weekday: 2 }));
  });
});

describe("being told to stop", () => {
  test("reads an order to stop, and not a turn of phrase that only sounds like one", () => {
    for (const text of ["fermati", "Primo, fermati", "ok basta", "stop", "stoppa tutto", "stoppate", "lascia stare", "annulla tutto", "smettila", "non serve più"]) {
      assert.ok(asksToStop(text), `«${text}» is an order to stop`);
    }
    // "basta che" means "just", not "stop"; the rest are ordinary instructions.
    for (const text of ["basta che li rilanci tu", "fai il deploy", "continua pure", "la settimana finisce", ""]) {
      assert.ok(!asksToStop(text), `«${text}» is not`);
    }
  });
});

describe("work an agent says it did", () => {
  test("reads a report of work done, and not an offer, a question or an honest no", () => {
    for (const text of ["Ho salvato il file.", "L'ho creato ieri sul desktop.", "Ricevuto, ci guardo. Salvato in memoria: la riunione è giovedì.", "Il file è stato creato.", "I've sent the email.", "Ho appena aggiornato la pagina.", "Ricevuto. Ho ripreso il lavoro su sinalunga.md", "La riunione è venerdì alle 10: l'ho ricordato nella mia memoria.", "L'ho messo in memoria.", "Ho preso nota.", "Me lo sono segnato.", "Me lo ricorderò.", "I'll remember that.", "Script pronto; file salvato in/Desktop/audioguida.md.", "Sì, l’ho creato nel turno di prima."]) {
      assert.equal(claimsWork(text), "change", `«${text}» reports something made`);
    }
    for (const text of ["Ho controllato le routine: sono 0.", "Ho già verificato il calendario.", "I've checked the routines."]) {
      assert.equal(claimsWork(text), "look", `«${text}» reports something checked`);
    }
    for (const text of ["Ricevuto, ci guardo.", "Posso iniziare a compilare il file.", "Ho capito, procedo?", "Non ho creato il file: mi manca il permesso.", "Non l'ho ancora salvato.", "Il file non è stato creato.", "Vuoi che lo salvi?", "I have not created it yet.", "Ho visto che il file non esiste.", "Non ho preso nota.", "Non me lo sono segnato.", "Vuoi che me lo segni?", "Il file non è stato salvato in /tmp.", "Il file creato in precedenza è vuoto.", ""]) {
      assert.equal(claimsWork(text), null, `«${text}» does not`);
    }
  });
});

describe("a final reply that only says a message went out", () => {
  test("is told from an answer", () => {
    for (const text of ["Messaggio già in #general.", "Messaggio inviato in #general.", "Fatto.", "Ho già risposto.", "Risposta pubblicata qui sopra.", "Message sent.", "I've already replied above."]) {
      assert.ok(deliveryNote(text), `«${text}» is a delivery note`);
    }
    for (const text of ["Ciao Sebastiano!", "Fatto: il deploy è su main ca03272.", "Ho trovato il messaggio di errore nel log: manca la chiave.", "La bozza HTML è pronta.", `Messaggio inviato.\nEcco i dettagli del report.`, ""]) {
      assert.ok(!deliveryNote(text), `«${text}» is not`);
    }
  });
});

test("a bot that asks to hear more reconnects once: the old connection's close does not start another", async () => {
  const fake = await fakeDiscord();
  fake.state.botUsers.set("vale-token", { id: "600000000000000031", username: "Vale" });
  const client = new Discord({ token: "vale-token", apiBase: fake.url, intents: DIRECT_MESSAGE_INTENTS });
  try {
    client.start();
    await waitFor(() => client.state === "ready", { what: "the first connection" });
    client.useIntents(LISTENING_INTENTS);
    await waitFor(() => client.state === "ready" && fake.state.identifies === 2, { what: "the second connection" });
    // A stray reconnect would come a second later, resuming on a socket of its own.
    await sleep(1500);
    assert.equal(fake.state.sockets.size, 1, "one connection, the one identified with the new intents");
    assert.equal(fake.state.identifies, 2);
  } finally {
    client.stop();
    await fake.close();
  }
});

describe("posting as an agent through the plain bot", () => {
  const posted = (botName, agentName) => {
    const client = new Discord({ token: "t", apiBase: "http://x", gatewayUrl: "ws://x" });
    client.user = { id: "1", username: botName };
    client.channelInfo = () => null;
    client.webhookFor = async () => null;
    client.rememberOwn = () => {};
    const sent = [];
    client.sendPayload = async (path, payload) => { sent.push(payload); return { id: "m1" }; };
    return client.post("9", { username: agentName, content: "Fatto." }).then(() => sent[0].content);
  };

  test("says who is speaking only when the bot is not that agent", async () => {
    assert.equal(await posted("GROG", "Marta"), "**Marta** · Fatto.", "a shared bot names the agent it speaks for");
    // Cora listens through an agent's own bot: the author already is Primo, so saying it again
    // would print the name twice.
    assert.equal(await posted("Primo", "Primo"), "Fatto.");
  });
});

describe("where the models run", () => {
  const llm = (ollamaUrl, ollamaKey = "") => new LLM({ ollamaUrl, ollamaKey, cliWorkDir: "/tmp", bridge: null, subscriptions: null });

  test("an Ollama on this machine needs no key, one in the cloud still does", () => {
    assert.equal(llm("http://127.0.0.1:11434").providers().ollama, true, "the GPU in the room answers without a key");
    assert.equal(llm("http://192.168.1.64:11434").providers().ollama, true, "so does one on the same network");
    assert.equal(llm("https://ollama.com").providers().ollama, false, "the cloud one is not available without a key");
    assert.equal(llm("https://ollama.com", "k").providers().ollama, true);
    assert.deepEqual(llm("http://127.0.0.1:11434").ollamaHeaders(), {}, "no key, no Authorization header");
  });
});

describe("writing for Slack", () => {
  test("markdown becomes mrkdwn, and code is left alone", () => {
    assert.equal(toMrkdwn("**fatto** e [il link](https://dopamina.it)"), "*fatto* e <https://dopamina.it|il link>");
    assert.equal(toMrkdwn("*corsivo*"), "_corsivo_");
    assert.equal(toMrkdwn("- uno\n- due"), "• uno\n• due");
    assert.equal(toMrkdwn("prima `**non** qui` dopo"), "prima `**non** qui` dopo");
    assert.equal(toMrkdwn("a < b & c"), "a &lt; b &amp; c");
    assert.equal(toMrkdwn("<@U0000000102> guarda: a <b> & c"), "<@U0000000102> guarda: a &lt;b&gt; &amp; c", "a mention stays a mention");
  });
});

describe("text helpers", () => {
  test("mentions match names as words, accents and case aside", () => {
    assert.ok(mentions("ciao Bea, come va?", "Bea"));
    assert.ok(mentions("@marta ci sei", "Marta"));
    assert.ok(mentions("Niccolò dove sei", "Niccolo"));
    assert.ok(!mentions("beato te", "Bea"));
  });

  test("only a tag calls an agent; in a voice message the name said to it does", () => {
    assert.ok(tagged("@Sarax ci sei?", "Sarax"));
    assert.ok(tagged("ok @sarax!", "Sarax"), "case aside");
    assert.ok(!tagged("Sarax, ci sei?", "Sarax"), "a name said to someone is not a tag");
    assert.ok(!tagged("**Sarax** non è in ascolto qui", "Sarax"));
    assert.ok(!tagged("scrivi a mail@Sarax.it", "Sarax"), "an address is not a tag");
    assert.ok(!tagged("@Saraxine", "Sarax"));
    const heard = (words) => `[messaggio vocale: «${words}»]`;
    assert.ok(spokenTo(heard("Ada, domani c'è la riunione?"), "Ada"));
    assert.ok(spokenTo(heard("ci sei, Ada?"), "Ada"));
    assert.ok(!spokenTo(heard("ho visto Ada ieri"), "Ada"), "named in passing, not called");
    assert.ok(!spokenTo("Ada, ciao", "Ada"), "a written message still needs the tag");
  });

  test("replies are cleaned and PASS means silence", () => {
    const agent = { name: "Marta" };
    assert.equal(cleanReply("PASS", agent), null);
    assert.equal(cleanReply("  pass. ", agent), null);
    assert.equal(cleanReply("Marta: ciao", agent), "ciao");
    assert.equal(cleanReply("[10:22] Tu (Marta): ehi", agent), "ehi");
    assert.equal(cleanReply("<think>hmm</think>Va bene", agent), "Va bene");
    assert.equal(cleanReply("Passaggio a livello", agent), "Passaggio a livello");
  });

  test("long messages are split under the Discord limit", () => {
    const chunks = splitMessage(`${"parola ".repeat(500)}\nfine`);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 1990));
  });

  test("FTS queries quote every word", () => {
    assert.equal(ftsQuery("Il gatto \"Ugo\" OR NOT"), "\"gatto\" OR \"ugo\" OR \"not\"");
    assert.equal(ftsQuery("a b"), "");
  });
});

describe("SQLite store", () => {
  test("keeps reasoning traces; a turn cut short by a restart is marked interrupted", () => {
    const home = tempHome();
    const store = new Store(home);
    const agent = store.createAgent({ name: "Ugo" });
    const events = [];
    const traces = new Traces({ store, emit: (event) => events.push(event) });
    const done = traces.start({ agentId: agent.id, kind: "chat", channelId: "web", model: "ollama/x", system: "Sei Ugo.", prompt: "ciao" });
    done.add({ type: "thinking", text: "Rispondo al saluto." });
    done.add({ type: "tool", name: "recall", args: { query: "x".repeat(9000) }, result: "y".repeat(30000), ok: true, ms: 3 });
    done.finish({ status: "done", output: "Ciao!" });
    done.add({ type: "text", text: "dopo la fine" });
    const cut = traces.start({ agentId: agent.id, kind: "routine", model: "ollama/x" });
    cut.add({ type: "text", text: "a metà" });
    assert.equal(traces.get(cut.id).steps.length, 1, "a running trace is readable");
    assert.deepEqual(events.map((event) => event.event), ["start", "step", "step", "end", "start", "step"]);
    store.close();

    const reopened = new Store(home);
    const saved = reopened.trace(done.id);
    assert.equal(saved.status, "done");
    assert.equal(saved.steps.length, 2, "nothing is added after the end");
    assert.ok(saved.steps[1].result.length < 21000 && saved.steps[1].args._troncato, "big results and args are clipped");
    assert.equal(reopened.trace(cut.id).status, "interrupted");
    assert.deepEqual(reopened.traces(agent.id).map((trace) => trace.id).sort(), [done.id, cut.id].sort());
    assert.deepEqual(reopened.traces(agent.id).find((trace) => trace.id === done.id).tools, ["recall"]);
    reopened.deleteAgent(agent.id);
    assert.equal(reopened.trace(done.id), null);
    reopened.close();
  });

  test("keeps agents, memories and the archive across restarts", () => {
    const home = tempHome();
    const store = new Store(home);
    const agent = store.createAgent({ name: "Ugo", personality: "gatto" });
    store.addMemory(agent.id, "Ama le crocchette al salmone");
    store.addMemory(SHARED, "Sam vive a Lisbona", "manual", { pinned: true });
    store.addMemory(agent.id, "ama le crocchette al salmone");
    store.appendArchive("200000000000000001", { id: "1", at: 1000, authorName: "Seb", kind: "owner", content: "domani si va al mare a Marina di Lisbona" });
    store.appendArchive("200000000000000001", { id: "1", at: 1000, authorName: "Seb", kind: "owner", content: "duplicato ignorato" });
    store.setCore(agent.id, "prima");
    store.setCore(agent.id, "seconda");
    store.close();

    const again = new Store(home);
    assert.equal(again.agents()[0].name, "Ugo");
    assert.equal(again.memories(agent.id).length, 1, "duplicates are not saved twice");
    assert.equal(again.searchMemories([agent.id, SHARED], "crocchette")[0].text, "Ama le crocchette al salmone");
    assert.equal(again.searchMemories([agent.id, SHARED], "lisbona")[0].owner, SHARED);
    assert.equal(again.searchMessages(["200000000000000001"], "mare Lisbona").length, 1);
    assert.equal(again.searchMessages(["200000000000000009"], "mare").length, 0);
    assert.equal(again.agent(agent.id).core, "seconda");
    assert.deepEqual(again.coreHistory(agent.id).map((item) => item.text), ["prima"]);
    assert.ok(again.deleteAgent(agent.id));
    assert.equal(again.memories(agent.id).length, 0);
    again.close();
  });

  test("rejects invalid input with a 400", () => {
    const store = new Store(tempHome());
    assert.throws(() => store.createAgent({ name: "Discord Bot" }), (error) => error.status === 400);
    store.close();
  });

  test("an agent's picture is Cora's drawing, at an address that changes with it, until one of its own is kept", () => {
    const home = tempHome();
    const store = new Store(home);
    const agent = store.createAgent({ name: "Pia", color: "#6fa8dc", avatarUrl: "https://api.dicebear.com/9.x/notionists/png?seed=Pia" });
    assert.equal(agent.avatarUrl, "", "no public address, no address for Slack or Discord; an outside link is not taken");
    assert.deepEqual(pngSize(store.avatar(agent.id)), { width: 512, height: 512 });

    store.setAvatarBase("https://pia.usecora.test/");
    const drawn = store.agent(agent.id);
    assert.equal(drawn.avatarUrl, `https://pia.usecora.test/avatars/${agent.id}.png?v=${drawn.avatarVersion}`);
    assert.equal(store.updateAgent(agent.id, { personality: "calma" }).avatarUrl, drawn.avatarUrl, "what the picture is not made of leaves it alone");
    const recoloured = store.updateAgent(agent.id, { color: "#e5533d" });
    assert.notEqual(recoloured.avatarVersion, drawn.avatarVersion, "a new colour is a new picture");
    assert.notEqual(store.updateAgent(agent.id, { avatarSeed: "altra-faccia" }).avatarVersion, recoloured.avatarVersion, "and so is a new face");

    const own = encodePng(512, 512, Buffer.alloc(512 * 512 * 4, 200));
    const uploaded = store.setAvatarImage(agent.id, own);
    assert.ok(store.avatar(agent.id).equals(own));
    assert.match(uploaded.avatarUpload, /^[0-9a-f]{16}$/);
    store.close();

    const again = new Store(home);
    assert.ok(again.avatar(agent.id).equals(own), "an uploaded picture survives a restart");
    assert.equal(again.setAvatarImage(agent.id, null).avatarUpload, "");
    assert.ok(!again.avatar(agent.id).equals(own), "and gives way to the drawing when dropped");
    assert.ok(again.deleteAgent(agent.id));
    assert.equal(again.avatar(agent.id), null);
    again.close();
  });
});

test("Cora draws each agent its own face: the same every time, different for another seed or colour", () => {
  const one = drawAvatar({ seed: "ag_000000000001", color: "#6fa8dc", size: 96 });
  assert.deepEqual(pngSize(one), { width: 96, height: 96 });
  assert.ok(one.equals(drawAvatar({ seed: "ag_000000000001", color: "#6fa8dc", size: 96 })));
  assert.ok(!one.equals(drawAvatar({ seed: "ag_000000000002", color: "#6fa8dc", size: 96 })));
  assert.ok(!one.equals(drawAvatar({ seed: "ag_000000000001", color: "#e5533d", size: 96 })));
  assert.equal(pngSize(Buffer.from("not a png")), null);
});

test("a Slack app's short description stays under what Slack's editor accepts, cut at a word", () => {
  const long = "Seeky. Giri su DeepSeek Harness, con DeepSeek V4.1 Flash. Curioso e preciso: cerchi, controlli e dici da dove viene quello che riporti. Rispondi breve.";
  const description = appManifest({ name: "Seeky", personality: long }).display_information.description;
  assert.ok(description.length <= 120);
  assert.match(description, /riporti\.…$|quello…$|che…$|[a-z]…$/);
  assert.ok(long.startsWith(description.slice(0, -1).trim()), "the words kept are the personality's own");
  assert.equal(appManifest({ name: "Dina", personality: "Agente di Dopamina.\nAltro." }).display_information.description, "Agente di Dopamina.");
  assert.equal(appManifest({ name: "Neo", personality: "" }).display_information.description, "Neo, agente di Cora");
});

test("a goal's cost is the sum of every turn that worked toward it, older turns included", () => {
  const store = new Store(tempHome());
  const save = (id, goal, tokensIn, tokensOut, steps, at) => store.saveTrace({ id, agentId: "ag_goals", kind: "chat", channelId: "web-ag_goals", model: "m", startedAt: at, endedAt: at, status: "done", steps, dropped: 0, prompt: "", output: "", error: "", tokensIn, tokensOut, goal });
  save("t1", "Report pronto", 100, 10, [], "2026-11-01T10:00:00.000Z");
  save("t2", "Report pronto", 50, 5, [], "2026-11-01T11:00:00.000Z");
  // A turn from before goals had a column: its goal is read back from its own notes, the last one winning.
  save("t3", "", 30, 3, [{ type: "note", text: "Obiettivo: Bozza inviata" }, { type: "note", text: "Obiettivo aggiornato su quello che hanno detto: Bozza inviata a Sam" }], "2026-11-02T09:00:00.000Z");
  save("t4", "", 7, 1, [{ type: "note", text: "Controllo obiettivo: raggiunto" }], "2026-11-02T10:00:00.000Z");
  store.backfillGoals();
  assert.deepEqual(store.goalUsage("ag_goals").map((item) => [item.goal, item.turns, item.tokensIn, item.tokensOut, item.status]),
    [["Bozza inviata a Sam", 1, 30, 3, "done"], ["Report pronto", 2, 150, 15, "done"]]);
  assert.deepEqual(store.traces("ag_goals", 10, { goal: "Report pronto" }).map((trace) => trace.id), ["t2", "t1"]);
  store.close();
});

test("the brain keeps no secret: credential shapes and values after a secret's word go, names and ordinary words stay", () => {
  const cases = [
    ["la secret cfjitqet62m7 è stata consegnata", "la secret [segreto omesso] è stata consegnata"],
    ["il bot usa xoxb-1234567890-abcdefgh", "il bot usa [segreto omesso]"],
    ["password: Hunter22!", "password: [segreto omesso]!"],
    ["api key=AbC123xyz789", "api key=[segreto omesso]"],
    ["sk-ant-api03-abcdefgh123 nel file", "[segreto omesso] nel file"],
    ["in hush come CORA_SESSION_KEY", "in hush come CORA_SESSION_KEY"],
    ["la chiave DeepSeek è la stessa", "la chiave DeepSeek è la stessa"],
    ["Token usati: 12345678", "Token usati: 12345678"],
    ["token per goal", "token per goal"],
    ["la segretaria2026 arriva", "la segretaria2026 arriva"],
    ["Il token: tk93hd82ks01.", "Il token: [segreto omesso]."],
    ["- secret attiva ab12cd34ef56 (hush)", "- secret attiva [segreto omesso] (hush)"],
    ["running on the new secret key zx98yw76vu54.", "running on the new secret key [segreto omesso]."],
    ["chiave pubblicabile q1w2e3r4t5y6, limitata", "chiave pubblicabile [segreto omesso], limitata"],
    ["la chiave del cliente Acme è nel vault", "la chiave del cliente Acme è nel vault"],
  ];
  for (const [text, expected] of cases) assert.equal(redactSecrets(text), expected, text);
});

test("every turn in the Reasoning list leads with the token box a goal has, and tokens are never a chip", () => {
  const panel = panelHarness({ fetch: async () => { throw new Error("offline"); } });
  panel.run(`S.data = { agents: [{ id: "ada", name: "Ada", color: "#f2a93b" }], settings: {} }`);
  const row = (trace, options = {}) => panel.run(`traceRow(${JSON.stringify(trace)}, ${JSON.stringify(options)})`);
  const done = row({ id: "t1", agentId: "ada", kind: "sleep", status: "ok", startedAt: "2026-11-03T19:00:00Z", endedAt: "2026-11-03T19:00:02Z", tokensIn: 1400, tokensOut: 42, output: "Fatto." });
  assert.equal(done.children[0].className, "goal-total");
  assert.equal(done.children[0].textContent.replace(/\s/g, ""), "1,4ktoken");
  assert.match(done.querySelector(".row-meta").textContent, /1,4k in · 42 out · memoria · /);
  assert.equal(done.querySelectorAll(".tokens").length, 0);
  const running = row({ id: "t2", agentId: "ada", kind: "sleep", status: "running", startedAt: "2026-11-03T19:00:00Z", tokensIn: 0, tokensOut: 0 });
  assert.equal(running.children[0].textContent.replace(/\s/g, ""), "—token");
  assert.doesNotMatch(running.querySelector(".row-meta").textContent, / in · /);
  const desk = row({ id: "t3", agentId: "ada", kind: "sleep", status: "ok", startedAt: "2026-11-03T19:00:00Z", endedAt: "2026-11-03T19:00:02Z", tokensIn: 989, tokensOut: 0 }, { withAgent: true });
  assert.match(desk.children[0].className, /\bavatar\b/);
  assert.equal(desk.querySelectorAll(".goal-total").length, 0);
  assert.equal(desk.querySelectorAll(".tokens").length, 0);
});

test("the top bar ends with your account: a menu with who you are, your access and language, and Esci, which asks first", async () => {
  const calls = [];
  const panel = panelHarness({ fetch: async (path, options) => { calls.push([options?.method || "GET", path]); return { ok: true, status: 200, json: async () => ({ ok: true }) }; } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], currentUser: { id: "u1", name: "Ada Lovelace", email: "ada@team.example", role: "owner", avatar: "" } }`);
  panel.run(`S.cloud = { login: "https://usecora.test/go/team", logout: "https://usecora.test/logout" }`);
  panel.run(`shell(h("p", {}, "x"), { title: "Impostazioni" })`);
  const bar = panel.app.querySelector(".appbar");
  assert.equal(bar.querySelectorAll(".onair").length, 0, "the lamp has left the top bar");
  const trigger = bar.children.at(-1);
  assert.equal(trigger.className, "profile-btn");
  assert.equal(trigger.attributes["aria-haspopup"], "menu");
  assert.equal(trigger.textContent, "AL");
  assert.equal(panel.app.querySelectorAll(".side-logout").length, 0, "Esci lives in the menu, on the desktop too");
  assert.match(panel.app.querySelector(".side-identity").textContent, /Ada Lovelace.*ada@team\.example/);
  const menu = () => panel.run("document.body").querySelectorAll(".profile-menu");
  const items = () => menu()[0].querySelectorAll(".profile-item");

  trigger.click();
  assert.equal(menu().length, 1);
  assert.equal(trigger.attributes["aria-expanded"], "true");
  assert.match(menu()[0].querySelector(".profile-head").textContent, /Ada Lovelace.*ada@team\.example.*Owner/);
  assert.deepEqual(items().map((item) => item.textContent), ["Accesso", "Lingua e notifiche", "Esci"]);
  items()[0].click();
  assert.equal(panel.run("location.hash"), "#/settings/accesso");
  assert.equal(menu().length, 0, "choosing an entry closes the menu");
  assert.equal(trigger.attributes["aria-expanded"], "false");

  trigger.click();
  items()[2].click();
  assert.deepEqual(calls, [], "Esci only asks");
  const confirm = menu()[0].querySelector(".profile-confirm");
  assert.match(confirm.textContent, /Vuoi uscire\?.*usecora\.space/);
  confirm.querySelector(".profile-actions").children[0].click();
  assert.deepEqual(items().map((item) => item.textContent), ["Accesso", "Lingua e notifiche", "Esci"], "Annulla goes back to the menu");
  assert.deepEqual(calls, []);
  items()[2].click();
  menu()[0].querySelector(".profile-actions").children[1].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["POST", "/api/logout"]]);
  assert.equal(panel.run("location.href"), "https://usecora.test/logout");
  assert.equal(menu().length, 0);

  panel.run(`S.data.currentUser = { id: "u2", name: "", email: "bo@team.example", role: "member" }; S.cloud = null`);
  panel.run(`shell(h("p", {}, "x"), { title: "Impostazioni" })`);
  panel.app.querySelector(".profile-btn").click();
  assert.match(menu()[0].querySelector(".profile-head").textContent, /bo@team\.example.*Utente/);
  menu()[0].querySelectorAll(".profile-item")[2].click();
  assert.match(menu()[0].querySelector(".profile-confirm").textContent, /password/);
  panel.run("closeAccountMenu()");
  assert.equal(menu().length, 0);
});

test("the panel renders markdown as DOM: blocks, inline marks, only web and mail links, [[pages]] only in the brain", () => {
  const panel = panelHarness({ fetch: async () => { throw new Error("offline"); } });
  const render = (text, options = {}) => panel.run(`h("div", {}, markdown(${JSON.stringify(text)}, ${JSON.stringify(options)}))`);
  const kids = (node) => node.children.filter((child) => child.tagName !== "text" || child.text);
  const out = render([
    "# Piano",
    "Una riga **importante**, una *corsiva*, `a_b`, ~~vecchio~~ e snake_case_name.",
    "Seconda riga: https://example.com/a. [sito](https://cora.test) [male](javascript:alert(1)) <script>x</script>",
    "",
    "- uno",
    "  - due",
    "- [x] fatto",
    "",
    "3. tre",
    "4. quattro",
    "",
    "> citazione",
    "",
    "| Nome | Costo |",
    "|---|---:|",
    "| Acme | 10 € |",
    "",
    "```js",
    "const a = \"<b>\";",
    "```",
    "---",
    "Vedi [[acme]].",
    "Nel 2026 è andata così:",
    "2026. Poi è cambiato.",
  ].join("\n"), { wiki: true });
  assert.deepEqual(kids(out).map((node) => node.tagName), ["h3", "p", "ul", "ol", "blockquote", "div", "div", "hr", "p"]);
  const [, paragraph, bullets, numbers, quote, table, code, , last] = kids(out);
  assert.deepEqual(kids(paragraph).filter((node) => node.tagName !== "text").map((node) => [node.tagName, node.textContent]), [
    ["strong", "importante"], ["em", "corsiva"], ["code", "a_b"], ["del", "vecchio"], ["br", ""], ["a", "https://example.com/a"], ["a", "sito"],
  ]);
  assert.match(paragraph.textContent, /e snake_case_name\./, "underscores inside a word are not emphasis");
  assert.match(paragraph.textContent, /\[male\]\(javascript:alert\(1\)\) <script>x<\/script>/, "a link that is not web or mail, and any HTML, stay text");
  assert.deepEqual(paragraph.querySelectorAll("a").map((a) => a.attributes.href), ["https://example.com/a", "https://cora.test"]);
  assert.equal(bullets.querySelector("ul").textContent, "due", "a nested list goes inside its item");
  assert.equal(bullets.querySelector("input").attributes.type, "checkbox");
  assert.deepEqual([numbers.attributes.start, numbers.querySelectorAll("li").length], ["3", 2], "a numbered list after a bulleted one is a list of its own");
  assert.equal(quote.textContent, "citazione");
  assert.deepEqual(table.querySelectorAll("th").map((th) => [th.textContent, th.className]), [["Nome", ""], ["Costo", "md-right"]]);
  assert.deepEqual([code.querySelector("span").textContent, code.querySelector("pre").textContent], ["js", 'const a = "<b>";']);
  assert.deepEqual(last.querySelectorAll("a").map((a) => [a.attributes.href, a.className]), [["#/brain/p/acme", "brain-link"]]);
  assert.match(last.textContent, /così:2026\. Poi è cambiato\.$/, "a line that opens with a year stays a sentence");
  assert.equal(render("Vedi [[acme]].").textContent, "Vedi [[acme]].", "outside the brain [[slug]] is text");
  assert.equal(render("**grassetto *e corsivo***").querySelector("strong").querySelector("em").textContent, "e corsivo");
});

test("Artefatti: the count of reviews waits beside its entry, proposals come first, folders sit in their groups", async () => {
  const folder = (id, path, extra = {}) => ({ id, path, title: path.split("/").at(-1), description: "", kind: "files", policy: "review", head: "", pending: 0, conflicts: 0, shares: 0, files: 0, bytes: 0, lastActivity: Date.parse("2026-11-05T09:00:00Z"), ...extra });
  const listing = {
    folders: [folder("af_000000000001", "clienti/acme/sito", { kind: "site", head: "ac_000000000009", files: 3, bytes: 2048, pending: 1 }), folder("af_000000000002", "clienti/acme/report", { conflicts: 1 }), folder("af_000000000003", "comunicati", { head: "ac_000000000008", files: 1, bytes: 10 })],
    reviews: [{ id: "ac_000000000010", folderId: "af_000000000001", message: "Numeri del Q3", author: { kind: "agent", id: "ag_x", name: "Nico" }, status: "proposed", createdAt: Date.parse("2026-11-05T09:00:00Z"), changes: { added: 1, modified: 1, deleted: 0 } }],
    quota: { used: 4096, limit: 20 * 1024 ** 3 }, people: [], canManage: true,
  };
  const panel = panelHarness({ fetch: async (path) => ({ ok: true, status: 200, json: async () => (path === "/api/artifacts" ? listing : {}) }) });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], artifacts: { reviews: 3 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  panel.run(`location.hash = "#/artefatti"`);
  panel.run("renderArtifacts()");
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  const nav = panel.app.querySelector(".side-nav").querySelectorAll("a").find((link) => link.attributes.href === "#/artefatti");
  assert.equal(nav.className, "active");
  assert.equal(nav.querySelector(".nav-count").textContent, "1", "the count follows what the server says waits for this viewer");
  const reviews = panel.app.querySelectorAll(".art-review");
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].attributes.href, "#/artefatti/af_000000000001/c/ac_000000000010");
  assert.match(reviews[0].textContent, /Nico.*Numeri del Q3.*clienti\/acme\/sito.*\+1~1/);
  const groups = panel.app.querySelectorAll(".art-group");
  assert.deepEqual(groups.map((group) => group.querySelector("h3").textContent), ["clienti2", "Senza gruppo1"]);
  const rows = panel.app.querySelectorAll(".art-row");
  assert.deepEqual(rows.map((row) => row.attributes.href), ["#/artefatti/af_000000000001", "#/artefatti/af_000000000002", "#/artefatti/af_000000000003"]);
  assert.match(rows[0].textContent, /1 da rivedere.*3 file · 2 KB/);
  assert.match(rows[1].textContent, /Conflitto.*niente in onda/);
  assert.match(rows[2].textContent, /1 file · 10 B/);
  assert.equal(rows[0].querySelector(".led").className, "led busy");
  assert.equal(rows[1].querySelector(".led").className, "led err");
  assert.equal(rows[2].querySelector(".led").className, "led on");
});

test("Segreti: names and who may use them, never a value; what agents asked to send waits for the owner on top", async () => {
  const at = Date.parse("2026-11-05T09:00:00Z");
  const listing = {
    enabled: true, canManage: true,
    secrets: [
      { id: "vs_1", name: "ACME_STRIPE_KEY", description: "Stripe di Acme", agents: ["*"], size: 24, source: "panel", createdAt: at, updatedAt: at, uses: 3, lastUse: { agentId: "ag_x", name: "Nico", at } },
      { id: "vs_2", name: "ROSSI_FTP", description: "", agents: ["ag_x"], size: 16, source: "request", createdAt: at, updatedAt: at, uses: 0, lastUse: null },
    ],
    requests: [{ id: "vr_1", name: "ACME_SHOPIFY", by: { name: "Vera" }, expiresAt: at + 86400000, status: "open" }],
    sends: [{ id: "vx_1", name: "ACME_STRIPE_KEY", status: "proposed", by: { name: "Nico" }, note: "Giulia: webhook", expiresAt: at + 86400000 }],
  };
  const posted = [];
  const events = [
    { id: 3, at: at + 3000, kind: "send-opened", name: "ACME_STRIPE_KEY", sendId: "vx_1", opened: 1, views: 2, who: { email: "giulia@cliente.it", via: "google", visitor: "abc123", device: "Chrome · macOS" } },
    { id: 2, at: at + 2000, kind: "secret-imported", name: "ACME_STRIPE_KEY", by: { kind: "agent", name: "Nico" } },
    { id: 1, at: at + 1000, kind: "send-created", name: "ACME_STRIPE_KEY", mode: "people", by: { kind: "user", name: "Ada" } },
  ];
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    if (options.method === "POST") posted.push({ path, body: JSON.parse(options.body) });
    const body = path === "/api/secrets" ? { ...listing, peopleSends: true } : path.startsWith("/api/secrets/events") ? { events }
      : path.endsWith("/approve") ? { id: "vx_1", name: "ACME_STRIPE_KEY", url: "https://v-000000000001--acme.usecora.space/#key" } : {};
    return { ok: true, status: 200, json: async () => body };
  } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [{ id: "ag_x", name: "Nico", tools: true }], artifacts: { reviews: 0 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  panel.run(`location.hash = "#/artefatti/segreti"`);
  panel.run("renderArtifacts()");
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  const tabs = panel.app.querySelector(".art-switch").querySelectorAll("button");
  assert.deepEqual(tabs.map((tab) => [tab.textContent, tab.className]), [["Cartelle", ""], ["Segreti", "on"]]);
  const asks = panel.app.querySelectorAll(".art-review");
  assert.equal(asks.length, 1);
  assert.match(asks[0].textContent, /ACME_STRIPE_KEY.*Nico · Giulia: webhook.*Rifiuta.*Rivedi e approva/);
  const rows = panel.app.querySelectorAll(".vault-row");
  assert.deepEqual(rows.map((row) => row.querySelector(".vault-name").textContent), ["ACME_STRIPE_KEY", "ROSSI_FTP", "ACME_SHOPIFY"]);
  assert.match(rows[0].textContent, /Tutti gli agenti.*usato 3 volte · l'ultima Nico/);
  assert.match(rows[1].textContent, /Arrivato da un link.*Nico.*mai usato/);
  assert.match(rows[2].textContent, /chiesto da Vera/);
  assert.doesNotMatch(panel.app.textContent, /sk_|value/i, "nothing on the page could be a value");

  const log = panel.app.querySelectorAll(".log-row").map((row) => row.querySelector(".log-text").children[0].textContent);
  assert.deepEqual(log, ["giulia@cliente.it ha visto ACME_STRIPE_KEY · 1 di 2", "Nico ha messo ACME_STRIPE_KEY nel suo hush", "Ada ha creato un link per ACME_STRIPE_KEY · persone precise"], "the vault's log, newest first");

  asks[0].querySelectorAll("button").find((button) => button.textContent === "Rivedi e approva").click();
  const form = panel.app.querySelector(".share-new");
  assert.ok(form, "approving opens the same form as any link");
  assert.match(panel.app.textContent, /Approva l'invio di ACME_STRIPE_KEY/);
  assert.deepEqual(form.querySelector(".share-modes").querySelectorAll("button").map((button) => button.textContent), ["Pubblico", "Persone precise", "Con password"]);
  form.querySelector("textarea").value = "Giulia@Cliente.it";
  form.dispatch("submit");
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted[0].path, "/api/secrets/sends/vx_1/approve");
  assert.deepEqual(posted[0].body.access, { mode: "people", emails: "Giulia@Cliente.it", domains: "", members: false }, "a secret goes to named people by default, without the team");
  assert.equal(posted[0].body.note, "Giulia: webhook", "the agent's note is kept");
});

test("Artefatti, File: folders to walk into from the address, and files uploaded where you stand", async () => {
  const at = Date.parse("2026-11-05T09:00:00Z");
  const sha = (char) => char.repeat(64);
  const head = { id: "ac_000000000009", short: "0000000", folderId: "af_000000000001", message: "Sito", author: { kind: "agent", id: "ag_x", name: "Nico" }, status: "published", createdAt: at, publishedAt: at, files: 4, bytes: 65, changes: { added: 4, modified: 0, deleted: 0 } };
  const data = {
    folder: { id: "af_000000000001", path: "clienti/acme/sito", title: "Sito", description: "", kind: "site", policy: "review", head: head.id, writers: ["*"], reviewers: [] },
    canReview: true, canManage: true, shareHosting: false, shareSuffix: "", shares: [], commits: [head],
    tree: [
      { path: "chi-siamo/img/logo.png", sha: sha("c"), size: 30 },
      { path: "chi-siamo/index.html", sha: sha("b"), size: 20 },
      { path: "css/style.css", sha: sha("d"), size: 5 },
      { path: "index.html", sha: sha("a"), size: 10 },
    ],
  };
  const calls = [];
  let status = "published";
  const reply = (body, code = 200) => ({ ok: code < 400, status: code, statusText: "", json: async () => body });
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET", body: options.body });
    if (path === "/api/artifacts/folders/af_000000000001") return reply(data);
    if (path.endsWith("/blobs")) return reply({ sha: sha(String(calls.filter((call) => call.path.endsWith("/blobs")).length)), size: options.body.size }, 201);
    if (path.endsWith("/upload")) return reply({ commit: { id: "ac_00000000000a", status, message: "Caricati 2 file in chi-siamo" } }, 201);
    return reply({});
  } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], artifacts: { reviews: 0 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await panel.navigate("#/artefatti/af_000000000001/file/chi-siamo");
  await settle();
  assert.deepEqual(panel.app.querySelector(".art-crumbs").querySelectorAll("a").map((link) => [link.textContent, link.attributes.href, link.className]),
    [["sito", "#/artefatti/af_000000000001/file", ""], ["chi-siamo", "#/artefatti/af_000000000001/file/chi-siamo", "on"]], "the path in the address is where you stand");
  const rows = panel.app.querySelector(".art-tree").children;
  assert.deepEqual(rows.map((row) => row.textContent), ["..su", "img/1 file", "index.html20 B"], "one level at a time: up, the folders inside, then the files");
  assert.equal(rows[0].attributes.href, "#/artefatti/af_000000000001/file");
  assert.equal(rows[1].attributes.href, "#/artefatti/af_000000000001/file/chi-siamo/img");
  assert.equal(panel.app.querySelector(".art-drop-where").textContent, "clienti/acme/sito/chi-siamo/", "the upload says where the files will go");

  const [, pickDir] = panel.app.querySelectorAll("input").filter((input) => input.attributes.type === "file");
  assert.equal(pickDir.attributes.webkitdirectory, "", "a whole folder can be chosen too");
  pickDir.files = [{ name: "a.html", size: 3, webkitRelativePath: "bozze/a.html" }, { name: "HEAD", size: 1, webkitRelativePath: "bozze/.git/HEAD" }, { name: "b.css", size: 4, webkitRelativePath: "bozze/css/b.css" }];
  pickDir.dispatch("change");
  await settle();
  const blobs = calls.filter((call) => call.path.endsWith("/blobs"));
  assert.equal(blobs.length, 2, "what a repository keeps for itself stays behind");
  assert.ok(blobs.every((call) => call.method === "POST"));
  const commit = calls.find((call) => call.path.endsWith("/upload"));
  assert.deepEqual(JSON.parse(commit.body), { dir: "chi-siamo", base: head.id, files: [{ path: "bozze/a.html", sha: sha("1") }, { path: "bozze/css/b.css", sha: sha("2") }] });
  assert.match(panel.app.querySelector(".art-tree").textContent, /img\//, "published at once, the folder is drawn again where it was");

  status = "proposed";
  await panel.navigate("#/artefatti/af_000000000001/file");
  await settle();
  assert.deepEqual(panel.app.querySelector(".art-tree").children.map((row) => row.textContent), ["chi-siamo/2 file", "css/1 file", "index.html10 B"]);
  assert.equal(panel.app.querySelector(".art-drop-where").textContent, "clienti/acme/sito/");
  const big = panel.app.querySelectorAll("input").find((input) => input.attributes.type === "file" && input.attributes.webkitdirectory === undefined);
  big.files = [{ name: "video.mov", size: 200 * 1024 * 1024 }];
  big.dispatch("change");
  await settle();
  assert.match(panel.run(`document.querySelector(".toast")?.textContent || ""`), /video\.mov supera i 100 MB/);
  const small = panel.app.querySelectorAll("input").find((input) => input.attributes.type === "file" && input.attributes.webkitdirectory === undefined);
  small.files = [{ name: "nota.txt", size: 2 }];
  small.dispatch("change");
  await settle();
  assert.equal(JSON.parse(calls.filter((call) => call.path.endsWith("/upload")).at(-1).body).dir, "", "at the folder's root the files go to its root");
  assert.equal(panel.run("location.hash"), "#/artefatti/af_000000000001/c/ac_00000000000a", "a proposal opens its review");
});

test("a new link's access starts with the team in; an edited link keeps what it had", () => {
  const panel = panelHarness({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.deepEqual(JSON.parse(panel.run("JSON.stringify(shareAccessPicker({}).value())")), { mode: "people", emails: "", domains: "", members: true });
  assert.equal(JSON.parse(panel.run(`JSON.stringify(shareAccessPicker({ mode: "people", emails: ["giulia@cliente.it"], domains: [], members: false }).value())`)).members, false);
  assert.equal(JSON.parse(panel.run(`JSON.stringify(shareAccessPicker({ mode: "people", emails: [], domains: ["cliente.it"], members: true }).value())`)).domains, "cliente.it");
});

test("Artefatti, Registro: who opened, viewed and downloaded what through the links, beside the changes, filtered by kind", async () => {
  const at = Date.parse("2026-11-05T09:00:00Z");
  const folder = { id: "af_000000000001", path: "condivisi/materiali", title: "Materiali", description: "", kind: "files", policy: "review", head: "ac_000000000009", writers: ["*"], reviewers: [] };
  const commit = { id: "ac_000000000009", short: "0000000", folderId: folder.id, message: "Report di ottobre", author: { kind: "agent", id: "ag_x", name: "Nico" }, status: "published", createdAt: at - 60000, publishedAt: at - 30000, review: { by: { kind: "user", name: "Ada" }, at: at - 30000, decision: "approve" }, files: 1, bytes: 10, changes: { added: 1, modified: 0, deleted: 0 } };
  const events = [
    { id: 5, kind: "download", path: "docs/report.pdf", label: "materiali", shareId: "as_000000000001", at: at + 5000, who: { email: "giulia@cliente.it", via: "google", visitor: "abc123", device: "Chrome · macOS" } },
    { id: 4, kind: "view", path: "docs/report.pdf", label: "materiali", shareId: "as_000000000001", at: at + 4000, who: { email: "", via: "public", visitor: "x1y2z3", device: "Safari · iOS" } },
    { id: 3, kind: "download", path: "docs/", detail: "zip", label: "materiali", shareId: "as_000000000001", at: at + 3000, who: { email: "", via: "public", visitor: "x1y2z3", device: "Safari · iOS" } },
    { id: 2, kind: "refused", detail: "password", label: "chiusa", shareId: "as_000000000002", at: at + 2000, who: { email: "", via: "", visitor: "p4ss00", device: "Firefox · Windows" } },
    { id: 1, kind: "share", action: "created", mode: "public", by: { kind: "user", name: "Ada" }, label: "materiali", shareId: "as_000000000001", at },
  ];
  const data = { folder, canReview: true, canManage: true, shareHosting: true, shareSuffix: "--acme.usecora.space", commits: [commit], tree: [], activity: {},
    shares: [{ id: "as_000000000001", label: "materiali", status: "active", view: "files", access: { mode: "public" } }, { id: "as_000000000002", label: "chiusa", status: "active", view: "files", access: { mode: "password" } }] };
  const asked = [];
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  const panel = panelHarness({ fetch: async (path) => {
    asked.push(path);
    if (path === `/api/artifacts/folders/${folder.id}`) return reply(data);
    if (path.startsWith(`/api/artifacts/folders/${folder.id}/events`)) return reply({ events: path.includes("share=as_000000000002") ? events.filter((event) => event.shareId === "as_000000000002") : events });
    return reply({});
  } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], artifacts: { reviews: 0 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await panel.navigate(`#/artefatti/${folder.id}/registro`);
  await settle();
  assert.deepEqual(panel.app.querySelector(".tabs").querySelectorAll("a").map((tab) => tab.attributes.href.split("/").at(-1)), ["file", "commit", "condivisione", "registro", "permessi"]);
  const lines = () => panel.app.querySelectorAll(".log-row").map((row) => row.querySelector(".log-text").children[0].textContent);
  assert.deepEqual(lines(), [
    "giulia@cliente.it ha scaricato docs/report.pdf",
    "Visitatore x1y2z3 ha visto docs/report.pdf",
    "Visitatore x1y2z3 ha scaricato tutta la cartella docs/",
    "Visitatore p4ss00 ha sbagliato la password",
    "Ada ha creato il link materiali · pubblico",
    "Ada ha pubblicato Report di ottobre",
    "Nico ha proposto Report di ottobre",
  ], "newest first, the links' log and the folder's changes together");
  assert.equal(panel.app.querySelectorAll(".log-row")[1].querySelector("small").textContent, "Safari · iOS · materiali", "the browser that did it, and through which link");
  const filters = panel.app.querySelector(".log-filters").querySelectorAll("button");
  const downloads = filters.find((button) => button.textContent === "Download");
  downloads.dispatch("click", { currentTarget: downloads });
  assert.deepEqual(lines(), ["giulia@cliente.it ha scaricato docs/report.pdf", "Visitatore x1y2z3 ha scaricato tutta la cartella docs/"]);
  const links = panel.app.querySelector(".log-tools").querySelector("select");
  links.value = "as_000000000002";
  links.dispatch("change");
  await settle();
  assert.ok(asked.some((path) => path.includes("share=as_000000000002")), "one link's log is asked for that link");
  const all = filters.find((button) => button.textContent === "Tutto");
  all.dispatch("click", { currentTarget: all });
  assert.deepEqual(lines(), ["Visitatore p4ss00 ha sbagliato la password"], "and the folder's own changes step aside");
});

test("Impostazioni → Spazio: how much the artifacts take, half the disk by default, a limit of the owner's", async () => {
  const gb = 1024 ** 3;
  const sent = [];
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    if (path === "/api/settings") { sent.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ artifactQuotaGb: JSON.parse(options.body).artifactQuotaGb }) }; }
    if (path === "/api/artifacts") return { ok: true, status: 200, json: async () => ({ quota: { used: 2 * gb, limit: 50 * gb, custom: true, disk: { total: 400 * gb, free: 230 * gb } } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  panel.run(`S.data = { agents: [], settings: {}, artifacts: { reviews: 0, space: { used: ${2 * gb}, limit: ${200 * gb}, custom: false, disk: { total: ${400 * gb}, free: ${232 * gb} } } } }`);
  panel.run("app.replaceChildren(artifactSpacePanel())");
  const text = () => panel.app.querySelector(".space-summary").textContent;
  assert.match(text(), /2 GB.*occupati dagli artefatti, di 200 GB.*232 GB.*liberi sul disco, di 400 GB/);
  const [half, own] = panel.app.querySelector(".segmented").querySelectorAll("button");
  assert.equal(half.textContent, "Metà del disco · 200 GB");
  assert.equal(half.className, "on");
  own.dispatch("click", { currentTarget: own });
  const amount = panel.app.querySelector(".space-custom").querySelector("input");
  assert.equal(amount.value, 200, "the field starts from the limit in force");
  amount.value = "50";
  amount.dispatch("change");
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [{ artifactQuotaGb: 50 }]);
  assert.match(text(), /di 50 GB/, "the summary follows what was saved");
  half.dispatch("click", { currentTarget: half });
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent.at(-1), { artifactQuotaGb: 0 }, "back to half the disk");
});

test("Artefatti, File: a new subfolder to upload into, a way back, CSV as a table and a PDF framed from apart", async () => {
  const at = Date.parse("2026-11-05T09:00:00Z");
  const head = { id: "ac_000000000009", short: "0000000", folderId: "af_000000000001", message: "CRM", author: { kind: "user", id: "u1", name: "Ada" }, status: "published", createdAt: at, publishedAt: at, files: 2, bytes: 30, changes: { added: 2, modified: 0, deleted: 0 } };
  const data = {
    folder: { id: "af_000000000001", path: "clienti/crm", title: "CRM", description: "", kind: "files", policy: "review", head: head.id, writers: ["*"], reviewers: [] },
    canReview: true, canManage: true, shareHosting: true, shareSuffix: "--acme.usecora.space", shares: [], commits: [head], activity: {},
    tree: [{ path: "crm/clienti.csv", sha: "a".repeat(64), size: 20 }, { path: "crm/contratto.pdf", sha: "b".repeat(64), size: 10 }],
  };
  const panel = panelHarness({ fetch: async (path) => {
    if (path === "/api/artifacts/folders/af_000000000001") return { ok: true, status: 200, json: async () => data };
    if (path.startsWith("/api/artifacts/commits/ac_000000000009/view?")) return { ok: true, status: 200, json: async () => ({ url: "https://r-000000000009--acme.usecora.space/crm/contratto.pdf?t=1.x" }) };
    if (path.includes("/files/crm/clienti.csv")) return { ok: true, status: 200, headers: { get: () => "text/plain; charset=utf-8" }, text: async () => 'nome;città;fatturato\\n"Rossi; Bianchi";Ragusa;1200\\nVerdi;Modica;980\\n' };
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], artifacts: { reviews: 0 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await panel.navigate("#/artefatti/af_000000000001/file/crm");
  await settle();
  assert.equal(panel.app.querySelector(".art-back").attributes.href, "#/artefatti/af_000000000001/file", "a way back up one level, on the page itself");
  assert.equal(panel.app.querySelector(".art-back").textContent, "CRM");
  const create = panel.app.querySelector(".art-drop").querySelectorAll("button").find((button) => button.textContent === "Nuova cartella");
  create.click();
  const form = panel.app.querySelector(".art-newdir");
  form.querySelector("input").value = "  2026 / novembre ";
  form.dispatch("submit");
  assert.equal(panel.run("location.hash"), "#/artefatti/af_000000000001/file/crm/2026/novembre", "a new folder is a place to go and upload into");
  await panel.navigate("#/artefatti/af_000000000001/file/crm/2026/novembre");
  await settle();
  assert.match(panel.app.querySelector(".art-tree").textContent, /Cartella nuova: esiste quando ci carichi i primi file/);
  assert.equal(panel.app.querySelector(".art-drop-where").textContent, "clienti/crm/crm/2026/novembre/");
  form.querySelector("input").value = "../fuori";
  form.dispatch("submit");
  assert.match(panel.run(`document.querySelector(".toast")?.textContent || ""`), /niente \. o \.\./);

  const table = panel.run(`artifactTable('nome;città;fatturato\\n"Rossi; Bianchi";Ragusa;1200\\n"Verdi\\nsu due righe";Modica;980\\n')`);
  assert.deepEqual(table.querySelectorAll("th").map((cell) => cell.textContent), ["nome", "città", "fatturato"], "the separator is guessed from the first line");
  assert.deepEqual(table.querySelectorAll("tr").slice(1).map((row) => row.querySelectorAll("td").map((cell) => cell.textContent)), [["Rossi; Bianchi", "Ragusa", "1200"], ["Verdi\nsu due righe", "Modica", "980"]], "quoted cells keep their separators and their lines");
  assert.equal(table.querySelector(".num").textContent, "1200");
  assert.match(table.textContent, /2 righe$/, "records are counted, not lines");
  const shown = await panel.run(`artifactPreview("/api/artifacts/commits/ac_000000000009/files/crm/contratto.pdf", "crm/contratto.pdf", 10)`);
  const frame = shown.find((node) => node?.tagName === "iframe");
  assert.equal(frame.attributes.src, "https://r-000000000009--acme.usecora.space/crm/contratto.pdf?t=1.x", "a PDF is framed from the space's preview host");
  assert.equal(frame.attributes.referrerpolicy, "no-referrer");
});

test("Artefatti, a file's preview: CSV round trips through the editor, Markdown renders, and a save is a commit", async () => {
  const sent = [];
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    if (path.endsWith("/blobs")) { sent.push({ path, body: options.body }); return { ok: true, status: 201, json: async () => ({ sha: "c".repeat(64), size: 10 }) }; }
    if (path.endsWith("/upload")) { sent.push({ path, body: JSON.parse(options.body) }); return { ok: true, status: 201, json: async () => ({ commit: { id: "ac_00000000000b", status: "published", message: "Modificato clienti.csv" } }) }; }
    if (path.includes("/files/note.md")) return { ok: true, status: 200, headers: { get: () => "text/plain; charset=utf-8" }, text: async () => "# Titolo\n\nUn **punto**.\n" };
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  const csv = 'nome;note\r\n"Rossi; Bianchi";"riga ""citata""\ne a capo"\r\nVerdi;\r\n';
  const parsed = JSON.parse(panel.run(`JSON.stringify(parseCsv(${JSON.stringify(csv)}))`));
  assert.deepEqual(parsed, { sep: ";", rows: [["nome", "note"], ["Rossi; Bianchi", "riga \"citata\"\ne a capo"], ["Verdi", ""]], crlf: true });
  assert.equal(panel.run(`csvText(${JSON.stringify(parsed.rows)}, ";", true)`), csv, "written back exactly as it was read");

  const saved = [];
  panel.run(`window.savedCsv = []`);
  const editor = panel.run(`csvEditor(${JSON.stringify(csv)}, "", { onSave: async (text, message) => { window.savedCsv.push([text, message]); return true; }, onCancel() {} })`);
  const cells = editor.querySelectorAll("textarea");
  assert.deepEqual(cells.map((cell) => cell.value), ["nome", "note", "Rossi; Bianchi", "riga \"citata\"\ne a capo", "Verdi", ""]);
  cells[5].value = "nuovo";
  cells[5].dispatch("input");
  editor.querySelectorAll("button").find((button) => button.textContent === "Aggiungi riga").click();
  editor.querySelectorAll("button").find((button) => button.textContent === "Salva").click();
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
  saved.push(...panel.run("window.savedCsv"));
  assert.equal(saved[0][0], 'nome;note\r\n"Rossi; Bianchi";"riga ""citata""\ne a capo"\r\nVerdi;nuovo\r\n;\r\n', "the edit, a new row, its separator and line ends");

  const shown = await panel.run(`artifactPreview("/api/artifacts/commits/ac_000000000009/files/note.md", "note.md", 30, { folder: { id: "af_000000000001" }, head: { id: "ac_000000000009" }, canReview: true, onSaved() {} })`);
  const body = shown.find((node) => node?.className?.includes("art-md"));
  assert.equal(body.querySelector("h3")?.textContent || body.querySelector("h1")?.textContent || "", "Titolo", "Markdown shows as Markdown");
  assert.equal(body.querySelector("strong").textContent, "punto");
  assert.ok(shown[0].querySelectorAll("button").some((button) => button.textContent === "Modifica"), "a text has its editor");
  assert.equal(sent.length, 0);
  const result = await panel.run(`saveArtifactText({ folder: { id: "af_000000000001" }, head: { id: "ac_000000000009" }, path: "crm/clienti.csv", text: "a;b\\n", message: "" })`);
  assert.equal(result.commit.status, "published");
  assert.deepEqual(sent.at(-1), { path: "/api/artifacts/folders/af_000000000001/upload", body: { base: "ac_000000000009", files: [{ path: "crm/clienti.csv", sha: "c".repeat(64) }], message: "Modificato clienti.csv" } }, "a save is an upload over the version that was open");
});

test("Nuova cartella: where it goes is chosen a level at a time, among the groups that exist, and its name follows its title", () => {
  const panel = panelHarness({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  panel.run(`window.picker = folderPathPicker([{ path: "clienti/acme/sito" }, { path: "clienti/acme/report" }, { path: "clienti/rossi/crm" }, { path: "comunicati" }])`);
  panel.run("app.replaceChildren(window.picker.node)");
  const status = () => panel.app.querySelector(".path-status").textContent;
  assert.match(status(), /…Dai un nome alla cartella/);
  panel.run(`window.picker.fromTitle("Offerta Città 2027")`);
  assert.equal(panel.run("window.picker.value()"), "offerta-citta-2027", "the name follows the title, accents and spaces made plain");
  const chip = () => panel.app.querySelectorAll(".path-chip").at(-1);
  chip().click();
  assert.deepEqual(panel.app.querySelectorAll(".path-option").map((option) => option.textContent), ["clienti3 cartelle"], "only groups are offered: comunicati is a folder");
  panel.app.querySelector(".path-option").click();
  chip().click();
  assert.deepEqual(panel.app.querySelectorAll(".path-option").map((option) => option.textContent), ["acme2 cartelle", "rossi1 cartella"]);
  panel.app.querySelectorAll(".path-option")[0].click();
  assert.equal(panel.run("window.picker.value()"), "clienti/acme/offerta-citta-2027");
  assert.match(status(), /clienti\/acme\/offerta-citta-2027$/);
  const leaf = panel.app.querySelector(".path-leaf");
  leaf.value = "Sito";
  leaf.dispatch("input");
  assert.equal(panel.run("window.picker.problem()"), "C'è già una cartella clienti/acme/sito");
  panel.run(`window.picker.fromTitle("Altro titolo")`);
  assert.equal(panel.run("window.picker.value()"), "clienti/acme/sito", "once written by hand, the name stays");
  chip().click();
  const fresh = panel.app.querySelector(".path-new").querySelector("input");
  fresh.value = "Preventivi 2027";
  panel.app.querySelector(".path-new").querySelectorAll("button")[0].click();
  assert.equal(panel.run("window.picker.value()"), "clienti/acme/preventivi-2027/sito", "a new group at any level");
  panel.app.querySelectorAll(".path-chip")[1].click();
  panel.app.querySelector(".path-menu").querySelectorAll("button").find((button) => button.textContent === "Togli questo livello").click();
  assert.equal(panel.run("window.picker.value()"), "clienti/sito", "taking a level away takes those under it too");
});

test("Artefatti, a subfolder: its own name on top, the way up, and links that start from it", async () => {
  const at = Date.parse("2026-11-05T09:00:00Z");
  const head = { id: "ac_000000000009", short: "0000000", folderId: "af_000000000001", message: "design", author: { kind: "agent", id: "ag_x", name: "Sarax" }, status: "published", createdAt: at, publishedAt: at, files: 3, bytes: 30, changes: { added: 3, modified: 0, deleted: 0 } };
  const data = {
    folder: { id: "af_000000000001", path: "progetti/cora/design", title: "design", description: "Il design di Cora", kind: "files", policy: "direct", head: head.id, writers: ["*"], reviewers: [] },
    canReview: true, canManage: true, shareHosting: true, shareSuffix: "--notseb.usecora.space", shares: [], commits: [head], activity: {},
    tree: [{ path: "design-system/README.md", sha: "a".repeat(64), size: 10 }, { path: "landing/index.html", sha: "b".repeat(64), size: 10 }, { path: "landing/vendor/react.js", sha: "c".repeat(64), size: 10 }],
  };
  const posted = [];
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    if (options.method === "POST") posted.push({ path, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => (path === "/api/artifacts/folders/af_000000000001" ? data : { id: "as_1", url: "https://landing--notseb.usecora.space/" }) };
  } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], artifacts: { reviews: 0 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await panel.navigate("#/artefatti/af_000000000001/file/landing");
  await settle();
  assert.equal(panel.app.querySelector(".page-title").querySelector("h1").textContent, "landing", "inside a subfolder the page is that subfolder's");
  assert.equal(panel.app.querySelector(".art-back").textContent, "design");
  assert.match(panel.app.querySelector(".art-head-meta").textContent, /progetti\/cora\/design\/landing.*Cartella/);
  const tabs = panel.app.querySelector(".tabs").querySelectorAll("a").map((tab) => tab.attributes.href);
  assert.ok(tabs.includes("#/artefatti/af_000000000001/condivisione?in=landing"), "the level goes along to the other tabs");
  const share = panel.app.querySelector(".art-drop").querySelectorAll("a").find((link) => link.textContent === "Condividi questa cartella");
  assert.equal(share.attributes.href, "#/artefatti/af_000000000001/condivisione?in=landing");

  panel.run(`location.hash = "#/artefatti/af_000000000001/condivisione?in=landing"`);
  await panel.navigate("#/artefatti/af_000000000001/condivisione?in=landing");
  await settle();
  const picker = panel.app.querySelector(".share-new").querySelector(".path-picker");
  assert.deepEqual(picker.querySelectorAll(".path-chip").map((chip) => chip.textContent), ["Tutta la cartella", "landing", "una sottocartella"], "the link starts from where you were");
  assert.match(picker.querySelector(".path-status").textContent, /landing\/2 file/);
  const form = panel.app.querySelector(".share-new");
  form.querySelectorAll("input").find((input) => input.attributes.name === "label").value = "landing";
  form.dispatch("submit");
  await settle();
  assert.equal(posted[0].path, "/api/artifacts/folders/af_000000000001/shares");
  assert.equal(posted[0].body.root, "landing");
});

test("Artefatti, a web page: shown as the site, its source a switch away; a file and a subfolder can be deleted", async () => {
  const at = Date.parse("2026-11-05T09:00:00Z");
  const head = { id: "ac_000000000009", short: "0000000", folderId: "af_000000000001", message: "design", author: { kind: "agent", id: "ag_x", name: "Sarax" }, status: "published", createdAt: at, publishedAt: at, files: 2, bytes: 20, changes: { added: 2, modified: 0, deleted: 0 } };
  const data = {
    folder: { id: "af_000000000001", path: "progetti/design", title: "design", description: "", kind: "files", policy: "review", head: head.id, writers: ["*"], reviewers: [] },
    canReview: true, canManage: true, shareHosting: true, shareSuffix: "--acme.usecora.space", shares: [], commits: [head], activity: {},
    tree: [{ path: "landing/index.html", sha: "a".repeat(64), size: 10 }, { path: "landing/style.css", sha: "b".repeat(64), size: 10 }],
  };
  const posted = [];
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    if (options.method === "POST") {
      posted.push({ path, body: JSON.parse(options.body) });
      return { ok: true, status: 201, json: async () => ({ commit: { id: "ac_00000000000c", status: "published", message: "Eliminata la cartella landing" } }) };
    }
    if (path === "/api/artifacts/folders/af_000000000001") return { ok: true, status: 200, json: async () => data };
    if (path.startsWith("/api/artifacts/commits/ac_000000000009/view?")) return { ok: true, status: 200, json: async () => ({ url: "https://r-000000000009--acme.usecora.space/_t/1.x/landing/index.html" }) };
    if (path.includes("/files/landing/index.html")) return { ok: true, status: 200, headers: { get: () => "text/plain; charset=utf-8" }, text: async () => "<h1>Landing</h1>\n<p>ciao</p>" };
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  panel.run(`transportInfo = () => ({ icon: "radio", label: "Discord", where: "test", state: "ready" })`);
  panel.run(`S.data = { agents: [], artifacts: { reviews: 0 }, currentUser: { id: "u1", name: "Ada", email: "", role: "owner", avatar: "" } }`);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  panel.run(`window.removed = []`);
  const shown = await panel.run(`artifactPreview("/api/artifacts/commits/ac_000000000009/files/landing/index.html", "landing/index.html", 30, { folder: { id: "af_000000000001" }, head: { id: "ac_000000000009" }, canReview: true, onSaved() {}, onRemove: (path) => window.removed.push(path) })`);
  const [top, body] = shown;
  const frame = body.querySelector("iframe");
  assert.equal(frame.attributes.src, "https://r-000000000009--acme.usecora.space/_t/1.x/landing/index.html", "the page runs on the preview host, apart from the panel");
  assert.equal(frame.attributes.sandbox, "allow-scripts allow-same-origin allow-forms allow-popups allow-modals", "and it cannot steer the panel's tab");
  const modes = top.querySelector(".art-modes").querySelectorAll("button");
  assert.deepEqual(modes.map((button) => button.textContent), ["Anteprima", "Codice sorgente"]);
  modes[1].click();
  await settle();
  assert.equal(body.querySelector("iframe"), null);
  assert.deepEqual(body.querySelectorAll(".art-line").map((line) => line.textContent), ["1<h1>Landing</h1>", "2<p>ciao</p>"], "the source with its line numbers");
  assert.equal(modes[1].attributes["aria-selected"], "true");
  modes[0].click();
  await settle();
  assert.equal(body.querySelector("iframe"), frame, "back to the same page, not reloaded");

  const remove = top.querySelectorAll("button").find((button) => button.textContent === "Elimina");
  remove.click();
  assert.equal(remove.textContent, "Elimina davvero", "a first click only arms it");
  remove.click();
  await settle();
  assert.deepEqual(JSON.parse(panel.run("JSON.stringify(window.removed)")), ["landing/index.html"]);

  await panel.navigate("#/artefatti/af_000000000001/file/landing");
  await settle();
  const folderButton = panel.app.querySelector(".art-drop").querySelectorAll("button").find((button) => button.textContent === "Elimina questa cartella");
  folderButton.click();
  folderButton.click();
  await settle();
  assert.deepEqual(posted[0], { path: "/api/artifacts/folders/af_000000000001/remove", body: { base: "ac_000000000009", paths: ["landing"] } });
  assert.equal(panel.run("location.hash"), "#/artefatti/af_000000000001/file", "and back to where what is left is");
});
