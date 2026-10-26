import { randomBytes } from "node:crypto";

/** A task can run for hours: the trace keeps the latest steps, and saves them as it goes. */
const MAX_STEPS = 300;
const SAVE_EVERY_MS = 30000;
const MAX_TEXT = 20000;
const MAX_ARGS = 8000;

function clip(value, max = MAX_TEXT) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} caratteri]` : text;
}

function clipArgs(args) {
  const json = JSON.stringify(args ?? {});
  return json.length > MAX_ARGS ? { _troncato: clip(json, MAX_ARGS) } : args ?? {};
}

/**
 * What an agent saw, thought and did in one turn: the prompt, its reasoning
 * (when the model exposes it), every tool call with its result, the answer.
 * Saved in SQLite for the panel and streamed live while the turn runs.
 */
export class Traces {
  constructor({ store, emit = () => {} }) {
    this.store = store;
    this.emit = emit;
    this.live = new Map();
  }

  start({ agentId, kind, channelId = null, model = "", system = "", prompt = "" }) {
    const trace = new Trace(this, { agentId, kind, channelId, model, system: clip(system, 120000), prompt: clip(prompt, 120000) });
    this.live.set(trace.id, trace);
    this.store.saveTrace(trace);
    this.emit({ type: "trace", event: "start", trace: trace.summary() });
    return trace;
  }

  /** A trace by id, including one that is still running. */
  get(id) {
    const live = this.live.get(id);
    return live ? live.full() : this.store.trace(id);
  }
}

class Trace {
  constructor(owner, fields) {
    this.owner = owner;
    this.id = `tr_${randomBytes(8).toString("hex")}`;
    this.startedAt = new Date().toISOString();
    this.endedAt = null;
    this.status = "running";
    this.steps = [];
    this.output = "";
    this.error = "";
    this.dropped = 0;
    // What the turn cost, added up over every model call it made.
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.savedAt = Date.now();
    Object.assign(this, fields);
  }

  /** Count what a model call used. Harnesses that report nothing leave this at zero. */
  spent(usage) {
    this.tokensIn += Number(usage?.in) || 0;
    this.tokensOut += Number(usage?.out) || 0;
  }

  add(step) {
    if (this.status !== "running") return;
    const entry = { at: Date.now(), ...step };
    if (entry.text !== undefined) entry.text = clip(entry.text);
    if (entry.result !== undefined) entry.result = clip(entry.result);
    if (entry.args !== undefined) entry.args = clipArgs(entry.args);
    this.steps.push(entry);
    if (this.steps.length > MAX_STEPS) {
      this.steps.shift();
      this.dropped += 1;
    }
    this.owner.emit({ type: "trace", event: "step", traceId: this.id, agentId: this.agentId, channelId: this.channelId, step: entry });
    // Saved along the way, so a restart in the middle of a long task knows where it was.
    if (Date.now() - this.savedAt > SAVE_EVERY_MS) {
      this.savedAt = Date.now();
      try { this.owner.store.saveTrace(this); } catch {}
    }
  }

  finish({ status, output = "", error = "" }) {
    if (this.status !== "running") return;
    this.status = status;
    this.output = clip(output);
    this.error = clip(error, 2000);
    this.endedAt = new Date().toISOString();
    this.owner.live.delete(this.id);
    this.owner.store.saveTrace(this);
    this.owner.emit({ type: "trace", event: "end", trace: this.summary() });
  }

  summary() {
    return {
      id: this.id, agentId: this.agentId, kind: this.kind, channelId: this.channelId, model: this.model,
      startedAt: this.startedAt, endedAt: this.endedAt, status: this.status, stepCount: this.steps.length + this.dropped,
      tokensIn: this.tokensIn, tokensOut: this.tokensOut,
      tools: [...new Set(this.steps.filter((step) => step.type === "tool").map((step) => step.name))],
      output: this.output.slice(0, 240), error: this.error,
    };
  }

  full() {
    return { ...this.summary(), output: this.output, system: this.system, prompt: this.prompt, steps: this.steps };
  }
}

/** Stand-in when nothing records traces. */
export const NO_TRACE = { id: null, add() {}, finish() {}, spent() {} };
