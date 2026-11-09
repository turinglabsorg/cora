import { createHash } from "node:crypto";

export function providerUsageRecords(llm) {
  const records = [];
  const add = (provider, label, identity) => records.push({ id: `provider_${provider}`, provider, label, server: true, status: "ready",
    usageIdentity: createHash("sha256").update(identity).digest("hex") });
  if (llm.ollamaKey || llm.cloudAccount?.signedIn) add("ollama", "Ollama Cloud", llm.ollamaKey || `${llm.ollamaUrl}:${llm.cloudAccount.name || ""}`);
  if (llm.deepseek?.key) add("deepseek", "DeepSeek API", llm.deepseek.key);
  return records;
}

export async function providerUsageData(record, { llm, config }, signal) {
  const key = record.provider === "deepseek" ? llm.deepseek.key : llm.ollamaKey;
  const url = record.provider === "deepseek" ? `${config.deepseekApi || "https://api.deepseek.com"}/user/balance`
    : config.ollamaBalanceApi || (key ? "https://ollama.com/api/balance" : `${llm.ollamaUrl}/api/balance`);
  const response = await fetch(url, { headers: { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
  const error = (code, retryAfterMs = 0) => Object.assign(new Error("Provider usage unavailable"), { code, retryAfterMs, httpStatus: response.status });
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const delay = /^\d+(?:\.\d+)?$/.test(retry || "") ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    await response.body?.cancel();
    throw error(response.status === 429 ? "RATE_LIMITED" : [401, 403].includes(response.status) ? "AUTH_REQUIRED" : "UNAVAILABLE", Math.max(0, delay || 0));
  }
  const chunks = []; let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > 128 * 1024) throw error("UNAVAILABLE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
