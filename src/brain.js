import { readFileSync, statSync } from "node:fs";
import { Memory, parseJsonObject } from "./memory.js";
import { isTelegramChannel } from "./channels.js";
import { SALOTTO, isWebRoom, privateRoom } from "./rooms.js";
import { SHARED } from "./store.js";
import { MEMORY_TOOLS, TOOL_DEFS, executeTool, summarizeArgs } from "./tools.js";
import { NO_TRACE } from "./traces.js";
import { nextRuns } from "./scheduler.js";

const CHAT_STEPS = 14;
const ROUTINE_STEPS = 30;
const CHAT_DEADLINE_MS = 6 * 60 * 1000;
const ROUTINE_DEADLINE_MS = 15 * 60 * 1000;
const SLEEP_MESSAGES = 400;

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

  systemPrompt(agent, { place, computer }) {
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
    if (computer) {
      sections.push([
        "## Il tuo computer",
        "Hai un tuo computer Linux con desktop (XFCE, Chromium, terminale, node, python3, sudo). Il proprietario può vedere e usare lo stesso desktop dal pannello. I file nella tua home restano tra un riavvio e l'altro.",
        "Usa gli strumenti quando ti chiedono di fare qualcosa davvero (cercare, controllare, scrivere file, aprire siti): agisci invece di descrivere cosa faresti.",
        "Sul tuo computer sei amministratore: con shell puoi installare, scrivere file e avviare servizi. Se l'ambiente in cui giri ti dice di essere in sola lettura, vale solo per quello, non per il tuo computer né per i tuoi strumenti.",
        "Le tue routine (compiti a orari fissi) le gestisci tu con list_routines, set_routine e delete_routine: quando il proprietario te ne chiede una, creala o sistemala subito.",
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

  async chatTurn({ agent, history, channel, forced, computer, postFile, say, inbox }) {
    const transcript = formatTranscript(history, agent, this.timezone);
    const last = history[history.length - 1];
    const query = history.slice(-6).map((item) => item.content).join(" ");
    const instruction = forced
      ? `${last?.authorName || "Qualcuno"} si è rivolto a te: rispondi (non PASS). Se ti serve lavorare, la prima cosa che fai è say con due parole (es. «Ricevuto, ci guardo»), poi lo tieni aggiornato con say a ogni passo importante, e alla fine scrivi il risultato.`
      : "Decidi se intervenire. Se non hai niente da aggiungere rispondi solo PASS.";
    const user = [
      this.memoryContext(agent, query),
      `Ultimi messaggi ${channel.where || `in #${channel.name}`}${channel.note ? ` (${channel.note})` : ""}:\n<chat>\n${transcript}\n</chat>`,
      instruction,
    ].join("\n\n");
    const turn = (prompt) => this.loop({
      agent, mode: "chat", channel, user: prompt, computer, postFile, say, inbox,
      maxSteps: CHAT_STEPS, deadline: Date.now() + CHAT_DEADLINE_MS,
      images: (last?.images || []).slice(0, 2),
    });
    const result = await turn(user);
    if (result.text || !forced) return result;
    // Called by name and still passing: ask once more, plainly.
    return turn(`${user}\n\nHai risposto PASS, ma ${last?.authorName || "qualcuno"} ti ha chiamato per nome: scrivi una risposta vera, anche breve.`);
  }

  async routineTurn({ agent, routine, history, channel, postFile, say, inbox }) {
    const transcript = formatTranscript(history.slice(-12), agent, this.timezone);
    const user = [
      this.memoryContext(agent, `${routine.name} ${routine.prompt}`),
      `È il momento della tua routine "${routine.name}" (pianificazione: ${routine.schedule}).`,
      `Compito:\n${routine.prompt}`,
      `Usa il tuo computer se serve. Alla fine scrivi il messaggio da pubblicare ${channel.where || `in #${channel.name}`}: è quello che vedrà il proprietario. Se non c'è niente da segnalare rispondi solo PASS.`,
      transcript ? `Contesto recente del canale:\n<chat>\n${transcript}\n</chat>` : "",
    ].filter(Boolean).join("\n\n");
    return this.loop({
      agent, mode: "routine", channel, user, computer: agent.tools, postFile, say, inbox,
      maxSteps: ROUTINE_STEPS, deadline: Date.now() + ROUTINE_DEADLINE_MS, images: [],
    });
  }

  startTrace(fields) {
    return this.traces ? this.traces.start(fields) : NO_TRACE;
  }

  async loop({ agent, mode, channel, user, computer, postFile, say = null, inbox = null, maxSteps, deadline, images }) {
    const model = agent.model || this.store.settings.defaultModel;
    const caps = await this.llm.capabilities(model);
    const tools = caps.tools ? TOOL_DEFS.filter((tool) => MEMORY_TOOLS.has(tool.name) || computer) : [];
    const place = channel.place || "";
    const system = this.systemPrompt(agent, { place, computer: computer && caps.tools });
    const prompt = `Ora: ${formatNow(this.timezone)}.\n\n${user}`;
    const trace = this.startTrace({ agentId: agent.id, kind: mode, channelId: channel.id, model, system, prompt });
    const ctx = {
      agent, boxes: this.boxes, store: this.store, memory: this.memory, channelId: channel.id, postFile, log: this.log, push: this.push,
      ask: this.ask ? (request) => this.ask(agent, request) : null,
      say,
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
      const output = allowed ? await executeTool({ name, args }, ctx) : { text: `error: the tool ${name} is not available now` };
      const ok = !output.text.startsWith("error:");
      this.log?.({
        type: "tool", agentId: agent.id, channelId: channel.id, tool: name,
        args: summarizeArgs(name, args || {}), ok, ms: Date.now() - started, traceId: trace.id,
      });
      trace.add({ type: "tool", name, args: args || {}, result: output.text, ok, ms: Date.now() - started, image: Boolean(output.image) });
      const steer = news();
      return steer ? { ...output, text: `${output.text}\n\n${steer}` } : output;
    };
    // New chat messages reach a working agent with its next tool result (or its next step on Ollama).
    const news = () => {
      const fresh = inbox?.() || [];
      if (!fresh.length) return "";
      trace.add({ type: "note", text: `Nuovi messaggi mentre lavora:\n${fresh.map((item) => `${item.authorName}: ${item.content}`).join("\n")}` });
      return `[Nel frattempo nella chat]\n${formatTranscript(fresh, agent, this.timezone)}\n(Se cambiano quello che ti chiedono, adatta il piano.)`;
    };
    const done = (raw, steps) => {
      const text = cleanReply(raw, agent);
      trace.finish({ status: text ? "done" : "pass", output: raw });
      return { text, steps, traceId: trace.id };
    };

    try {
      if (this.llm.isAgentic(model)) {
        const result = await this.llm.runAgent({
          model, system, prompt, tools, execute: runTool, timeoutMs: Math.max(30000, deadline - Date.now()), onStep: (step) => trace.add(step), effort: effortOf(agent),
        });
        return done(result.text, 0);
      }

      const messages = [{ role: "system", content: system }, { role: "user", content: prompt, images }];
      const think = (result) => {
        const inline = [...String(result.text || "").matchAll(/<think>([\s\S]*?)<\/think>/gi)].map((match) => match[1].trim()).filter(Boolean);
        for (const text of [result.thinking, ...inline]) if (String(text || "").trim()) trace.add({ type: "thinking", text });
      };
      let steps = 0;
      for (; steps < maxSteps && Date.now() < deadline; steps += 1) {
        if (steps > 0) {
          const steer = news();
          if (steer) messages.push({ role: "user", content: steer });
        }
        const result = await this.llm.chat({ model, messages, tools, effort: effortOf(agent) });
        think(result);
        if (!result.toolCalls.length) return done(result.text, steps);
        const said = String(result.text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        if (said) trace.add({ type: "text", text: said });
        messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          const output = await runTool(call.name, call.args || {});
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: output.text, image: output.image });
        }
      }
      trace.add({ type: "note", text: "Finiti il tempo o i passi a disposizione: chiedo il messaggio finale." });
      messages.push({ role: "user", content: "Hai finito il tempo o i passi a disposizione: scrivi ora il messaggio finale con quello che hai ottenuto." });
      const final = await this.llm.chat({ model, messages, tools: [], effort: "low" });
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
