import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asksToStop, claimsWork, cleanReply, deliveryNote } from "../src/brain.js";
import { Discord, splitMessage } from "../src/discord.js";
import { LLM } from "../src/llm.js";
import { toMrkdwn } from "../src/slack.js";
import { mentions } from "../src/orchestrator.js";
import { cronMatches, nextRuns, parseCron, zonedParts } from "../src/scheduler.js";
import { SHARED, Store, ftsQuery } from "../src/store.js";
import { Traces } from "../src/traces.js";
import { tempHome } from "./helpers.js";

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
  });
});

describe("text helpers", () => {
  test("mentions match names as words, accents and case aside", () => {
    assert.ok(mentions("ciao Bea, come va?", "Bea"));
    assert.ok(mentions("@marta ci sei", "Marta"));
    assert.ok(mentions("Niccolò dove sei", "Niccolo"));
    assert.ok(!mentions("beato te", "Bea"));
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
    assert.throws(() => store.createAgent({ name: "x", avatarUrl: "http://insecure" }), (error) => error.status === 400);
    store.close();
  });
});
