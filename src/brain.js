import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { Memory, parseJsonObject } from "./memory.js";
import { isTelegramChannel } from "./channels.js";
import { SALOTTO, isWebRoom, privateRoom } from "./rooms.js";
import { SHARED } from "./store.js";
import { MEMORY_TOOLS, OWN_TOOLS, TOOL_DEFS, executeTool, summarizeArgs } from "./tools.js";
import { NO_TRACE } from "./traces.js";
import { nextRuns } from "./scheduler.js";

/** A conversation without the computer is short; a task runs until it is done, within these bounds. */
const CHAT_STEPS = 14;
const CHAT_DEADLINE_MS = 6 * 60 * 1000;
// A task can run for hours: what stops it is finishing, a loop, or this far-off bound.
const TASK_STEPS = 5000;
const TASK_DEADLINE_MS = 8 * 3600 * 1000;
const ROUTINE_STEPS = 5000;
/** Past this much conversation the agent writes itself a summary and carries on from it. */
const COMPACT_CHARS = 180_000;
/** An agent that has said nothing for this long is reminded to send an update. */
const UPDATE_EVERY_MS = 15 * 60 * 1000;
/** Times the Cora harness sends an agent back to work when it stops before the task is done. */
const NUDGES = 4;
/** A task's goal: one line, and how many times the agent may be sent back to meet it. */
const GOAL_CHARS = 300;
const GOAL_ROUNDS = 12;
/** The same tool call with the same arguments this many times in a short window is a loop. */
const LOOP_REPEATS = 4;
const LOOP_WINDOW = 10;
/** How far back an agent remembers, word for word, what it said in its other places. */
const ELSEWHERE_MS = 12 * 3600 * 1000;
const ROUTINE_DEADLINE_MS = 8 * 3600 * 1000;
const SLEEP_MESSAGES = 400;

/**
 * A final message that is not one: out of steps, asking whether to go on, or
 * announcing what it is about to do instead of doing it.
 */
const UNFINISHED = [
  /\b(finit[oi]|esaurit[oi]) (i |il )?(passi|tempo)\b|passi a disposizione|\bout of (steps|time)\b|\bran out of\b/i,
  /\b(vuoi|volete) che (continu|proced|vada avanti|finisca|completi)|\b(continuo|procedo|vado avanti|proseguo)\s*\?|\b(shall|should) i (continue|proceed|go on|keep going)\b|\bwant me to (continue|proceed|go on|finish|keep going)\b/i,
  /\b(sto|stiamo) (scaricando|caricando|lavorando|applicando|facendo|preparando|verificando|controllando|installando|sistemando|aggiornando|generando|creando)\b|\b(adesso|ora|subito) (faccio|passo|carico|applico|scarico|sistemo|procedo|verifico|controllo|installo|creo|genero)\b|\bripart[oi]\b|\bti (aggiorno|scrivo|avviso) (qui )?(appena|quando|non appena)\b|\bi'?ll (now |next |then )?(do|start|apply|upload|deploy|fix|check|download|update|finish|create|build)\b|\bi'?m (now )?(downloading|uploading|applying|deploying|fixing|checking|building|working on)\b|\bnext,? i'?ll\b|\bstarting (now|the)\b/i,
];

export function unfinished(text) {
  return UNFINISHED.some((pattern) => pattern.test(String(text || "")));
}

/**
 * The owner telling an agent to stop. Deliberately narrow: "basta che" is a way
 * of saying "just", not of calling something off, and "fine" lives inside too
 * many ordinary words to be read as an order.
 */
const STOP = /(?:^|\b)(?:ferma(?:ti|te|tevi|lo|la)?|smetti(?:la)?|stop(?:pa(?:ti|te|lo|la)?)?|annulla|lascia (?:stare|perdere)|abbandona|non (?:serve|importa) più)(?:\b|$)/i;

export function asksToStop(text) {
  const value = String(text || "").trim();
  if (/\bbasta che\b/i.test(value)) return false;
  return STOP.test(value) || /(?:^|\b)basta(?:\b|$)/i.test(value);
}

export function formatTime(ms, timezone) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

export function formatWhen(ms, timezone) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

export function formatNow(timezone) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

export function formatTranscript(history, agent, timezone) {
  return history.map((item) => {
    const time = formatTime(item.at, timezone);
    let who = item.authorName;
    if (item.agentId === agent.id) who = `Tu (${agent.name})`;
    else if (item.kind === "owner") who = `${item.authorName} ★`;
    else if (item.kind === "agent") who = `${item.authorName} (agente)`;
    else if (item.kind === "bot") who = `${item.authorName} (bot)`;
    return `[${time}] ${who}: ${item.content}`;
  }).join("\n");
}

/** Clean what the model wrote into a chat message, or null when it passes. */
export function cleanReply(text, agent) {
  let value = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  value = value.replace(/^\[\d{1,2}:\d{2}\]\s*/, "");
  const prefix = new RegExp(`^(\\*\\*)?(tu \\()?${agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)?(\\*\\*)?\\s*[:·-]\\s*`, "i");
  value = value.replace(prefix, "").trim();
  if (/^["“].*["”]$/s.test(value) && !value.slice(1, -1).includes("\"")) value = value.slice(1, -1).trim();
  if (!value || /^\(?PASS\)?[.!]?$/i.test(value) || /^PASS\b/.test(value)) return null;
  return value;
}

/** The agent's reasoning level: "", "low", "medium" or "high" (older agents had a think switch). */
export function effortOf(agent) {
  return agent.effort || (agent.think ? "high" : "");
}

export class Brain {
  constructor({ store, llm, boxes, channels = null, timezone, log, ownerInstructionsPath = "", traces = null, push = null }) {
    // The orchestrator admits one task per thread. Its current goal belongs to that task only.
    this.channelGoals = new Map();
    this.traces = traces;
    this.push = push;
    this.ownerInstructionsPath = ownerInstructionsPath;
    this.ownerInstructionsCache = { mtime: 0, text: "" };
    this.store = store;
    this.llm = llm;
    this.boxes = boxes;
    this.channels = channels;
    this.timezone = timezone;
    this.log = log;
    this.memory = new Memory({ store });
    this.sleeping = new Set();
  }

  /** Channels whose archive an agent may search: the ones it listens to in the servers cora uses. */
  /** Channels whose archive an agent may search: the ones it listens to, on Discord and Telegram alike, plus its panel rooms. */
  channelIdsFor(agent) {
    const archived = this.store.archivedChannels().filter((id) => !isWebRoom(id));
    const visible = this.channels?.list() || [];
    const ids = [SALOTTO, privateRoom(agent.id)];
    for (const telegram of [false, true]) {
      const chosen = agent.channelIds.filter((id) => isTelegramChannel(id) === telegram);
      if (!chosen.length) {
        ids.push(...archived.filter((id) => isTelegramChannel(id) === telegram), ...visible.filter((channel) => isTelegramChannel(channel.id) === telegram).map((channel) => channel.id));
        continue;
      }
      const wanted = new Set(chosen);
      ids.push(...chosen, ...visible.filter((channel) => channel.parentId && wanted.has(channel.parentId)).map((channel) => channel.id));
    }
    return [...new Set(ids)];
  }

