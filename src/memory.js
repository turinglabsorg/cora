import { SHARED } from "./store.js";

const STOPWORDS = new Set((
  "il lo la i gli le un uno una di a da in con su per tra fra e ed o ma se che chi cui non piu più come dove quando " +
  "del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle " +
  "sul sullo sulla sui sugli sulle è e' sono sei siamo siete era ho hai ha abbiamo avete hanno mi ti si ci vi ne lo " +
  "questo questa questi queste quello quella quelli quelle mio mia tuo tua suo sua anche gia già poi ora molto tutto tutti " +
  "the a an of to in on for with and or but if is are was were be been it this that these those i you he she we they " +
  "my your his her our their me him us them at by from as not no do does did have has had so just"
).split(/\s+/));

export function tokenize(text) {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Okapi BM25 over small in-memory corpora. Returns [{doc, score}] sorted, score > 0 only. */
export function bm25(docs, query, textOf, { k1 = 1.4, b = 0.75, limit = 10 } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !docs.length) return [];
  const tokenized = docs.map((doc) => tokenize(textOf(doc)));
  const avg = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length || 1;
  const df = new Map();
  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) if (terms.includes(term)) df.set(term, (df.get(term) || 0) + 1);
  }
  const results = [];
  tokenized.forEach((tokens, index) => {
    if (!tokens.length) return;
    const tf = new Map();
    for (const token of tokens) if (df.has(token)) tf.set(token, (tf.get(token) || 0) + 1);
    let score = 0;
    for (const [term, freq] of tf) {
      const idf = Math.log(1 + (docs.length - df.get(term) + 0.5) / (df.get(term) + 0.5));
      score += idf * ((freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * tokens.length) / avg)));
    }
    if (score > 0) results.push({ doc: docs[index], score });
  });
  return results.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

export class Memory {
  constructor({ store }) {
    this.store = store;
  }

  facts(agentId) {
    return [
      ...this.store.memories(agentId).map((memory) => ({ ...memory, scope: "private" })),
      ...this.store.memories(SHARED).map((memory) => ({ ...memory, scope: "shared" })),
    ];
  }

  searchFacts(agentId, query, limit = 10) {
    return this.store.searchMemories([agentId, SHARED], query, limit)
      .map((memory) => ({ ...memory, scope: memory.owner === SHARED ? "shared" : "private" }));
  }

  /** Pinned facts, then the ones relevant to the conversation, then the newest. */
  relevant(agentId, query, { relevantLimit = 14, recentLimit = 6, max = 36 } = {}) {
    const facts = this.facts(agentId);
    const picked = new Map();
    for (const fact of facts.filter((item) => item.pinned)) picked.set(fact.id, fact);
    for (const fact of this.searchFacts(agentId, query, relevantLimit + picked.size)) {
      if (!picked.has(fact.id) && picked.size < max) picked.set(fact.id, fact);
    }
    const recent = facts.filter((item) => !item.pinned).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, recentLimit);
    for (const fact of recent) if (picked.size < max) picked.set(fact.id, fact);
    return [...picked.values()];
  }

  searchArchive(channelIds, query, { limit = 10, before } = {}) {
    return this.store.searchMessages(channelIds, query, limit, before);
  }

  archiveSince(channelIds, since, limit = 400) {
    return this.store.messagesSince(channelIds, since, limit);
  }
}

export function parseJsonObject(text) {
  const value = String(text || "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the answer");
  return JSON.parse(value.slice(start, end + 1));
}
