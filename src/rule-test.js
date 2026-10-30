/**
 * Trying an owner's doc rule before it is saved, on every brain the agents run on:
 * each one writes a text that breaks the rule, Jev must stop it, the brain gets
 * doc's reason the way an agent does and writes it again, and Jev must let that
 * through. A rule that stops nothing, or that a brain cannot satisfy, shows here
 * rather than in a channel.
 */

const HARNESS_NAMES = { claude: "Claude Code", codex: "Codex", grok: "Grok Build", muse: "Muse Code", hermes: "Hermes", ollama: "Ollama", orcarouter: "OrcaRouter" };
const KINDS = {
  reply: { piece: "un messaggio breve e realistico per la chat del team", short: "messaggio" },
  comment: { piece: "un commento breve e realistico per una pull request su GitHub", short: "commento" },
};
const SYSTEM = "Aiuti a provare un controllo automatico sui testi che degli agenti AI scrivono per un team. Rispondi solo con il testo richiesto, senza virgolette, titoli o spiegazioni.";
const CALL_MS = 150000;
const PARALLEL = 4;

/** The brains in use: one entry per model, account and Ollama card, with the agents on it. */
export function brainsInUse(agents, defaultModel = "") {
  const brains = new Map();
  for (const agent of agents) {
    if (agent.enabled === false) continue;
    const model = agent.model || defaultModel;
    if (!model) continue;
    const key = `${model}\u0000${agent.subscriptionId || ""}\u0000${agent.ollamaHost || ""}`;
    if (!brains.has(key)) {
      const [harness, ...rest] = model.split("/");
      brains.set(key, { model, subscriptionId: agent.subscriptionId || "", host: agent.ollamaHost || "", label: `${HARNESS_NAMES[harness] || harness} · ${rest.join("/") || model}`, agents: [] });
    }
    brains.get(key).agents.push(agent.name);
  }
  return [...brains.values()];
}

function clean(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^["“«]|["”»]$/g, "").trim().slice(0, 4000);
}

async function write(llm, brain, prompt, signal) {
  const options = { model: brain.model, effort: "low", signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_MS)]), host: brain.host };
  const out = llm.isAgentic(brain.model)
    ? await llm.runAgent({ ...options, subscriptionId: brain.subscriptionId, system: SYSTEM, prompt, tools: [], execute: async () => { throw new Error("no tools here"); }, timeoutMs: CALL_MS })
    : await llm.chat({ ...options, tools: [], messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] });
  return clean(out.text);
}

async function judged(doc, target, text, rule) {
  const answer = await doc.score(target, text, rule);
  if (!answer || typeof answer.score !== "number") throw new Error(answer?.error ? `Jev: ${answer.error}` : "Jev non ha risposto");
  return answer.score;
}

/** One brain against the rule: the example, Jev on it, the rewrite, Jev on that. */
async function tryBrain({ brain, rule, target, doc, llm, signal }) {
  const result = { label: brain.label, agents: brain.agents, model: brain.model, status: "done" };
  const kind = KINDS[target];
  try {
    const hint = rule.keywords?.length ? `\nUsa almeno una di queste parole: ${rule.keywords.join(", ")}.` : "";
    result.example = await write(llm, brain, `Scrivi ${kind.piece} che fa chiaramente quello che questo controllo cerca:\n«${rule.question}»${hint}\nSolo il testo.`, signal);
    if (!result.example) throw new Error("non ha scritto l'esempio");
    result.exampleScore = await judged(doc, target, result.example, rule);
    result.caught = result.exampleScore >= rule.threshold;
    if (!result.caught) return result;
    const reason = `doc: your last reply ${rule.reason} (${result.exampleScore.toFixed(2)}), which the user's rules forbid. ${rule.fix}`;
    result.rewrite = await write(llm, brain, `Hai scritto questo ${kind.short}:\n«${result.example}»\n\n[Cora] ${reason}\n\nScrivilo di nuovo: stesso scopo, rispettando la regola. Solo il testo.`, signal);
    if (!result.rewrite) throw new Error("non ha riscritto il testo");
    result.rewriteScore = await judged(doc, target, result.rewrite, rule);
    result.fixed = result.rewriteScore < rule.threshold;
  } catch (error) {
    result.status = "error";
    result.error = String(error?.message || error).slice(0, 300);
  }
  return result;
}

/**
 * Every brain in use against the rule, a few at a time; `onResult` hears each one as
 * it ends. The rule reads chat messages when it may, comments otherwise.
 */
export async function testRule({ rule, brains, doc, llm, onResult = () => {}, signal = new AbortController().signal }) {
  const target = rule.on.includes("reply") ? "reply" : "comment";
  const queue = [...brains];
  const results = [];
  const worker = async () => {
    for (let brain = queue.shift(); brain && !signal.aborted; brain = queue.shift()) {
      const result = await tryBrain({ brain, rule, target, doc, llm, signal });
      results.push(result);
      onResult(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  return { target, results };
}