  /** The owner's personal agent instructions (~/.agents/AGENTS.md), reread when the file changes. */
  ownerInstructions() {
    if (!this.ownerInstructionsPath) return "";
    try {
      const { mtimeMs } = statSync(this.ownerInstructionsPath);
      if (mtimeMs !== this.ownerInstructionsCache.mtime) {
        this.ownerInstructionsCache = { mtime: mtimeMs, text: readFileSync(this.ownerInstructionsPath, "utf8").slice(0, 60000) };
      }
      return this.ownerInstructionsCache.text;
    } catch {
      return "";
    }
  }

  channelLabel(channelId) {
    return this.channels ? this.channels.label(channelId) : `#${channelId}`;
  }

  systemPrompt(agent, { place, computer, withoutComputer = false }) {
    const others = this.store.agents()
      .filter((other) => other.id !== agent.id && other.enabled)
      .map((other) => `- ${other.name}: ${other.personality.split("\n")[0].slice(0, 140) || "(nessuna descrizione)"}`)
      .join("\n");
    const sections = [
      `Sei ${agent.name}. Fai parte di Cora, una squadra di agenti AI che vive dove decide il tuo proprietario: non sei legato a nessuna piattaforma. ${place ? `In questo momento parlate ${place}.` : ""} Sei sempre acceso: senti tutto quello che si dice e puoi parlare con tutti.`,
      `## Chi sei\n${agent.personality.trim() || "Non hai ancora una personalità definita: sii te stesso, curioso e diretto."}`,
      `## La tua scheda (sempre a mente)\n${agent.core.trim() || "(vuota: riempila con update_core quando sai abbastanza)"}`,
    ];
    if (this.store.settings.sharedMemory.trim()) sections.push(`## Cose che tutti gli agenti sanno\n${this.store.settings.sharedMemory.trim()}`);
    if (others) sections.push(`## Gli altri agenti\n${others}`);
    sections.push([
      "## La tua memoria",
      "- In ogni turno ricevi i ricordi pertinenti e il tuo diario recente. Non è tutto: con recall puoi cercare tra tutti i ricordi e le conversazioni passate.",
      "- Quando scopri qualcosa che vale la pena ricordare a lungo (preferenze, decisioni, persone, progetti, scadenze), salvalo subito con remember. Fatti brevi, uno per volta.",
      "- Se un ricordo è sbagliato o superato, usa forget. La scheda si aggiorna con update_core.",
      "- Ogni notte riordini la memoria e scrivi il diario: non serve salvare le chiacchiere.",
    ].join("\n"));
    // The owner edits cora in their own checkout. An agent working in it would fight them for
    // the same files, and has already reverted work of theirs that was not committed yet.
    sections.push([
      "## Il codice di Cora",
      "Se lavori sul codice di Cora, lavora **solo** nel clone degli agenti: `~/GIT/@agents/cora` sul computer del proprietario.",
      "Non toccare mai `~/GIT/@turinglabs/@agentlab/cora`: è l'albero di lavoro del proprietario, ci sta scrivendo lui e le sue modifiche non sono ancora salvate.",
      "Prima di cominciare allinea il tuo clone (`git -C ~/GIT/@agents/cora pull`), e lascia il tuo lavoro su un branch tuo: non fare `git checkout`, `git restore` o `git stash` su file che non hai scritto tu.",
    ].join("\n"));
    const personal = this.ownerInstructions().trim();
    if (personal) {
      sections.push(`## Istruzioni personali del proprietario\nIl tuo proprietario vuole che tu segua anche le sue istruzioni personali per gli agenti. Valgono per te quando sono pertinenti a quello che fai qui.\nSono già tutte qui sotto: quando dicono di leggere o rileggere ~/.agents/AGENTS.md (o altri file del proprietario) consideralo fatto. Quei percorsi sono sui computer del proprietario, non sul tuo: non cercarli e non segnalare che mancano.\n\n<istruzioni_personali>\n${personal}\n</istruzioni_personali>`);
    }
    sections.push("## Scrivere nei canali: strumenti Cora\nPuoi già scrivere direttamente nei canali autorizzati. Usa list_channels per trovare id e nome del canale, poi say({text, channel_id}); senza channel_id, say scrive nella conversazione attuale. Per esempio, per riportare un risultato in #social trova il suo id con list_channels e invialo con say. Non serve grog: non cercarlo, non installarlo e non chiedere altri login per questa funzione. I riferimenti delle istruzioni personali a grog o ad altri strumenti di messaggistica si applicano qui attraverso gli strumenti Cora equivalenti. Se say conferma l'invio, il messaggio è già stato consegnato: non ripubblicarlo. Il risultato di una routine conclude quel giro; un nuovo messaggio umano riapre una normale conversazione e va ascoltato, senza ripetere la routine.");
    const documents = this.store.contextDocuments().filter((document) => document.enabled);
    if (documents.length) sections.push(`## File di contesto condivisi dell'istanza\n${documents.map((document) => `### ${document.name}\n${document.content}`).join("\n\n")}`);
    sections.push("## Routine, reminder e storico\nGestisci i tuoi compiti ricorrenti con set_routine, quelli da fare una sola volta con set_reminder (run_at ISO 8601 con fuso). list_routines mostra ciò che è ancora in programma; routine_history consulta esecuzioni e attività archiviate, con risultati e verifiche. Prima di ripetere un'azione già richiesta, consulta lo storico. Un reminder viene archiviato da Cora solo dopo una verifica positiva: non ricrearlo se è già riuscito. Se è bloccato o interrotto, controlla prima gli effetti già prodotti e poi chiedi o prepara una nuova prova senza duplicarli.");
    if (withoutComputer) {
      sections.push("## Il tuo computer\nIn questa conversazione non hai il tuo computer: lo usi solo per chi ha il permesso del proprietario. Se ti chiedono un lavoro che lo richiede, non restare in silenzio: chiedi il via libera al proprietario con ask_owner, oppure spiega che serve il suo permesso.");
    }
    if (computer) {
      sections.push([
        "## Il tuo computer",
        "Hai un tuo computer Linux con desktop (XFCE, Chromium, terminale, node, python3, sudo). Il proprietario può vedere e usare lo stesso desktop dal pannello. I file nella tua home restano tra un riavvio e l'altro.",
        "Usa gli strumenti quando ti chiedono di fare qualcosa davvero (cercare, controllare, scrivere file, aprire siti): agisci invece di descrivere cosa faresti.",
        "Sul tuo computer sei amministratore: con shell puoi installare, scrivere file e avviare servizi. Se l'ambiente in cui giri ti dice di essere in sola lettura, vale solo per quello, non per il tuo computer né per i tuoi strumenti.",
        "Le tue routine (compiti a orari fissi) le gestisci tu con list_routines, set_routine e delete_routine: quando il proprietario te ne chiede una, creala o sistemala subito.",
        "Quando ti danno un compito, lavori finché non è finito e verificato, anche per ore: non ti fermi a metà, non chiedi se continuare e non annunci cosa farai, lo fai. Ti fermi solo quando è finito, quando serve una decisione del proprietario (ask_owner) o quando sei bloccato davvero: allora spieghi cosa ti blocca.",
        "Per navigare preferisci shell con curl quando basta il testo; usa open_url + screenshot + computer quando serve il browser vero.",
        "Non inventare risultati: riporta solo quello che hai visto o fatto.",
      ].join("\n"));
    }
    sections.push([
      "## Come parli",
      "- È una chat di gruppo: messaggi brevi e naturali (1-4 frasi), niente preamboli, niente elenchi lunghi se non richiesti.",
      "- Non scrivere il tuo nome all'inizio e non scrivere l'orario.",
      "- Rispondi nella lingua di chi ti scrive.",
      "- Puoi rivolgerti agli altri agenti per nome; è normale discutere, essere in disaccordo, scherzare.",
      "- Se il messaggio non ti riguarda o non hai niente di utile o divertente da aggiungere, rispondi esattamente PASS. Mai quando ti nominano o ti scrivono in privato: lì rispondi sempre.",
      "- Se per rispondere devi lavorare (strumenti, ricerche, più passaggi), prima scrivi subito due parole con say (es. «Ci guardo») e poi lavora; alla fine scrivi il risultato.",
      "- Mentre lavori, i nuovi messaggi della chat ti arrivano insieme ai risultati degli strumenti: leggili e, se cambiano la richiesta, cambia piano.",
      "- Non ripetere quello che ha già detto qualcun altro.",
      "- Il proprietario ti parla da più posti (le chat, il pannello): per te è un'unica conversazione. Ricordi quello che vi siete detti altrove e rispondi dove ti scrive.",
      "- I messaggi con ★ vengono dal tuo proprietario: è lui che comanda, anche su dove vive il cora.",
    ].join("\n"));
    return sections.join("\n\n");
  }

  memoryContext(agent, query) {
    const facts = this.memory.relevant(agent.id, query);
    const diary = this.store.diary(agent.id).slice(-2);
    const parts = [];
    parts.push(`Ti torna in mente:\n${facts.length ? facts.map((fact) => `- [${fact.id}] ${fact.text}${fact.scope === "shared" ? " (condiviso)" : ""}${fact.pinned ? " (fissato)" : ""}`).join("\n") : "- (niente di specifico)"}`);
    if (diary.length) parts.push(`Dal tuo diario:\n${diary.map((entry) => `- ${formatWhen(Date.parse(entry.createdAt), this.timezone)}: ${entry.text}`).join("\n")}`);
    return parts.join("\n\n");
  }

  /** The agent's latest exchanges in its other places (Discord, Telegram, the panel): one conversation, many surfaces. */
  elsewhere(agent, channelId) {
    const ids = this.channelIdsFor(agent).filter((id) => id !== channelId);
    const places = this.store.recentElsewhere(agent.id, ids, Date.now() - ELSEWHERE_MS, { channels: 2, perChannel: 8 });
    if (!places.length) return "";
    const blocks = places.map(({ channelId: id, messages }) => {
      const short = messages.map((item) => ({ ...item, content: item.content.length > 600 ? `${item.content.slice(0, 600)}…` : item.content }));
      return `<altrove dove="${this.channelLabel(id)}">\n${formatTranscript(short, agent, this.timezone)}\n</altrove>`;
    });
    return `Le tue ultime conversazioni in altri posti. È la stessa conversazione con le stesse persone, solo su un'altra superficie: quello che vi siete detti lì vale anche qui.\n${blocks.join("\n")}`;
  }

  async chatTurn({ agent, history, channel, forced, computer, postFile, say, inbox, replyTo = null, onMessageHandled }) {
    const transcript = formatTranscript(history, agent, this.timezone);
    const last = replyTo || history[history.length - 1];
    const query = history.slice(-6).map((item) => item.content).join(" ");
    const instruction = forced
      ? `${last?.authorName || "Qualcuno"} si è rivolto a te: rispondi (non PASS). Se ti serve lavorare, la prima cosa che fai è say con due parole (es. «Ricevuto, ci guardo»), poi lo tieni aggiornato con say a ogni passo importante, e alla fine scrivi il risultato.`
      : "Decidi se intervenire. Se non hai niente da aggiungere rispondi solo PASS.";
    const user = [
      this.memoryContext(agent, query),
      this.elsewhere(agent, channel.id),
      `Ultimi messaggi ${channel.where || `in #${channel.name}`}${channel.note ? ` (${channel.note})` : ""}:\n<chat>\n${transcript}\n</chat>`,
      instruction,
      replyTo ? `Messaggio umano a cui rispondere adesso: ${replyTo.authorName}: ${replyTo.content}\nGli eventuali risultati di routine successivi sono solo contesto, non una nuova richiesta di eseguirle.` : "",
    ].filter(Boolean).join("\n\n");
    const turn = (prompt) => this.loop({
      agent, mode: "chat", channel, user: prompt, computer, postFile, say, inbox, onMessageHandled,
      maxSteps: computer ? TASK_STEPS : CHAT_STEPS, deadline: Date.now() + (computer ? TASK_DEADLINE_MS : CHAT_DEADLINE_MS),
      images: (last?.images || []).slice(0, 2), task: Boolean(computer),
      goalRequest: history.filter((item) => item.kind === "owner" || item.kind === "human").slice(-1).map((item) => item.content).join("\n"),
    });
    const result = await turn(user);
    // A question to the owner is already an answer: it is in the chat.
    if (result.text || !forced || result.asked || result.spoken) return result;
    // Called by name and still passing: ask once more, plainly.
    return turn(`${user}\n\nHai risposto PASS, ma ${last?.authorName || "qualcuno"} ti ha chiamato per nome: scrivi una risposta vera, anche breve. Se ti chiede qualcosa che non puoi fare da solo, diglielo, oppure chiedi il via libera al proprietario con ask_owner.`);
  }

  async routineTurn({ agent, routine, history, channel, postFile, say, inbox, onTrace, onMessageHandled }) {
    const transcript = formatTranscript(history.slice(-12), agent, this.timezone);
    const user = [
      this.memoryContext(agent, `${routine.name} ${routine.prompt}`),
      this.elsewhere(agent, channel.id),
      routine.kind === "reminder" ? `È il momento del tuo reminder "${routine.name}" (una volta: ${routine.runAt}).` : `È il momento della tua routine "${routine.name}" (pianificazione: ${routine.schedule}).`,
      `[Attività programmata: ${routine.id}]`,
      `Compito:\n${routine.prompt}`,
      'Come prima cosa manda con say una riga che dice quale routine è partita e cosa vai a controllare di preciso: chi legge deve capire cosa stai facendo, non basta "ci guardo" o "ci penso io". Se il compito richiede una verifica silenziosa, rispetta il silenzio e non inviare avvisi di avvio. Poi mettiti al lavoro.',
      `Usa il tuo computer se serve. Alla fine scrivi il messaggio da pubblicare ${channel.where || `in #${channel.name}`}: è quello che vedrà il proprietario. Se non c'è niente da segnalare rispondi solo PASS.`,
      transcript ? `Contesto recente del canale:\n<chat>\n${transcript}\n</chat>` : "",
    ].filter(Boolean).join("\n\n");
    return this.loop({
      agent, mode: routine.kind === "reminder" ? "reminder" : "routine", channel, user, computer: agent.tools, postFile, say, inbox, onTrace, onMessageHandled,
      maxSteps: ROUTINE_STEPS, deadline: Date.now() + ROUTINE_DEADLINE_MS, images: [], task: Boolean(agent.tools),
      goalRequest: this.routineGoal(routine), routine,
    });
  }

  routineGoal(routine) {
    if (routine.kind === "reminder") return `Reminder "${routine.name}": ${routine.prompt}\n\nEsegui questo compito una sola volta e verifica il risultato con prove concrete. Prima di ripetere azioni con effetti esterni, controlla se sono già riuscite. Se serve un permesso o un intervento altrui, segnala il blocco. Cora conserverà il risultato e archivierà il reminder soltanto dopo la verifica.`;
    return `Routine "${routine.name}": ${routine.prompt}\n\nQuesta esecuzione deve svolgere UN controllo adesso e riportare l'esito (o PASS se previsto). Una pubblicazione prevista nel futuro resta in coda: non aspettare che avvenga, non anticiparla e non ripetere il controllo fino a quell'ora. Le esecuzioni successive spettano alla pianificazione. Un limite di accesso o un intervento di un altro agente va segnalato, non inseguito all'infinito.`;
  }

  async verifyReminder({ agent, routine, result, delivered = false }) {
    if (result.stopped || result.asked) return { met: false, blocked: true, reason: result.stopped ? "Esecuzione interrotta." : "Serve una risposta del proprietario." };
    const evidence = this.traces?.get(result.traceId);
    const work = (evidence?.steps || []).filter((step) => step.type === "tool").slice(-40)
      .map((step) => `${step.name} ${JSON.stringify(step.args || {}).slice(0, 500)} → ${String(step.result || "").slice(0, 2400)}`).join("\n");
    const trace = this.startTrace({ agentId: agent.id, kind: "verification", channelId: routine.channelId, model: agent.model || this.store.settings.defaultModel,
      prompt: this.routineGoal(routine) });
    const verdict = await this.goalCheck(this.routineGoal(routine), { answer: result.text, work: `${work}\n${delivered ? `Messaggio finale effettivamente consegnato nel canale: ${result.text}` : "Nessun messaggio finale pubblicato."}`, strict: true, agent }, AbortSignal.timeout(120000));
    trace.spent(verdict.usage);
    const verification = { met: verdict.met, blocked: Boolean(verdict.blocked), reason: verdict.reason, traceId: trace.id };
    trace.finish({ status: verdict.met ? "done" : "error", output: JSON.stringify(verification) });
    return verification;
  }

  /**
   * A task cut short by a restart of Cora: the same instructions, the last
   * steps the agent had taken, and the request to check where things stand
   * and finish.
   */
  async resumeTurn({ agent, trace, channel, postFile, say, inbox, routine = null, onTrace, onMessageHandled }) {
    const steps = (trace.steps || []).filter((step) => step.type === "tool" || step.type === "text").slice(-20).map((step) => step.type === "tool"
      ? `- ${step.name} ${JSON.stringify(step.args || {}).slice(0, 300)} → ${String(step.result || "").replace(/\s+/g, " ").slice(0, 300)}`
      : `- (scritto) ${String(step.text || "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const original = String(trace.prompt || "").replace(/^Ora: [^\n]*\n\n/, "").replace(/\n\n\[Obiettivo\][\s\S]*$/, "");
    const user = [
      original,
      `[Cora] Cora si è riavviata mentre lavoravi a questo compito (iniziato ${formatWhen(Date.parse(trace.startedAt), this.timezone)}). Gli ultimi passi che avevi fatto:\n${steps || "- (nessuno registrato)"}`,
      trace.output ? `Risultato già registrato prima del riavvio:\n${trace.output}` : "",
      "Riprendi da dove eri: controlla com'è la situazione adesso (qualcosa potrebbe essere già fatto), poi porta a termine il compito e scrivi il risultato.",
    ].join("\n\n");
    return this.loop({
      agent, mode: routine?.kind === "reminder" ? "reminder" : trace.kind === "routine" ? "routine" : "chat", channel, user, computer: agent.tools, postFile, say, inbox, onTrace, onMessageHandled,
      maxSteps: TASK_STEPS, deadline: Date.now() + TASK_DEADLINE_MS, images: [], task: true,
      goalRequest: routine ? this.routineGoal(routine) : original.split("<chat>\n").pop().split("\n</chat>")[0].split("\n").filter((line) => line.includes(" ★:")).slice(-1).join("\n"), routine,
    });
  }

  startTrace(fields) {
    return this.traces ? this.traces.start(fields) : NO_TRACE;
  }

  /**
   * The goal of a task: one line saying what must be **true** for it to be
   * finished, not the steps to get there. A model that is not the one working
   * writes it, so an agent never sets its own finish line. Empty when it
   * cannot be written: the task then runs on the plain harness rules.
   */
  async goalFor(request, since = "") {
    const model = this.store.settings.defaultModel;
    if (!this.store.settings.goalMode || !model || this.llm.isAgentic(model)) return { goal: "", usage: null };
    try {
      const out = await this.llm.chat({
        model, tools: [], effort: "low",
        messages: [
          { role: "system", content: "Scrivi la condizione di completamento di un compito: cosa deve essere vero e verificato perché sia finito, non i passi per arrivarci. Una riga sola, nella lingua della richiesta, senza preamboli. Se la richiesta non è un compito ma una chiacchiera, rispondi NESSUNO." },
          { role: "user", content: `Richiesta:\n${String(request).slice(0, 4000)}${since ? `\n\nPoi il proprietario ha detto:\n${since.slice(0, 2000)}\nSe cambia quello che chiede, la condizione è la nuova, non quella di prima.` : ""}\n\nCondizione di completamento (una riga):` },
        ],
      });
      const text = String(out.text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim().split("\n")[0].trim();
      const goal = !text || /^nessuno\b/i.test(text) ? "" : text.slice(0, GOAL_CHARS);
      return { goal, usage: out.usage };
    } catch {
      return { goal: "", usage: null };
    }
  }

  /**
   * Is the goal met? A separate, cheap call reads the condition, what the agent
   * really did and what it wrote, and answers with a verdict and a reason. A
   * check that fails lets the task through: a broken judge must never keep an
   * agent working for ever.
   */
  async goalCheck(goal, { answer, work, strict = false, agent = null }, signal) {
    const model = strict ? agent?.model || this.store.settings.defaultModel : this.store.settings.defaultModel;
    try {
      const options = {
        model, tools: [], effort: "low",
        messages: [
          { role: "system", content: 'Giudichi se un compito è finito. Rispondi SOLO con JSON: {"met": true|false, "blocked": true|false, "reason": "una frase"}. met=true soltanto se la condizione risulta soddisfatta dai risultati degli strumenti, non dalle promesse. Giudica solo il compito attuale: una routine esegue un controllo, non attende le pubblicazioni future. blocked=true quando per proseguire serve una scadenza futura, un permesso o un intervento altrui: riprovare subito non può risolverlo. La reason va nella lingua della condizione. Lo stato running della routine o del suo registro è mantenuto da Cora fino a DOPO questo controllo: non richiedere che sia già done o completed. La risposta finale qui fornita viene pubblicata dopo la verifica; giudica il suo contenuto insieme ai risultati reali, non la presenza preventiva dello stesso messaggio nel canale. Un permesso mancante, una verifica umana o uno strumento non disponibile sono blocchi: non chiedere di riprovare subito la stessa azione.' },
          { role: "user", content: `Condizione:\n${goal}\n\nCosa ha fatto l'agente:\n${work || "(niente)"}\n\nCosa ha scritto come risultato:\n${answer || "(niente)"}` },
        ],
        signal,
      };
      const out = strict && this.llm.isAgentic(model) ? await this.llm.runAgent({ model, subscriptionId: agent.subscriptionId,
        system: options.messages[0].content, prompt: options.messages[1].content, tools: [], execute: async () => { throw new Error("verification has no tools"); }, timeoutMs: 120000, effort: "low", signal }) : await this.llm.chat(options);
      const data = parseJsonObject(String(out.text || ""));
      if (!data || typeof data.met !== "boolean") return { met: !strict, blocked: strict, reason: strict ? "La verifica non ha restituito un esito valido." : "", usage: out.usage };
      return { met: data.met && (!strict || data.blocked !== true), blocked: data.blocked === true, reason: String(data.reason || "").trim().slice(0, 300), usage: out.usage };
    } catch {
      return { met: !strict, blocked: strict, reason: strict ? "Verifica non disponibile: il reminder resta da controllare." : "", usage: null };
    }
  }

  async evaluateMessage({ goal, request, messages, work, progress }, signal) {
    try {
      const out = await this.llm.chat({
        model: this.store.settings.defaultModel, tools: [], effort: "low", signal,
        messages: [
          { role: "system", content: 'Valuti l\'intenzione di nuovi messaggi durante un compito in corso. Rispondi SOLO con JSON: {"intent":"status"|"update"|"stop"|"continue", "reply":""}. Valuta il significato nel contesto, non la presenza di parole. status: chiedono come procede o un recap, senza cambiare il compito; scrivi in reply un aggiornamento breve nella loro lingua, basato solo su risultati e progressi forniti, senza promettere risultati non verificati. update: modificano il compito, aggiungono un requisito o ne chiedono un altro al suo posto. stop: chiedono esplicitamente di interrompere o abbandonare il lavoro; un riferimento alla parola stop, una negazione o una domanda sullo stato non sono un ordine di fermarsi. continue: conferme, chiarimenti o chiacchiere che non modificano il lavoro. Se fanno una domanda o vogliono parlare con te senza cambiare il compito, scrivi in reply una risposta breve e pertinente: Cora la invia subito mentre il lavoro continua. Per una semplice conferma senza domanda puoi lasciare reply vuoto. Una domanda di stato conserva SEMPRE l\'obiettivo e il lavoro in corso. Se il messaggio combina una domanda e una nuova istruzione, considera l\'istruzione. In caso di dubbio conserva il lavoro: continue.' },
          { role: "user", content: `Richiesta attuale:\n${request}\n\nObiettivo attuale:\n${goal || "(nessuno)"}\n\nRisultati effettivi:\n${work || "(nessun risultato ancora)"}\n\nUltimo aggiornamento:\n${progress || "(nessuno)"}\n\nNuovi messaggi da valutare:\n${messages}` },
        ],
      });
      const data = parseJsonObject(out.text);
      return { intent: ["status", "update", "stop", "continue"].includes(data?.intent) ? data.intent : "continue", reply: String(data?.reply || "").slice(0, 1800), usage: out.usage };
    } catch {
      return { intent: "continue", reply: "", usage: null };
    }
  }

  async loop({ agent, mode, channel, user, computer, postFile, say = null, inbox = null, maxSteps, deadline, images, task = false, goalRequest = "", routine = null, onTrace = null, onMessageHandled = null }) {
    const model = agent.model || this.store.settings.defaultModel;
    const caps = await this.llm.capabilities(model);
    const tools = caps.tools ? TOOL_DEFS.filter((tool) => OWN_TOOLS.has(tool.name) || computer) : [];
    const place = channel.place || "";
    const system = this.systemPrompt(agent, { place, computer: computer && caps.tools, withoutComputer: Boolean(agent.tools && !computer && caps.tools) });
    let { goal, usage: goalCost } = task && goalRequest ? await this.goalFor(goalRequest) : { goal: "", usage: null };
    if (task && goal) this.channelGoals.set(channel.id, goal);
    const currentPrompt = () => `Ora: ${formatNow(this.timezone)}.\n\n${user}${goal ? `\n\n[Obiettivo] Questa è l'unica condizione attuale; sostituisce gli obiettivi precedenti: ${goal}` : ""}`;
    const prompt = currentPrompt();
    const trace = this.startTrace({ agentId: agent.id, kind: mode, channelId: channel.id, model, system, prompt });
    onTrace?.(trace.id);
    trace.spent(goalCost);
    if (goal) trace.add({ type: "note", text: `Obiettivo: ${goal}` });
    let asked = false;
    // What the Cora harness watches while an agent works: real work done, and calls repeated without progress.
    let worked = 0;
    let looping = false;
    const recent = [];
    let screen = "unknown";
    let visualAction = "";
    const repeatedCall = (signature) => {
      recent.push(signature);
      if (recent.length > LOOP_WINDOW) recent.shift();
      return recent.filter((item) => item === signature).length >= LOOP_REPEATS;
    };
    const markLoop = (name) => {
      if (looping) return;
      looping = true;
      trace.add({ type: "note", text: `Ripete ${name} senza nuovi risultati: lo fermo.` });
    };
    // What the agent really did, in one line each: the goal check reads this, not its promises.
    const did = [];
    // What the owner said after the task started: a goal they have moved past must not hold.
    let steering = [];
    const ownerSaid = [];
    const pendingNews = [];
    const pendingMessageIds = new Set();
    const deliveredMessageIds = new Set();
    const answeredMessageIds = new Set();
    const controller = new AbortController();
    let evaluation = Promise.resolve();
    let closed = false;
    let progress = "";
    const spokenMessages = [];
    let stoppedByOwner = false;
    // Told to stop, an agent stops: no more tools, no more rounds, whatever it has is the answer.
    let halted = false;
    let lastUpdate = Date.now();
    const sayTracked = say ? async (text, target = channel.id) => {
      lastUpdate = Date.now();
      progress = String(text);
      const result = await say(text, target);
      spokenMessages.push(String(text).trim());
      if (spokenMessages.length > 20) spokenMessages.shift();
      for (const id of deliveredMessageIds) answeredMessageIds.add(id);
      return result;
    } : null;
    const ctx = {
      agent, boxes: this.boxes, store: this.store, memory: this.memory, channelId: channel.id, postFile, log: this.log, push: this.push,
      // The question goes where this conversation is, not to a separate place.
      ask: this.ask ? async (request) => {
        const posted = await this.ask(agent, request, { channelId: channel.id });
        asked = true;
        return posted;
      } : null,
      say: sayTracked,
      checkSchedule: (expr) => {
        try {
          return nextRuns(expr, this.timezone, 1).length ? "" : "it never runs in the next month";
        } catch (error) {
          return error.message;
        }
      },
      channelIds: this.channelIdsFor(agent),
      channelLabel: (id) => this.channelLabel(id),
      postingChannels: [...new Map([
        { id: SALOTTO, name: "salotto", kind: "web" }, { id: privateRoom(agent.id), name: "la tua chat privata", kind: "web" },
        ...(this.channels?.listFor?.(agent) || []), { id: channel.id, name: channel.name || this.channelLabel(channel.id), kind: channel.kind || "web" },
      ].map(({ id, name, kind }) => [id, { id, name, kind }])).values()],
      formatWhen: (ms) => formatWhen(ms, this.timezone),
    };
    const runTool = async (name, args) => {
      const before = await news();
      const started = Date.now();
      const allowed = tools.some((tool) => tool.name === name);
      const visual = name === "computer" || name === "open_url";
      const signature = `${name}:${JSON.stringify(args || {})}${visual ? `:${screen}` : ""}`;
      const repeated = name !== "screenshot" && repeatedCall(signature) && !MEMORY_TOOLS.has(name);
      if (repeated) markLoop(name);
      if (allowed && !MEMORY_TOOLS.has(name)) worked += 1;
      let output = halted ? { text: "error: the owner asked you to stop. Do not run anything else: say where you had got to, in one line." }
        : !allowed ? { text: `error: the tool ${name} is not available now` }
        : repeated ? { text: "error: you have already done exactly this several times with the same result. Stop repeating it: write what you have so far and what is blocking you." }
        : await executeTool({ name, args }, ctx);
      if (name === "screenshot" && allowed && !halted) {
        const observed = createHash("sha256").update(output.image || output.text).digest("hex");
        if (output.image) screen = observed;
        if (repeatedCall(`${signature}:${observed}:${visualAction}`)) {
          markLoop(name);
          output = { text: "error: repeated desktop observations returned the same result. Take a different action or explain what is blocking progress." };
        }
      } else if (visual && allowed && !halted && !output.text.startsWith("error:")) visualAction = `${name}:${JSON.stringify(args || {})}`;
      const ok = !output.text.startsWith("error:");
      this.log?.({
        type: "tool", agentId: agent.id, channelId: channel.id, tool: name,
        args: summarizeArgs(name, args || {}), ok, ms: Date.now() - started, traceId: trace.id,
      });
      trace.add({ type: "tool", name, args: args || {}, result: output.text, ok, ms: Date.now() - started, image: Boolean(output.image) });
      if (allowed) did.push(`${name} ${summarizeArgs(name, args || {})} → ${String(output.text).slice(0, 2400)}`);
      const steer = await news();
      return before || steer ? { ...output, text: [output.text, before, steer].filter(Boolean).join("\n\n") } : output;
    };
    // New chat messages reach a working agent with its next tool result (or its next step on Ollama).
    const collectNews = () => {
      if (closed) return;
      const fresh = inbox?.() || [];
      if (fresh.length) {
        trace.add({ type: "note", text: `Nuovi messaggi mentre lavora:\n${fresh.map((item) => `${item.authorName}: ${item.content}`).join("\n")}` });
        evaluation = evaluation.then(async () => {
          if (halted || closed) return;
          const messages = fresh.map((item) => `${item.authorName}: ${item.content}`).join("\n");
          const decision = await this.evaluateMessage({ goal, request: goalRequest, messages, work: did.slice(-12).join("\n"), progress }, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
          if (halted || closed) return;
          trace.spent(decision.usage);
          trace.add({ type: "note", text: `Valutazione messaggio: ${decision.intent}` });
          if (decision.intent === "stop") {
            for (const item of fresh) deliveredMessageIds.add(item.id);
            halted = true;
            stoppedByOwner = true;
            if (routine && this.store.routine(routine.id)) this.store.updateRoutine(routine.id, { enabled: false });
            controller.abort();
            return;
          }
          if (decision.intent === "update") {
            steering.push(messages);
            ownerSaid.push(messages);
          }
          if ((decision.intent === "status" || (decision.intent === "continue" && decision.reply)) && sayTracked) {
            try {
              await sayTracked(decision.reply || `Sto ancora lavorando a questo obiettivo: ${goal || goalRequest}`);
              for (const item of fresh) answeredMessageIds.add(item.id);
              onMessageHandled?.(fresh.map((item) => item.id));
            } catch {}
          }
          for (const item of fresh) pendingMessageIds.add(item.id);
          pendingNews.push(`[Nel frattempo nella chat]\n${formatTranscript(fresh, agent, this.timezone)}\n${decision.intent === "status" ? "[Cora] È solo una richiesta di stato: ho già inviato il recap. L'obiettivo non cambia; continua il lavoro senza ricominciarlo." : "[Cora] Una domanda di stato o una conferma non cambia il goal. Rispetta solo le modifiche effettive alla richiesta."}`);
        });
      }
      if (routine) {
        const current = this.store.routine(routine.id);
        if (!current || (routine.enabled && !current.enabled) || current.updatedAt !== routine.updatedAt) halted = true;
      }
      if (halted && !controller.signal.aborted) controller.abort();
    };
    const settleNews = async () => {
      collectNews();
      let pending;
      do {
        pending = evaluation;
        await pending;
        collectNews();
      } while (pending !== evaluation);
    };
    const news = async () => {
      await settleNews();
      const parts = pendingNews.splice(0);
      for (const id of pendingMessageIds) deliveredMessageIds.add(id);
      pendingMessageIds.clear();
      if (task && sayTracked && Date.now() - lastUpdate > UPDATE_EVERY_MS) {
        lastUpdate = Date.now();
        parts.push("[Cora] Non scrivi in chat da un po': manda con say due righe su a che punto sei, poi continua.");
      }
      return parts.join("\n\n");
    };
    const done = (raw, steps) => {
      closed = true;
      const reply = cleanReply(raw, agent);
      const text = reply && !spokenMessages.includes(reply.trim()) ? reply : null;
      trace.finish({ status: halted ? "stopped" : text ? "done" : "pass", output: raw });
      return { text, steps, traceId: trace.id, asked, stopped: halted, spoken: spokenMessages.length > 0, handledMessageIds: [...new Set([...answeredMessageIds, ...(text || asked ? deliveredMessageIds : [])])] };
    };
    /**
     * The Cora harness at the end of a task turn: is it really finished? An
     * agent that did real work and then stops with nothing, with a question
     * about going on, or with what it is about to do, is sent back to work.
     * Once it looks finished it is asked once to confirm. Never while looping
     * or after asking the owner something.
     */
    let nudges = 0;
    let confirmed = false;
    const verdict = (raw) => {
      if (halted || !task || !worked || looping || asked || nudges >= NUDGES || Date.now() > deadline - 20000) return null;
      const text = cleanReply(raw, agent);
      if (!text && spokenMessages.length) return null;
      if (!text) return { kind: "silent", prompt: "[Cora] Hai lavorato ma non hai scritto niente. Se il lavoro è finito, scrivi il risultato per chi aspetta; se manca qualcosa, continua adesso con gli strumenti." };
      if (unfinished(text)) return { kind: "unfinished", text, prompt: "[Cora] Non hai finito: quello che hai scritto è un aggiornamento, non il risultato. Continua adesso con gli strumenti, senza chiedere se andare avanti e senza annunciare: fallo. Quando è tutto fatto e verificato, scrivi il risultato." };
      if (!confirmed) return { kind: "confirm", text, prompt: "[Cora] Prima di chiudere: il compito che ti hanno dato è finito davvero e verificato? Se manca qualcosa, continua adesso con gli strumenti. Se è tutto fatto, rispondi solo DONE." };
      return null;
    };
    const isDone = (raw) => /^\W*done\W*$/i.test(String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim());
    /**
     * The goal check: when a task has a goal, this replaces the harness'
     * guesswork. A separate model decides whether the condition is met and
     * says why not; the agent goes back to work with that reason in hand.
     */
    let goalRounds = 0;
    const goalVerdict = async (raw) => {
      if (halted || looping || asked || goalRounds >= GOAL_ROUNDS || Date.now() > deadline - 20000) return null;
      const text = cleanReply(raw, agent);
      if (steering.length) {
        // They have spoken since the goal was written: it is theirs to move, not ours to defend.
        steering = [];
        const { goal: next, usage: cost } = await this.goalFor(goalRequest, ownerSaid.join("\n"));
        await settleNews();
        if (halted) return null;
        trace.spent(cost);
        if (steering.length) return goalVerdict(raw);
        if (next && next !== goal) {
          trace.add({ type: "note", text: `Obiettivo aggiornato su quello che hanno detto: ${next}` });
          if (sayTracked) await sayTracked(`Cambio obiettivo: ${next}`).catch(() => {});
          goal = next;
          this.channelGoals.set(channel.id, next);
        } else if (!next) {
          // What they asked for is no longer a task: stop holding it to a condition.
          trace.add({ type: "note", text: "Obiettivo lasciato cadere: non chiedono più un compito." });
          goal = "";
          this.channelGoals.delete(channel.id);
          return null;
        }
      }
      const { met, blocked, reason, usage } = await this.goalCheck(goal, { answer: text, work: did.slice(-40).join("\n") }, controller.signal);
      await settleNews();
      if (halted) return null;
      trace.spent(usage);
      if (steering.length) return goalVerdict(raw);
      trace.add({ type: "note", text: `Controllo obiettivo: ${met ? "raggiunto" : "non ancora"}${reason ? ` — ${reason}` : ""}` });
      if (met || blocked) return null;
      goalRounds += 1;
      return {
        kind: "goal", text,
        prompt: `[Cora] L'obiettivo non è ancora raggiunto: ${reason || "manca la verifica"}. L'unica condizione attuale è: ${goal}. Continua adesso con gli strumenti, senza chiedere se andare avanti e senza annunciare cosa farai. Quando la condizione è vera e verificata, scrivi il risultato.`,
      };
    };
    /** With a goal it is the goal that decides; without one, the harness' own reading of the answer. */
    const nextStep = async (raw) => {
      await settleNews();
      if (halted) return null;
      return goal ? goalVerdict(raw) : verdict(raw);
    };

    const controlTimer = setInterval(collectNews, 100);
    try {
      await settleNews();
      controller.signal.throwIfAborted();
      if (this.llm.isAgentic(model)) {
        const run = (input) => this.llm.runAgent({
          model, subscriptionId: agent.subscriptionId, system, prompt: input, tools, execute: runTool, timeoutMs: Math.max(30000, deadline - Date.now()), onStep: (step) => trace.add(step), effort: effortOf(agent),
          signal: controller.signal,
        });
        let result = await run(prompt);
        trace.spent(result.usage);
        let final = result.text;
        for (let next = await nextStep(final); next; next = await nextStep(result.text)) {
          if (next.kind !== "goal") nudges += 1;
          if (next.kind === "confirm") confirmed = true;
          if (next.kind === "unfinished" && sayTracked) await sayTracked(next.text).catch(() => {});
          trace.add({ type: "note", text: `Cora harness: ${next.kind === "confirm" ? "chiedo conferma che sia finito" : "lo rimando al lavoro"}.` });
          if (halted) break;
          result = await run(`${currentPrompt()}\n\n[Messaggi successivi del proprietario]\n${ownerSaid.join("\n") || "(nessuno)"}\n\n[Azioni già eseguite: non ripeterle]\n${did.slice(-40).join("\n")}\n\n[Il tuo turno precedente si è chiuso con: «${cleanReply(result.text, agent) || "(niente)"}»]\n\n${next.prompt}`);
          trace.spent(result.usage);
          if (next.kind === "confirm" && isDone(result.text)) break;
          final = result.text;
        }
        return done(halted ? stoppedByOwner ? "Mi fermo qui." : "PASS" : final, 0);
      }

      const messages = [{ role: "system", content: system }, { role: "user", content: prompt, images }];
      const think = (result) => {
        const inline = [...String(result.text || "").matchAll(/<think>([\s\S]*?)<\/think>/gi)].map((match) => match[1].trim()).filter(Boolean);
        for (const text of [result.thinking, ...inline]) if (String(text || "").trim()) trace.add({ type: "thinking", text });
      };
      let steps = 0;
      // The last real answer the agent gave: a final "DONE" (confirming it is finished) posts this, not the word "DONE".
      let lastAnswer = "";
      const size = () => messages.reduce((total, message) => total + String(message.content || "").length + JSON.stringify(message.toolCalls || "").length, 0);
      for (; steps < maxSteps && Date.now() < deadline && !halted; steps += 1) {
        if (steps > 0) {
          const steer = await news();
          if (steer) messages.push({ role: "user", content: steer });
        }
        if (task && size() > COMPACT_CHARS) {
          // Hours of work outgrow any context: the agent writes down where it is and carries on from that.
          const summary = await this.llm.chat({
            model, effort: "low", tools: [], signal: controller.signal,
            messages: [...messages, { role: "user", content: "[Cora] Il lavoro è lungo e la conversazione sta diventando troppo grande. Scrivi un riassunto per te stesso: l'obiettivo, cosa hai già fatto (comandi, file, link e risultati importanti), cosa manca e i prossimi passi. Solo il riassunto." }],
          });
          trace.spent(summary.usage);
          const notes = String(summary.text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim().slice(0, 12000);
          trace.add({ type: "note", text: `Cora harness: conversazione riassunta per continuare.\n${notes}` });
          messages.splice(0, messages.length,
            { role: "system", content: system },
            { role: "user", content: currentPrompt() },
            { role: "user", content: `[Cora] Stai lavorando a questo compito da un po'. Il tuo riassunto di dove sei arrivato:\n${notes}\n\nContinua da qui.` });
        }
        const result = await this.llm.chat({ model, messages, tools, effort: effortOf(agent), signal: controller.signal });
        trace.spent(result.usage);
        think(result);
        if (!result.toolCalls.length) {
          // It confirmed it is done: post the real answer it gave, never the bare "DONE".
          if (isDone(result.text) && lastAnswer) return done(lastAnswer, steps);
          const next = await nextStep(result.text);
          if (halted) return done(stoppedByOwner ? "Mi fermo qui." : "PASS", steps);
          if (!next) return done(result.text, steps);
          if (next.kind !== "goal") nudges += 1;
          if (next.kind === "goal") {
            lastAnswer = cleanReply(result.text, agent) || lastAnswer;
          } else if (next.kind === "confirm") {
            confirmed = true;
            lastAnswer = cleanReply(result.text, agent) || lastAnswer;
          } else if (next.kind === "unfinished" && sayTracked) {
            await sayTracked(next.text).catch(() => {});
          }
          trace.add({ type: "note", text: `Cora harness: ${next.kind === "confirm" ? "chiedo conferma che sia finito" : "lo rimando al lavoro"}.` });
          messages.push({ role: "assistant", content: result.text || "" });
          messages.push({ role: "user", content: next.prompt });
          continue;
        }
        const said = String(result.text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        if (said) trace.add({ type: "text", text: said });
        messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          const output = await runTool(call.name, call.args || {});
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: output.text, image: output.image });
        }
      }
      // Stopped on request: what it has is the answer, and no further call is made for it.
      if (halted) return done(stoppedByOwner ? "Mi fermo qui." : "PASS", steps);
      if (lastAnswer) return done(lastAnswer, steps);
      trace.add({ type: "note", text: "Lavora da troppo: chiedo il messaggio finale." });
      messages.push({ role: "user", content: "[Cora] Ci stai lavorando da molto: fermati qui e scrivi cosa hai fatto, cosa manca e cosa ti blocca." });
      const final = await this.llm.chat({ model, messages, tools: [], effort: "low", signal: controller.signal });
      trace.spent(final.usage);
      think(final);
      return done(final.text, steps);
    } catch (error) {
      await settleNews();
      if (halted) return done(stoppedByOwner ? "Mi fermo qui." : "PASS", 0);
      trace.finish({ status: "error", error: error.message });
      throw error;
    } finally {
      closed = true;
      clearInterval(controlTimer);
      if (task) this.channelGoals.delete(channel.id);
    }
  }

  /**
   * Nightly consolidation: reread what happened since the last sleep, then
   * rewrite the core card, add/merge/remove facts and write a diary page.
   */
  async sleep(agent, { force = false } = {}) {
    if (this.sleeping.has(agent.id)) return { status: "busy" };
    this.sleeping.add(agent.id);
    try {
      const since = agent.lastSleepAt ? Date.parse(agent.lastSleepAt) : 0;
      const events = this.memory.archiveSince(this.channelIdsFor(agent), since, SLEEP_MESSAGES);
      if (!events.length && !force) return { status: "nothing" };
      const facts = this.memory.facts(agent.id).slice(-300);
      const transcript = events.map((item) => {
        const who = item.agentId === agent.id ? `Tu (${agent.name})` : item.kind === "owner" ? `${item.authorName} ★` : item.authorName;
        return `[${formatWhen(item.at, this.timezone)} ${this.channelLabel(item.channelId)}] ${who}: ${item.content.slice(0, 500)}`;
      }).join("\n");
      const prompt = [
        `Sei ${agent.name}. È notte: è il momento di riordinare la memoria, come quando si dorme.`,
        `## Chi sei\n${agent.personality.trim().slice(0, 2000) || "(nessuna personalità definita)"}`,
        `## La tua scheda attuale\n${agent.core.trim() || "(vuota)"}`,
        `## I tuoi ricordi attuali\n${facts.length ? facts.map((fact) => `- [${fact.id}] ${fact.text} (${fact.scope === "shared" ? "condiviso" : "privato"}${fact.pinned ? ", fissato" : ""})`).join("\n") : "(nessuno)"}`,
        `## Cosa è successo ${since ? `dal ${formatWhen(since, this.timezone)}` : "finora"}\n${transcript || "(niente di nuovo)"}`,
        [
          "Rispondi SOLO con un oggetto JSON, senza testo prima o dopo:",
          "{",
          '  "core": "la nuova scheda completa (max 2500 caratteri): chi è il proprietario e cosa gli importa, i tuoi rapporti con gli altri, cosa sta succedendo, impegni aperti. Mantieni ciò che è ancora vero.",',
          '  "add": [{"text": "fatto nuovo, breve e specifico", "shared": false}],',
          '  "update": [{"id": "mem_...", "text": "versione corretta o fusa"}],',
          '  "remove": ["mem_..."],',
          '  "diary": "una pagina di diario in prima persona (max 8 frasi): cosa è successo, cosa hai imparato, cosa ne pensi"',
          "}",
          "Regole: aggiungi solo fatti duraturi (preferenze, decisioni, persone, progetti, scadenze), non chiacchiere. Fondi i doppioni (aggiorna uno, rimuovi gli altri). Rimuovi ciò che è superato o sbagliato, ma mai i ricordi fissati. \"shared\": true solo per fatti utili a tutti gli agenti. Non inventare nulla che non risulti dalle conversazioni o dai ricordi.",
        ].join("\n"),
      ].join("\n\n");
      const model = agent.model || this.store.settings.defaultModel;
      const system = "Sei un sistema di consolidamento della memoria. Rispondi solo con JSON valido.";
      const trace = this.startTrace({ agentId: agent.id, kind: "sleep", model, system, prompt });
      let summary;
      try {
        const result = this.llm.isAgentic(model)
          ? await this.llm.runAgent({ model, subscriptionId: agent.subscriptionId, system, prompt, tools: [], execute: null, timeoutMs: 5 * 60 * 1000, onStep: (step) => trace.add(step), effort: effortOf(agent) })
          : await this.llm.chat({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], tools: [], effort: effortOf(agent) });
        if (result.thinking) trace.add({ type: "thinking", text: result.thinking });
        summary = this.applySleep(agent, parseJsonObject(result.text));
        trace.finish({ status: "done", output: result.text });
      } catch (error) {
        trace.finish({ status: "error", error: error.message });
        throw error;
      }
      this.store.markSlept(agent.id, new Date(events.length ? events[events.length - 1].at : Date.now()).toISOString());
      this.log?.({ type: "sleep", agentId: agent.id, text: `ha dormito: +${summary.added} ricordi, ${summary.updated} corretti, ${summary.removed} dimenticati${summary.core ? ", scheda aggiornata" : ""}` });
      return { status: "done", ...summary };
    } finally {
      this.sleeping.delete(agent.id);
    }
  }

  applySleep(agent, plan) {
    const summary = { added: 0, updated: 0, removed: 0, core: false, diary: false };
    const owned = (id) => {
      const found = this.store.findMemory(String(id || ""));
      return found && (found.key === agent.id || found.key === SHARED) ? found : null;
    };
    for (const item of (Array.isArray(plan.update) ? plan.update : []).slice(0, 40)) {
      const found = owned(item?.id);
      if (found && String(item.text || "").trim()) {
        this.store.updateMemory(found.key, found.memory.id, { text: item.text });
        summary.updated += 1;
      }
    }
    for (const id of (Array.isArray(plan.remove) ? plan.remove : []).slice(0, 40)) {
      const found = owned(id);
      if (found && !found.memory.pinned) {
        this.store.deleteMemory(found.key, found.memory.id);
        summary.removed += 1;
      }
    }
    for (const item of (Array.isArray(plan.add) ? plan.add : []).slice(0, 25)) {
      const text = typeof item === "string" ? item : item?.text;
      if (!String(text || "").trim()) continue;
      this.store.addMemory(item?.shared ? SHARED : agent.id, text, "sleep", { by: agent.name });
      summary.added += 1;
    }
    const core = String(plan.core || "").trim();
    if (core && core !== agent.core) {
      this.store.setCore(agent.id, core.slice(0, 3000), "sleep");
      summary.core = true;
    }
    if (String(plan.diary || "").trim()) {
      this.store.addDiary(agent.id, plan.diary);
      summary.diary = true;
    }
    return summary;
  }
}
