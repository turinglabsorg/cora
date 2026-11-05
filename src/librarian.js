import { BRAIN_SLUG as ARTIFACTS_SLUG } from "./artifacts.js";
import { BODY_LIMIT, BRAIN_KINDS, slugify } from "./company-brain.js";
import { parseJsonObject } from "./memory.js";
import { SHARED } from "./store.js";

// The first night looks back this far; later nights start where the last one stopped.
const BACKFILL_MS = 30 * 24 * 60 * 60 * 1000;
const RUN_MESSAGES = 1500;
const BATCH_CHARS = 24000;
const PAGES_PER_BATCH = 15;
const INDEX_PAGES = 200;

const SYSTEM = "Sei il bibliotecario del brain aziendale. Rispondi solo con JSON valido.";

/**
 * The company brain's librarian: at night it reads what was said since its last
 * run (every channel, the agents' notes, the shared memories once), asks the
 * brain's model what the company now knows, and writes those pages with their
 * sources. Every change is live at once and waits for the owner's morning look,
 * which never holds anything up. In the morning it tells the owner what changed.
 */
export class Librarian {
  constructor({ brain, store, llm, log = () => {}, traces = null, timezone = "Europe/Rome", channelLabel = (id) => id, notify = async () => {}, messageOwner = async () => false, reviewUrl = () => "" }) {
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
    this.running = false;
  }

  get model() {
    return this.store.settings.brainModel || this.store.settings.defaultModel;
  }

