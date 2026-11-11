/**
 * A thread named after an issue (REF-23, ACD-73, ...) is that issue's place. Its
 * keys are its topic; the other threads of the same server own theirs. Cora reads
 * this map in three places: the prompt (what this thread is about, where the other
 * issues live), the context from other threads (shown as pointers, not as work to
 * continue) and every message an agent sends (work on another thread's issue is
 * stopped and sent there).
 */

const KEY = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9]{1,9})-(\d{1,6})(?![A-Za-z0-9_]|-\d)/g;
// Codes that look like issue keys and never are.
const NOT_ISSUES = new Set(["UTF", "ISO", "SHA", "GPT", "RFC", "CVE", "TLS", "AES", "RSA", "HTTP", "MP", "ES", "ECMA", "COVID", "PDF", "ID", "IPV", "CP", "UTC", "GMT", "WCAG", "EN", "IT", "NO", "TOP", "PR", "TS", "LLAMA", "QWEN"]);

export function issueKeys(text) {
  const keys = [];
  for (const match of String(text || "").matchAll(KEY)) {
    if (NOT_ISSUES.has(match[1])) continue;
    const key = `${match[1]}-${Number(match[2])}`;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function threadLink(thread) {
  return thread.guildId ? `https://discord.com/channels/${thread.guildId}/${thread.id}` : `#${thread.name}`;
}

/**
 * The topic of `here` and the issues other threads of the same server own.
 * `threads`: every known channel ({ id, name, guildId, thread, parentId }).
 */
export function threadTopics(threads, here) {
  const current = here?.thread || here?.parentId ? { id: here.id, name: here.name } : null;
  const topic = current ? issueKeys(here.name) : [];
  const others = new Map();
  if (!here?.guildId) return { topic, others, current };
  const seen = new Set();
  for (const thread of threads) {
    if (!thread?.id || seen.has(thread.id) || thread.id === here.id || thread.guildId !== here.guildId || !(thread.thread || thread.parentId)) continue;
    seen.add(thread.id);
    for (const key of issueKeys(thread.name)) {
      if (topic.includes(key)) continue;
      others.set(key, [...(others.get(key) || []), { id: thread.id, name: thread.name, guildId: thread.guildId }]);
    }
  }
  return { topic, others, current };
}

/**
 * Work on another thread's issue written into a thread with its own topic. Passes:
 * a thread without a topic, a message that names this thread's issue too, an issue
 * the people here asked about by name (`asked`), and a short pointer that links the
 * other thread. Returns the first foreign issue and its threads, or null.
 */
export function threadLeak(text, { topic = [], others = new Map(), asked = [] } = {}) {
  if (!topic.length || !others.size) return null;
  const body = String(text || "");
  const mentioned = issueKeys(body);
  if (mentioned.some((key) => topic.includes(key))) return null;
  const allowed = new Set(asked);
  for (const key of mentioned) {
    const threads = others.get(key);
    if (!threads || allowed.has(key)) continue;
    const pointer = body.length <= 400 && threads.some((thread) => body.includes(`/${thread.id}`) || body.includes(`<#${thread.id}>`));
    if (pointer) continue;
    return { key, threads };
  }
  return null;
}

export function leakMessage(leak, topic) {
  const where = leak.threads.map((thread) => `«${thread.name}» (${threadLink(thread)}, channel_id "${thread.id}")`).join(" o ");
  return `Questo thread è dedicato a ${topic.join(", ")}; ${leak.key} ha il suo thread: ${where}. Il lavoro su ${leak.key} va scritto là con say({text, channel_id: "${leak.threads[0].id}"}); qui al massimo un rimando breve con quel link. Non riportare qui il lavoro di quel thread.`;
}

export function leakPointer(leak) {
  return `Questo riguarda ${leak.key}: ne parlo nel suo thread, ${threadLink(leak.threads[0])}`;
}
