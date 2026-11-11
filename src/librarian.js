import { BRAIN_SLUG as ARTIFACTS_SLUG } from "./artifacts.js";
import { BODY_LIMIT, BRAIN_KINDS, slugify } from "./company-brain.js";
import { parseJsonObject } from "./memory.js";
import { SHARED, brainChain } from "./store.js";

// The first night looks back this far; later nights start where the last one stopped.
const BACKFILL_MS = 30 * 24 * 60 * 60 * 1000;
const RUN_MESSAGES = 1500;
const BATCH_CHARS = 24000;
const PAGES_PER_BATCH = 15;
const INDEX_PAGES = 200;
// Grok Build keeps only the first ~96 KB and the last ~4 KB of a longer prompt and
// drops the middle; smaller models have small windows too. The batch's chats, notes
// and rules always go whole: what is left holds the pages, whole or not at all.
const PROMPT_BYTES = 80000;
const bytes = (text) => Buffer.byteLength(text, "utf8");
const LOG_EVENTS = 200;

const SYSTEM = "Sei il bibliotecario del brain aziendale. Rispondi solo con JSON valido.";

/**
 * The company brain's librarian: new notes queue a run, and the nightly pass
 * reads what was said since its last run (every channel, shared memories once), asks the
 * brain's model what the company now knows, and writes those pages with their
 * sources. Every change is live at once and waits for the owner's morning look,
 * which never holds anything up. In the morning it tells the owner what changed.
 */
export class Librarian {
  constructor({ brain, store, llm, log = () => {}, traces = null, timezone = "Europe/Rome", channelLabel = (id) => id, notify = async () => {}, messageOwner = async () => false, reviewUrl = () => "", knowledge = null, ownerId = "" }) {
    this.brain = brain;
    this.timezone = timezone;
    this.store = store;
    this.llm = llm;
    this.log = log;
    this.traces = traces;
    this.channelLabel = channelLabel;
    this.notify = notify;
    this.messageOwner = messageOwner;
    this.reviewUrl = reviewUrl;
    this.knowledge = knowledge;
    this.ownerId = ownerId;
    this.workers = new Map();
    this.running = false;
    this.pending = false;
    this.progress = null;
    this.timer = null;
    this.stopped = false;
    this.idle = Promise.resolve();
  }

  requestRun({ reason = "memoria" } = {}) {
    if (this.stopped || !this.brain?.enabled) return false;
    this.pending = true;
    this.pendingReason = reason;
    this.queueRun();
    return true;
  }