  async think(prompt) {
    const model = this.model;
    const trace = this.traces?.start({ agentId: "librarian", kind: "librarian", model, system: SYSTEM, prompt });
    try {
      const result = this.llm.isAgentic(model)
        ? await this.llm.runAgent({ model, system: SYSTEM, prompt, tools: [], execute: null, timeoutMs: 10 * 60 * 1000, onStep: (step) => trace?.add(step) })
        : await this.llm.chat({ model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], tools: [] });
      trace?.spent(result.usage);
      trace?.finish({ status: "done", output: result.text });
      return { text: result.text, traceId: trace?.id || null };
    } catch (error) {
      trace?.finish({ status: "error", error: error.message });
      throw error;
    }
  }

  /** One night's work. `force` runs even when nothing new arrived (the panel's "Aggiorna adesso"). */
  async run({ reason = "notte" } = {}) {
    if (!this.brain?.enabled) return { status: "disabled" };
    if (this.running) return { status: "busy" };
    this.running = true;
    const started = Date.now();
    try {
      const last = await this.brain.state("lastRun", null);
      const since = Number(last?.until) || started - BACKFILL_MS;
      const messages = this.store.messagesSince(this.store.archivedChannels(), since, RUN_MESSAGES)
        .filter((message) => String(message.content || "").trim().length > 3);
      const notes = await this.brain.notes();
      const shared = (await this.brain.state("sharedImported", false)) ? [] : this.store.memories(SHARED);
      // Every message joins the searchable archive, whatever the librarian makes of it.
      await this.brain.addChunks(messages.map((message) => ({ id: `msg:${message.id}`, source: "message", channelId: message.channelId, at: message.at, author: message.authorName, text: message.content })));
      const totals = { created: 0, updated: 0, flagged: 0, skipped: 0, batches: 0, errors: [], traceIds: [] };
      const batches = this.batches(messages);
      if (!batches.length && (notes.length || shared.length)) batches.push([]);
      let until = since;
      for (const [index, batch] of batches.entries()) {
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
          this.log({ type: "error", text: `bibliotecario: ${error.message}` });
          break;
        }
      }
      const record = { at: new Date().toISOString(), until, reason, model: this.model, messages: messages.length, notes: notes.length, ms: Date.now() - started, ...totals };
      await this.brain.setState("lastRun", record);
      if (totals.created || totals.updated) this.log({ type: "brain", text: `bibliotecario: ${totals.created} pagine nuove, ${totals.updated} aggiornate${totals.flagged ? `, ${totals.flagged} da verificare` : ""}` });
      return { status: totals.errors.length ? "partial" : "done", ...record };
    } finally {
      this.running = false;
    }
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
    const index = all.slice(0, INDEX_PAGES).map((page) => `- ${page.slug} | ${page.kind} | ${page.title}${page.summary ? ` — ${page.summary.slice(0, 160)}` : ""}`);
    const probe = [...messages.map((message) => message.content), ...notes.map((note) => note.text), ...shared.map((memory) => memory.text)].join(" ").slice(0, 4000);
    const near = await Promise.all((await this.brain.search(probe, { limit: 8 })).map((page) => this.brain.page(page.slug)));
    const prompt = [
      "Sei il bibliotecario di quest'azienda: tieni il brain aziendale, le pagine che dicono cosa sa l'azienda. Ogni pagina è un cliente (client), un progetto (project), una persona (person), una decisione (decision), una procedura (procedure) o un tema (topic).",
      `## Pagine esistenti\n${index.length ? index.join("\n") : "(ancora nessuna)"}`,
      near.length ? `## Pagine che potrebbero cambiare, per intero\n${near.filter(Boolean).map((page) => `### ${page.slug} (${page.kind}): ${page.title}\n${page.summary}\n${page.body}`).join("\n\n")}` : "",
      noteLines.length ? `## Note degli agenti e ricordi condivisi\n${noteLines.join("\n")}` : "",
      lines.length ? `## Conversazioni nuove\n${lines.join("\n")}` : "",
      [
        "Rispondi SOLO con un oggetto JSON:",
        '{"pages": [{"slug": "slug-esistente-o-nuovo", "kind": "client|project|person|decision|procedure|topic", "title": "…", "summary": "una o due frasi", "body": "il testo COMPLETO della pagina dopo la modifica: elenchi brevi, fatti con la data, [[slug]] per citare altre pagine", "note": "cosa è cambiato, in una riga", "sources": ["m3", "n1"], "conflict": ""}]}',
        "Regole:",
        "- Solo sapere durevole dell'azienda: clienti, progetti e il loro stato, persone e ruoli, decisioni (con data e chi), procedure, impegni e scadenze. Niente chiacchiere, saluti, prove tecniche o lavoro ormai superato.",
        "- Ogni fatto nuovo viene dalle conversazioni o dalle note qui sopra: in \"sources\" metti i riferimenti [m…], [n…] o [s…] da cui viene. Non inventare nulla.",
        "- Per cambiare una pagina esistente usa il suo slug e riscrivi il testo completo, tenendo tutto ciò che è ancora vero.",
        "- Se una cosa nuova contraddice la pagina non scegliere: scrivi entrambe le versioni con le date e spiega la contraddizione in \"conflict\".",
        "- Una pagina nuova solo se l'argomento non ne ha già una. Al massimo 15 pagine per risposta; se non c'è niente di nuovo da sapere, {\"pages\": []}.",
        "- Mai password, token, chiavi o altri segreti nelle pagine, nemmeno se compaiono nelle conversazioni: al più dove sono conservati (es. «in hush come NOME»).",
        "- Scrivi nella lingua delle conversazioni.",
      ].join("\n"),
    ].filter(Boolean).join("\n\n");
    let { text, traceId } = await this.think(prompt);
    let answer;
    try {
      answer = parseJsonObject(text);
    } catch (error) {
      // A long answer can break its own JSON (a quote left bare): the batch is asked once more, with the error, before the run stops on it.
      ({ text, traceId } = await this.think(`${prompt}\n\nLa tua risposta precedente non era JSON valido (${error.message.slice(0, 200)}). Rispondi di nuovo con lo stesso contenuto, solo JSON valido: dentro le stringhe le virgolette vanno scritte \\" e gli a capo \\n.`));
      answer = parseJsonObject(text);
    }
    const known = new Map(all.map((page) => [page.slug, page]));
    const done = { created: 0, updated: 0, flagged: 0, skipped: 0, traceId };
    for (const change of (Array.isArray(answer.pages) ? answer.pages : []).slice(0, PAGES_PER_BATCH)) {
      const sources = [...new Set((Array.isArray(change.sources) ? change.sources : []).map(String))].map((ref) => refs.get(ref)).filter(Boolean);
      const slug = slugify(change.slug || change.title);
      const body = String(change.body || "").trim();
      // A fact with no source it can be traced to is not written: that is how the brain stays honest.
      // The artifact catalog is Cora's own: it follows the folders, not the chats.
      if (!slug || slug === ARTIFACTS_SLUG || !String(change.title || "").trim() || !body || !sources.length) {
        done.skipped += 1;
        continue;
      }
      const conflict = String(change.conflict || "").trim();
      const { action } = await this.brain.write({
        slug, kind: BRAIN_KINDS.includes(change.kind) ? change.kind : known.get(slug)?.kind || "topic",
        title: change.title, summary: change.summary, body: body.slice(0, BODY_LIMIT), note: change.note, sources, author: "librarian", conflict,
      });
      if (action === "create") done.created += 1;
      else done.updated += 1;
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
