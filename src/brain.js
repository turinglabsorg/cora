import { readFileSync, statSync } from "node:fs";
import { Memory, parseJsonObject } from "./memory.js";
import { isTelegramChannel } from "./channels.js";
import { SALOTTO, isWebRoom, privateRoom } from "./rooms.js";
import { SHARED } from "./store.js";
import { MEMORY_TOOLS, TOOL_DEFS, executeTool, summarizeArgs } from "./tools.js";
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
    const personal = this.ownerInstructions().trim();
    if (personal) {
      sections.push(`## Istruzioni personali del proprietario\nIl tuo proprietario vuole che tu segua anche le sue istruzioni personali per gli agenti. Valgono per te quando sono pertinenti a quello che fai qui.\nSono già tutte qui sotto: quando dicono di leggere o rileggere ~/.agents/AGENTS.md (o altri file del proprietario) consideralo fatto. Quei percorsi sono sui computer del proprietario, non sul tuo: non cercarli e non segnalare che mancano.\n\n<istruzioni_personali>\n${personal}\n</istruzioni_personali>`);
    }
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

  async chatTurn({ agent, history, channel, forced, computer, postFile, say, inbox }) {
    const transcript = formatTranscript(history, agent, this.timezone);
    const last = history[history.length - 1];
    const query = history.slice(-6).map((item) => item.content).join(" ");
    const instruction = forced
      ? `${last?.authorName || "Qualcuno"} si è rivolto a te: rispondi (non PASS). Se ti serve lavorare, la prima cosa che fai è say con due parole (es. «Ricevuto, ci guardo»), poi lo tieni aggiornato con say a ogni passo importante, e alla fine scrivi il risultato.`
      : "Decidi se intervenire. Se non hai niente da aggiungere rispondi solo PASS.";
    const user = [
      this.memoryContext(agent, query),
      this.elsewhere(agent, channel.id),
      `Ultimi messaggi ${channel.where || `in #${channel.name}`}${channel.note ? ` (${channel.note})` : ""}:\n<chat>\n${transcript}\n</chat>`,
      instruction,
    ].filter(Boolean).join("\n\n");
    const turn = (prompt) => this.loop({
      agent, mode: "chat", channel, user: prompt, computer, postFile, say, inbox,
      maxSteps: computer ? TASK_STEPS : CHAT_STEPS, deadline: Date.now() + (computer ? TASK_DEADLINE_MS : CHAT_DEADLINE_MS),
      images: (last?.images || []).slice(0, 2), task: Boolean(computer),
    });
    const result = await turn(user);
    // A question to the owner is already an answer: it is in the chat.
    if (result.text || !forced || result.asked) return result;
    // Called by name and still passing: ask once more, plainly.
    return turn(`${user}\n\nHai risposto PASS, ma ${last?.authorName || "qualcuno"} ti ha chiamato per nome: scrivi una risposta vera, anche breve. Se ti chiede qualcosa che non puoi fare da solo, diglielo, oppure chiedi il via libera al proprietario con ask_owner.`);
  }

  async routineTurn({ agent, routine, history, channel, postFile, say, inbox }) {
    const transcript = formatTranscript(history.slice(-12), agent, this.timezone);
    const user = [
      this.memoryContext(agent, `${routine.name} ${routine.prompt}`),
      this.elsewhere(agent, channel.id),
      `È il momento della tua routine "${routine.name}" (pianificazione: ${routine.schedule}).`,
      `Compito:\n${routine.prompt}`,
      'Come prima cosa manda con say una riga che dice quale routine è partita e cosa vai a controllare di preciso: chi legge deve capire cosa stai facendo, non basta "ci guardo" o "ci penso io". Poi mettiti al lavoro.',
      `Usa il tuo computer se serve. Alla fine scrivi il messaggio da pubblicare ${channel.where || `in #${channel.name}`}: è quello che vedrà il proprietario. Se non c'è niente da segnalare rispondi solo PASS.`,
      transcript ? `Contesto recente del canale:\n<chat>\n${transcript}\n</chat>` : "",
    ].filter(Boolean).join("\n\n");
    return this.loop({
      agent, mode: "routine", channel, user, computer: agent.tools, postFile, say, inbox,
      maxSteps: ROUTINE_STEPS, deadline: Date.now() + ROUTINE_DEADLINE_MS, images: [], task: Boolean(agent.tools),
    });
  }

  /**
   * A task cut short by a restart of Cora: the same instructions, the last
   * steps the agent had taken, and the request to check where things stand
   * and finish.
   */
  async resumeTurn({ agent, trace, channel, postFile, say, inbox }) {
    const steps = (trace.steps || []).filter((step) => step.type === "tool" || step.type === "text").slice(-20).map((step) => step.type === "tool"
      ? `- ${step.name} ${JSON.stringify(step.args || {}).slice(0, 300)} → ${String(step.result || "").replace(/\s+/g, " ").slice(0, 300)}`
      : `- (scritto) ${String(step.text || "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const original = String(trace.prompt || "").replace(/^Ora: [^\n]*\n\n/, "");
    const user = [
      original,
      `[Cora] Cora si è riavviata mentre lavoravi a questo compito (iniziato ${formatWhen(Date.parse(trace.startedAt), this.timezone)}). Gli ultimi passi che avevi fatto:\n${steps || "- (nessuno registrato)"}`,
      "Riprendi da dove eri: controlla com'è la situazione adesso (qualcosa potrebbe essere già fatto), poi porta a termine il compito e scrivi il risultato.",
    ].join("\n\n");
    return this.loop({
      agent, mode: trace.kind === "routine" ? "routine" : "chat", channel, user, computer: agent.tools, postFile, say, inbox,
      maxSteps: TASK_STEPS, deadline: Date.now() + TASK_DEADLINE_MS, images: [], task: true,
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
  async goalFor(request) {
    const model = this.store.settings.defaultModel;
    if (!model || this.llm.isAgentic(model)) return { goal: "", usage: null };
    try {
      const out = await this.llm.chat({
        model, tools: [], effort: "low",
        messages: [
          { role: "system", content: "Scrivi la condizione di completamento di un compito: cosa deve essere vero e verificato perché sia finito, non i passi per arrivarci. Una riga sola, nella lingua della richiesta, senza preamboli. Se la richiesta non è un compito ma una chiacchiera, rispondi NESSUNO." },
          { role: "user", content: `Richiesta:\n${String(request).slice(0, 4000)}\n\nCondizione di completamento (una riga):` },
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
  async goalCheck(goal, { answer, work }) {
    const model = this.store.settings.defaultModel;
    try {
      const out = await this.llm.chat({
        model, tools: [], effort: "low",
        messages: [
          { role: "system", content: 'Giudichi se un compito è finito. Rispondi SOLO con JSON: {"met": true|false, "reason": "una frase"}. met=true soltanto se la condizione risulta soddisfatta da quello che l\'agente ha davvero fatto, non da quello che promette di fare. La reason va nella lingua della condizione.' },
          { role: "user", content: `Condizione:\n${goal}\n\nCosa ha fatto l'agente:\n${work || "(niente)"}\n\nCosa ha scritto come risultato:\n${answer || "(niente)"}` },
        ],
      });
      const data = parseJsonObject(String(out.text || ""));
      if (!data || typeof data.met !== "boolean") return { met: true, reason: "", usage: out.usage };
      return { met: data.met, reason: String(data.reason || "").trim().slice(0, 300), usage: out.usage };
    } catch {
      return { met: true, reason: "", usage: null };
    }
  }

  async loop({ agent, mode, channel, user, computer, postFile, say = null, inbox = null, maxSteps, deadline, images, task = false }) {
    const model = agent.model || this.store.settings.defaultModel;
    const caps = await this.llm.capabilities(model);
    const tools = caps.tools ? TOOL_DEFS.filter((tool) => MEMORY_TOOLS.has(tool.name) || computer) : [];
    const place = channel.place || "";
    const system = this.systemPrompt(agent, { place, computer: computer && caps.tools, withoutComputer: Boolean(agent.tools && !computer && caps.tools) });
    // Every task carries a goal, and the goal travels with the prompt: whichever harness
    // runs the agent sees the condition it has to meet, in its own words.
    const { goal, usage: goalCost } = task ? await this.goalFor(user) : { goal: "", usage: null };
    // Claude Code checks a goal itself, inside one session: hand it the condition and stand back.
    const nativeGoal = Boolean(goal) && this.llm.hasGoalMode(model);
    const contract = goal && !nativeGoal ? `\n\n[Obiettivo] Il compito è finito solo quando è vero e verificato questo: ${goal}\nLavoraci fino a lì senza chiedere se andare avanti. Ogni volta che ti fermi un controllo separato verifica la condizione: se non è soddisfatta torni al lavoro.` : "";
    const prompt = `Ora: ${formatNow(this.timezone)}.\n\n${user}${contract}`;
    const trace = this.startTrace({ agentId: agent.id, kind: mode, channelId: channel.id, model, system, prompt });
    trace.spent(goalCost);
    if (goal) trace.add({ type: "note", text: `Obiettivo: ${goal}` });
    let asked = false;
    // What the Cora harness watches while an agent works: real work done, and calls repeated without progress.
    let worked = 0;
    let looping = false;
    const recent = [];
    // What the agent really did, in one line each: the goal check reads this, not its promises.
    const did = [];
    let lastUpdate = Date.now();
    const sayTracked = say ? async (text) => {
      lastUpdate = Date.now();
      return say(text);
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
      formatWhen: (ms) => formatWhen(ms, this.timezone),
    };
    const runTool = async (name, args) => {
      const started = Date.now();
      const allowed = tools.some((tool) => tool.name === name);
      const signature = `${name}:${JSON.stringify(args || {})}`;
      recent.push(signature);
      if (recent.length > LOOP_WINDOW) recent.shift();
      const repeated = !MEMORY_TOOLS.has(name) && recent.filter((item) => item === signature).length >= LOOP_REPEATS;
      if (repeated && !looping) {
        looping = true;
        trace.add({ type: "note", text: `Ripete ${name} con gli stessi argomenti: lo fermo.` });
      }
      if (allowed && !MEMORY_TOOLS.has(name)) worked += 1;
      const output = !allowed ? { text: `error: the tool ${name} is not available now` }
        : repeated ? { text: "error: you have already done exactly this several times with the same result. Stop repeating it: write what you have so far and what is blocking you." }
        : await executeTool({ name, args }, ctx);
      const ok = !output.text.startsWith("error:");
      this.log?.({
        type: "tool", agentId: agent.id, channelId: channel.id, tool: name,
        args: summarizeArgs(name, args || {}), ok, ms: Date.now() - started, traceId: trace.id,
      });
      trace.add({ type: "tool", name, args: args || {}, result: output.text, ok, ms: Date.now() - started, image: Boolean(output.image) });
      if (allowed) did.push(`${name} ${summarizeArgs(name, args || {})} → ${ok ? "ok" : output.text.slice(0, 160)}`);
      const steer = news();
      return steer ? { ...output, text: `${output.text}\n\n${steer}` } : output;
    };
    // New chat messages reach a working agent with its next tool result (or its next step on Ollama).
    const news = () => {
      const parts = [];
      const fresh = inbox?.() || [];
      if (fresh.length) {
        trace.add({ type: "note", text: `Nuovi messaggi mentre lavora:\n${fresh.map((item) => `${item.authorName}: ${item.content}`).join("\n")}` });
        parts.push(`[Nel frattempo nella chat]\n${formatTranscript(fresh, agent, this.timezone)}\n(Se cambiano quello che ti chiedono, adatta il piano.)`);
      }
      if (task && sayTracked && Date.now() - lastUpdate > UPDATE_EVERY_MS) {
        lastUpdate = Date.now();
        parts.push("[Cora] Non scrivi in chat da un po': manda con say due righe su a che punto sei, poi continua.");
      }
      return parts.join("\n\n");
    };
    const done = (raw, steps) => {
      const text = cleanReply(raw, agent);
      trace.finish({ status: text ? "done" : "pass", output: raw });
      return { text, steps, traceId: trace.id, asked };
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
      if (!task || !worked || looping || asked || nudges >= NUDGES || Date.now() > deadline - 20000) return null;
      const text = cleanReply(raw, agent);
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
      if (!worked || looping || asked || goalRounds >= GOAL_ROUNDS || Date.now() > deadline - 20000) return null;
      const text = cleanReply(raw, agent);
      const { met, reason, usage } = await this.goalCheck(goal, { answer: text, work: did.slice(-40).join("\n") });
      trace.spent(usage);
      trace.add({ type: "note", text: `Controllo obiettivo: ${met ? "raggiunto" : "non ancora"}${reason ? ` — ${reason}` : ""}` });
      if (met) return null;
      goalRounds += 1;
      return {
        kind: "goal", text,
        prompt: `[Cora] L'obiettivo non è ancora raggiunto: ${reason || "manca la verifica"}. Continua adesso con gli strumenti, senza chiedere se andare avanti e senza annunciare cosa farai. Quando la condizione è vera e verificata, scrivi il risultato.`,
      };
    };
    /** With a goal it is the goal that decides; without one, the harness' own reading of the answer. */
    const nextStep = async (raw) => (nativeGoal ? null : goal ? goalVerdict(raw) : verdict(raw));

    try {
      if (this.llm.isAgentic(model)) {
        const run = (input) => this.llm.runAgent({
          model, system, prompt: input, tools, execute: runTool, timeoutMs: Math.max(30000, deadline - Date.now()), onStep: (step) => trace.add(step), effort: effortOf(agent),
          goal: nativeGoal ? goal : "",
        });
        let result = await run(prompt);
        trace.spent(result.usage);
        let final = result.text;
        for (let next = await nextStep(final); next; next = await nextStep(result.text)) {
          if (next.kind !== "goal") nudges += 1;
          if (next.kind === "confirm") confirmed = true;
          if (next.kind === "unfinished" && sayTracked) await sayTracked(next.text).catch(() => {});
          trace.add({ type: "note", text: `Cora harness: ${next.kind === "confirm" ? "chiedo conferma che sia finito" : "lo rimando al lavoro"}.` });
          result = await run(`${prompt}\n\n[Il tuo turno precedente si è chiuso con: «${cleanReply(result.text, agent) || "(niente)"}»]\n\n${next.prompt}`);
          trace.spent(result.usage);
          if (next.kind === "confirm" && isDone(result.text)) break;
          final = result.text;
        }
        return done(final, 0);
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
      for (; steps < maxSteps && Date.now() < deadline; steps += 1) {
        if (steps > 0) {
          const steer = news();
          if (steer) messages.push({ role: "user", content: steer });
        }
        if (task && size() > COMPACT_CHARS) {
          // Hours of work outgrow any context: the agent writes down where it is and carries on from that.
          const summary = await this.llm.chat({
            model, effort: "low", tools: [],
            messages: [...messages, { role: "user", content: "[Cora] Il lavoro è lungo e la conversazione sta diventando troppo grande. Scrivi un riassunto per te stesso: l'obiettivo, cosa hai già fatto (comandi, file, link e risultati importanti), cosa manca e i prossimi passi. Solo il riassunto." }],
          });
          trace.spent(summary.usage);
          const notes = String(summary.text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim().slice(0, 12000);
          trace.add({ type: "note", text: `Cora harness: conversazione riassunta per continuare.\n${notes}` });
          messages.splice(0, messages.length,
            { role: "system", content: system },
            { role: "user", content: prompt },
            { role: "user", content: `[Cora] Stai lavorando a questo compito da un po'. Il tuo riassunto di dove sei arrivato:\n${notes}\n\nContinua da qui.` });
        }
        const result = await this.llm.chat({ model, messages, tools, effort: effortOf(agent) });
        trace.spent(result.usage);
        think(result);
        if (!result.toolCalls.length) {
          // It confirmed it is done: post the real answer it gave, never the bare "DONE".
          if (isDone(result.text) && lastAnswer) return done(lastAnswer, steps);
          const next = await nextStep(result.text);
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
      if (lastAnswer) return done(lastAnswer, steps);
      trace.add({ type: "note", text: "Lavora da troppo: chiedo il messaggio finale." });
      messages.push({ role: "user", content: "[Cora] Ci stai lavorando da molto: fermati qui e scrivi cosa hai fatto, cosa manca e cosa ti blocca." });
      const final = await this.llm.chat({ model, messages, tools: [], effort: "low" });
      trace.spent(final.usage);
      think(final);
      return done(final.text, steps);
    } catch (error) {
      trace.finish({ status: "error", error: error.message });
      throw error;
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
          ? await this.llm.runAgent({ model, system, prompt, tools: [], execute: null, timeoutMs: 5 * 60 * 1000, onStep: (step) => trace.add(step), effort: effortOf(agent) })
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