  queueRun() {
    if (this.stopped || this.running || this.timer || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped || this.running || !this.pending) return;
      const reason = this.pendingReason;
      this.pending = false;
      this.run({ reason }).catch((error) => { if (!this.stopped) this.log({ type: "error", text: `bibliotecario: ${error.message}` }); });
    }, 0);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    this.pending = false;
    clearTimeout(this.timer);
    this.timer = null;
    return Promise.all([this.idle, ...[...this.workers.values()].map((worker) => worker.stop())]);
  }

  forOwner(ownerId) {
    if (!this.knowledge?.ownerMemory) return this;
    if (!this.workers.has(ownerId)) this.workers.set(ownerId, new Librarian({ brain: this.knowledge.ownerBrain(ownerId), store: this.store, llm: this.llm, log: (entry) => this.log({ ...entry, ownerId }), traces: this.traces, timezone: this.timezone,
      channelLabel: this.channelLabel, notify: (notice) => this.notify({ ...notice, userId: ownerId }), messageOwner: (text) => this.messageOwner(text, ownerId), reviewUrl: this.reviewUrl, knowledge: this.knowledge, ownerId }));
    return this.workers.get(ownerId);
  }

  async runOwners(options) {
    if (this.stopped) return { status: "stopped" };
    if (this.running) return { status: "busy" };
    clearTimeout(this.timer); this.timer = null; this.pending = false;
    this.running = true;
    let finish; this.idle = new Promise((resolve) => { finish = resolve; });
    try {
      const results = [];
      for (const id of this.knowledge.ownerIds()) {
        if (this.stopped) break;
        results.push(await this.forOwner(id).run(options));
      }
      return { status: results.some((result) => result.status === "partial") ? "partial" : "done", owners: results.length };
    } finally { this.running = false; finish(); this.queueRun(); }
  }

  get model() {
    return this.store.settings.brainModel || this.store.settings.defaultModel;
  }

  /**
   * One answer from the librarian's model, or from the first backup that gives one:
   * a model that is disconnected, out of credits or refused does not stop the night.
   * The owner hears once a day when a backup was needed, and when none answered.
   */
  async think(prompt) {
    const chain = brainChain(this.store.settings);
    const failures = [];
    for (const [index, { model, subscriptionId, credentialId }] of chain.entries()) {
      const trace = this.traces?.start({ agentId: this.ownerId ? `librarian:${this.ownerId}` : "librarian", kind: "librarian", model, system: SYSTEM, prompt });
      if (this.progress) Object.assign(this.progress, { model, traceId: trace?.id || null });
      this.step(index ? "model" : "ask", index ? `Passa alla riserva ${model}` : `Chiede a ${model}`, { model, traceId: trace?.id || null });
      try {
        const result = this.llm.isAgentic(model)
          ? await this.llm.runAgent({ model, subscriptionId: subscriptionId || undefined, credentialId: credentialId || "", system: SYSTEM, prompt, tools: [], execute: null, timeoutMs: 10 * 60 * 1000, onStep: (step) => trace?.add(step) })
          : await this.llm.chat({ model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], tools: [] });
        if (result.thinking) trace?.add({ type: "thinking", text: result.thinking });
        trace?.spent(result.usage);
        trace?.finish({ status: "done", output: result.text });
        this.usedModel = model;
        if (index) await this.warn("backup", `Il bibliotecario ha usato il modello di riserva ${model}: ${failures.join(" · ")}`);
        return { text: result.text, traceId: trace?.id || null };
      } catch (error) {
        trace?.finish({ status: "error", error: error.message });
        if (this.stopped) throw error;
        failures.push(`${model} non ha risposto (${String(error.message).replace(/\s+/g, " ").slice(0, 160)})`);
        this.step("error", `${model} non ha risposto: ${String(error.message).replace(/\s+/g, " ").slice(0, 160)}`, { model });
        this.log({ type: "error", text: `bibliotecario: ${model}: ${error.message}` });
      }
    }
    const text = failures.length ? `Nessun modello del bibliotecario ha risposto: ${failures.join(" · ")}` : "Il bibliotecario non ha un modello";
    await this.warn("down", text);
    throw new Error(text);
  }

  /** Tells the owner, on the phone and in private, at most once a day for each kind of trouble. */
  async warn(kind, text) {
    const day = new Date().toLocaleDateString("sv-SE", { timeZone: this.timezone });
    const key = `warned:${kind}`;
    try {
      if ((await this.brain.state(key, "")) === day) return;
      await this.brain.setState(key, day);
    } catch {}
    const body = text.slice(0, 600);
    await this.notify({ title: "Brain", body: body.slice(0, 180), url: "/#/brain", tag: `brain-${kind}` }).catch(() => {});
    await this.messageOwner(`🧠 ${body}\nModelli di riserva: pannello, Brain → Il bibliotecario.`).catch((error) => this.log({ type: "error", text: `brain: messaggio al proprietario: ${error.message}` }));
  }

  /** Consolidate notes and chats since the last successful batch. */
  async run({ reason = "notte" } = {}) {
    try { this.store.assertContentWriteAllowed(); } catch (error) { if (error.status === 409) return { status: "encrypted-only" }; throw error; }
    if (this.knowledge?.ownerMemory && !this.ownerId) return this.runOwners({ reason });
    if (this.stopped) return { status: "stopped" };
    if (!this.brain?.enabled) return { status: "disabled" };
    if (this.running) return { status: "busy" };
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.running = true;
    let finish;
    this.idle = new Promise((resolve) => { finish = resolve; });
    const started = Date.now();
    this.progress = { startedAt: new Date(started).toISOString(), batch: 0, batches: 0, messages: 0, notes: 0, model: "", traceId: null, events: [] };
    this.usedModel = "";
    try {
      const last = await this.brain.state("lastRun", null);
      const since = Number(last?.until) || started - BACKFILL_MS;
      const sourceMessages = this.ownerId ? this.knowledge.messagesSince(this.ownerId, since, RUN_MESSAGES) : this.store.messagesSince(this.store.archivedChannels(), since, RUN_MESSAGES);
      const messages = sourceMessages
        .filter((message) => String(message.content || "").trim().length > 3 && (this.ownerId ? this.knowledge.messageOwner(message) === this.ownerId : !this.knowledge?.sealedMessage(message)));
      const notes = await this.brain.notes();
      const shared = this.ownerId || (await this.brain.state("sharedImported", false)) ? [] : this.store.memories(SHARED);
      // Every message joins the searchable archive, whatever the librarian makes of it.
      await this.brain.addChunks(messages.map((message) => ({ id: `msg:${message.id}`, source: "message", channelId: message.channelId, at: message.at, author: message.authorName, text: message.content })));
      const totals = { created: 0, updated: 0, flagged: 0, skipped: 0, batches: 0, errors: [], traceIds: [] };
      const batches = this.batches(messages);
      if (!batches.length && (notes.length || shared.length)) batches.push([]);
      let until = since;
      Object.assign(this.progress, { batches: batches.length, messages: messages.length, notes: notes.length + shared.length });
      this.step("read", batches.length
        ? `Legge ${messages.length} ${messages.length === 1 ? "messaggio nuovo" : "messaggi nuovi"} e ${notes.length + shared.length} ${notes.length + shared.length === 1 ? "nota" : "note"} degli agenti: ${batches.length} ${batches.length === 1 ? "lotto" : "lotti"}`
        : "Niente di nuovo da leggere dall'ultimo giro");
      for (const [index, batch] of batches.entries()) {
        this.progress.batch = index + 1;
        if (batches.length > 1) this.step("batch", `Lotto ${index + 1} di ${batches.length}: ${batch.length} messaggi`);
        try {
          const done = await this.batch(batch, index === 0 ? notes : [], index === 0 ? shared : []);
          for (const key of ["created", "updated", "flagged", "skipped"]) totals[key] += done[key];
          if (done.traceId) totals.traceIds.push(done.traceId);
          totals.batches += 1;
          until = Math.max(until, ...batch.map((message) => message.at));
          if (index === 0) {
            await this.brain.useNotes(notes.map((note) => note.id));
            if (shared.length) await this.brain.setState("sharedImported", true);
          }
        } catch (error) {
          // The rest waits for the next run, which starts from the first message this one did not read.
          totals.errors.push(error.message.slice(0, 200));
          this.step("error", `Si ferma: ${error.message.slice(0, 200)}`);
          this.log({ type: "error", text: `bibliotecario: ${error.message}` });
          break;
        }
      }
      if (!totals.errors.length) this.step("done", `Fatto: ${totals.created} ${totals.created === 1 ? "pagina nuova" : "pagine nuove"}, ${totals.updated} ${totals.updated === 1 ? "aggiornata" : "aggiornate"}${totals.skipped ? `, ${totals.skipped} ${totals.skipped === 1 ? "scartata" : "scartate"}` : ""}`);
      const record = { at: new Date().toISOString(), startedAt: this.progress.startedAt, until, reason, model: this.usedModel || this.model, messages: messages.length, notes: notes.length, ms: Date.now() - started, ...totals, log: this.progress.events.slice(-LOG_EVENTS) };
      await this.brain.setState("lastRun", record);
      if (totals.created || totals.updated) this.log({ type: "brain", text: `bibliotecario: ${totals.created} pagine nuove, ${totals.updated} aggiornate${totals.flagged ? `, ${totals.flagged} da verificare` : ""}` });
      return { status: totals.errors.length ? "partial" : "done", ...record };
    } finally {
      this.running = false;
      this.progress = null;
      finish();
      this.queueRun();
    }
  }

  /** One line of what the running librarian is doing, for the panel to follow live. */
  step(kind, text, extra = {}) {
    if (!this.progress) return;
    this.progress.events.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 1200), ...extra });
    if (this.progress.events.length > LOG_EVENTS) this.progress.events.shift();
  }

  /** The messages in batches a model can read whole, oldest first. */
  batches(messages) {
    const batches = [];
    let current = [];
    let size = 0;
    for (const message of messages) {
      const length = Math.min(600, String(message.content).length) + 80;
      if (current.length && size + length > BATCH_CHARS) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push(message);
      size += length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  when(at) {
    return new Date(at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: this.timezone });
  }

  async batch(messages, notes, shared) {
    const refs = new Map();
    const lines = messages.map((message, index) => {
      const ref = `m${index + 1}`;
      refs.set(ref, { type: "message", id: message.id, channelId: message.channelId, channel: this.channelLabel(message.channelId), at: new Date(message.at).toISOString(), author: message.authorName, quote: String(message.content).slice(0, 240) });
      const who = message.kind === "owner" ? `${message.authorName} ★` : message.kind === "agent" ? `${message.authorName} (agente)` : message.authorName;
      return `[${ref}] ${this.when(message.at)} ${this.channelLabel(message.channelId)} ${who}: ${String(message.content).replace(/\s+/g, " ").slice(0, 600)}`;
    });
    const noteLines = [
      ...notes.map((note, index) => {
        refs.set(`n${index + 1}`, { type: "note", id: note.id, author: note.author, at: note.createdAt, quote: note.text.slice(0, 240) });
        return `[n${index + 1}] ${note.author || "un agente"}: ${note.text.replace(/\s+/g, " ").slice(0, 600)}`;
      }),
      ...shared.map((memory, index) => {
        refs.set(`s${index + 1}`, { type: "memory", id: memory.id, quote: memory.text.slice(0, 240) });
        return `[s${index + 1}] ${memory.text.replace(/\s+/g, " ").slice(0, 600)}`;
      }),
    ];
    const all = await this.brain.pages();
    const probe = [...messages.map((message) => message.content), ...notes.map((note) => note.text), ...shared.map((memory) => memory.text)].join(" ").slice(0, 4000);
    const near = (await Promise.all((await this.brain.search(probe, { limit: 8 })).map((page) => this.brain.page(page.slug)))).filter(Boolean);
    const head = "Sei il bibliotecario di quest'azienda: tieni il brain aziendale, le pagine che dicono cosa sa l'azienda. Ogni pagina è un cliente (client), un progetto (project), una persona (person), una decisione (decision), una procedura (procedure) o un tema (topic).";
    const notesPart = noteLines.length ? `## Note degli agenti e ricordi condivisi\n${noteLines.join("\n")}` : "";
    const chatsPart = lines.length ? `## Conversazioni nuove\n${lines.join("\n")}` : "";
    const rules = [
      "Rispondi SOLO con un oggetto JSON:",
      '{"reasoning": "in 2-5 frasi: cosa hai trovato di nuovo, cosa cambi, cosa lasci fuori e perché", "pages": [{"slug": "slug-esistente-o-nuovo", "kind": "client|project|person|decision|procedure|topic", "title": "…", "summary": "una o due frasi", "body": "il testo COMPLETO della pagina dopo la modifica: elenchi brevi, fatti con la data, [[slug]] per citare altre pagine", "note": "cosa è cambiato, in una riga", "sources": ["m3", "n1"], "conflict": ""}]}',
      "Regole:",
      "- Solo sapere durevole dell'azienda: clienti, progetti e il loro stato, persone e ruoli, decisioni (con data e chi), procedure, impegni e scadenze. Niente chiacchiere, saluti, prove tecniche o lavoro ormai superato.",
      "- Ogni fatto nuovo viene dalle conversazioni o dalle note qui sopra: in \"sources\" metti i riferimenti [m…], [n…] o [s…] da cui viene. Non inventare nulla.",
      "- Per cambiare una pagina esistente usa il suo slug e riscrivi il testo completo, tenendo tutto ciò che è ancora vero. Cambia solo le pagine che vedi qui sopra per intero: le altre dell'elenco servono a non creare doppioni.",
      "- Se una cosa nuova contraddice la pagina non scegliere: scrivi entrambe le versioni con le date e spiega la contraddizione in \"conflict\".",
      "- Una pagina nuova solo se l'argomento non ne ha già una. Al massimo 15 pagine per risposta; se non c'è niente di nuovo da sapere, {\"pages\": []}.",
      "- Mai password, token, chiavi o altri segreti nelle pagine, nemmeno se compaiono nelle conversazioni: al più dove sono conservati (es. «in hush come NOME»).",
      "- Scrivi nella lingua delle conversazioni.",
    ].join("\n");
    let room = PROMPT_BYTES - bytes([head, notesPart, chatsPart, rules].join("\n\n")) - 200;
    const listed = all.slice(0, INDEX_PAGES);
    const bare = listed.map((page) => `- ${page.slug} | ${page.kind} | ${page.title}`);
    const shown = [];
    let nearSize = 0;
    for (const page of near) {
      const text = `### ${page.slug} (${page.kind}): ${page.title}\n${page.summary}\n${page.body}`;
      if (nearSize + bytes(text) + 2 > room - bytes(bare.join("\n")) - 40) continue;
      shown.push({ page, text });
      nearSize += bytes(text) + 2;
    }
    room -= nearSize;
    let index = [];
    for (const width of [160, 60, 0]) {
      const lines = listed.map((page, at) => `${bare[at]}${width && page.summary ? ` — ${page.summary.slice(0, width)}` : ""}`);
      if (bytes(lines.join("\n")) + 40 <= room) { index = lines; break; }
    }
    if (!index.length) {
      let size = 40;
      for (const line of bare) {
        if (size + bytes(line) + 1 > room) break;
        index.push(line);
        size += bytes(line) + 1;
      }
    }
    const whole = new Set(shown.map(({ page }) => page.slug));
    const prompt = [
      head,
      `## Pagine esistenti\n${index.length ? index.join("\n") : listed.length ? "(troppe per elencarle qui)" : "(ancora nessuna)"}`,
      shown.length ? `## Pagine che potrebbero cambiare, per intero\n${shown.map(({ text }) => text).join("\n\n")}` : "",
      notesPart,
      chatsPart,
      rules,
    ].filter(Boolean).join("\n\n");
    let { text, traceId } = await this.think(prompt);
    let answer;
    try {
      answer = parseJsonObject(text);
    } catch (error) {
      // A long answer can break its own JSON (a quote left bare): the batch is asked once more, with the error, before the run stops on it.
      this.step("error", `La risposta non era JSON valido: la richiede (${error.message.slice(0, 120)})`);
      ({ text, traceId } = await this.think(`${prompt}\n\nLa tua risposta precedente non era JSON valido (${error.message.slice(0, 200)}). Rispondi di nuovo con lo stesso contenuto, solo JSON valido: dentro le stringhe le virgolette vanno scritte \\" e gli a capo \\n.`));
      answer = parseJsonObject(text);
    }
    const known = new Map(all.map((page) => [page.slug, page]));
    const done = { created: 0, updated: 0, flagged: 0, skipped: 0, traceId };
    if (String(answer.reasoning || "").trim()) this.step("reasoning", String(answer.reasoning).trim(), { model: this.usedModel });
    if (Array.isArray(answer.pages) && !answer.pages.length) this.step("page", "Niente da cambiare nel brain");
    for (const change of (Array.isArray(answer.pages) ? answer.pages : []).slice(0, PAGES_PER_BATCH)) {
      const sources = [...new Set((Array.isArray(change.sources) ? change.sources : []).map(String))].map((ref) => refs.get(ref)).filter(Boolean);
      const slug = slugify(change.slug || change.title);
      const body = String(change.body || "").trim();
      // A fact with no source it can be traced to is not written: that is how the brain stays honest.
      // The artifact catalog is Cora's own: it follows the folders, not the chats.
      if (!slug || slug === ARTIFACTS_SLUG || !String(change.title || "").trim() || !body || !sources.length) {
        done.skipped += 1;
        this.step("skip", `Scarta «${String(change.title || change.slug || "senza titolo").slice(0, 80)}»: ${!sources.length ? "nessuna fonte citata" : slug === ARTIFACTS_SLUG ? "la pagina degli artefatti la tiene Cora" : "pagina incompleta"}`);
        continue;
      }
      // A page the model did not read whole would lose what it did not see.
      if (known.has(slug) && !whole.has(slug)) {
        done.skipped += 1;
        this.step("skip", `Scarta «${String(change.title).slice(0, 80)}»: la pagina esistente non era nel prompt per intero`, { slug });
        continue;
      }
      const conflict = String(change.conflict || "").trim();
      const { action } = await this.brain.write({
        slug, kind: BRAIN_KINDS.includes(change.kind) ? change.kind : known.get(slug)?.kind || "topic",
        title: change.title, summary: change.summary, body: body.slice(0, BODY_LIMIT), note: change.note, sources, author: "librarian", conflict,
      });
      if (action === "create") done.created += 1;
      else done.updated += 1;
      this.step("page", `${action === "create" ? "Crea" : "Aggiorna"} «${String(change.title).slice(0, 80)}»${change.note ? `: ${String(change.note).slice(0, 200)}` : ""}${conflict ? " ⚠ contraddizione" : ""}`, { slug, action, sources: sources.length });
      if (conflict) done.flagged += 1;
    }
    return done;
  }

  /**
   * The morning note to the owner: what changed and waits for a look, on the
   * phone and in a private message, with the link to the review. Not answering
   * changes nothing: the pages stay as they are.
   */
  async digest() {
    if (this.knowledge?.ownerMemory && !this.ownerId) {
      const results = [];
      for (const id of this.knowledge.ownerIds()) results.push(await this.forOwner(id).digest());
      return { status: results.some((result) => result.status === "sent") ? "sent" : "nothing", owners: results.length };
    }
    if (!this.brain?.enabled) return { status: "disabled" };
    const queue = await this.brain.reviewQueue();
    const last = Number(await this.brain.state("lastDigest", 0)) || 0;
    if (!queue.some((revision) => Date.parse(revision.createdAt) > last)) {
      await this.brain.setState("lastDigest", Date.now());
      return { status: "nothing" };
    }
    const created = queue.filter((revision) => revision.action === "create").length;
    const updated = queue.length - created;
    const flagged = queue.filter((revision) => revision.review === "flagged").length;
    const pages = new Map();
    for (const revision of queue) pages.set(revision.slug, revision);
    const items = [...pages.values()].slice(0, 8).map((revision) => `• ${revision.title}${revision.review === "flagged" ? " ⚠️" : ""}: ${revision.note || (revision.action === "create" ? "pagina nuova" : "aggiornata")}`);
    if (pages.size > 8) items.push(`…e altre ${pages.size - 8} pagine`);
    const head = `Brain, da rivedere: ${created} ${created === 1 ? "pagina nuova" : "pagine nuove"}, ${updated} ${updated === 1 ? "modifica" : "modifiche"}${flagged ? `, ${flagged} da verificare` : ""}.`;
    const url = this.reviewUrl();
    const text = [`🧠 ${head}`, ...items, "", `Valgono già; se non fai niente restano così.${url ? ` Rivedi: ${url}` : " Rivedi nel pannello, sezione Brain."}`].join("\n");
    await this.notify({ title: "Brain", body: head, url: "/#/brain/revisione", tag: "brain-review" }).catch(() => {});
    const sent = await this.messageOwner(text).catch((error) => {
      this.log({ type: "error", text: `brain: messaggio al proprietario: ${error.message}` });
      return false;
    });
    await this.brain.setState("lastDigest", Date.now());
    return { status: "sent", sent: Boolean(sent), text };
  }
}
