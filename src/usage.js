const DEEPSEEK_PRICING = "https://api-docs.deepseek.com/quick_start/pricing/";
const PRICE_VERSION = "2026-11-09";
const DEEPSEEK_RATES = {
  "deepseek-flash": [0.15, 0.003, 0.60],
  "deepseek-v4-flash": [0.15, 0.003, 0.60],
  "deepseek-v4-flash-vision-exp": [0.15, 0.003, 0.60],
  "deepseek-v4-pro": [0.66, 0.022, 1.98],
};

const count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export const paidApi = (model = "") => /^(deepseek|orcarouter)\//.test(model);
export const emptyMeter = () => ({ modelSteps: null, unknownModelSteps: 0, unpriced: 0, costs: [] });

export function mergeMeter(target, source) {
  if (!source) return target;
  if (source.modelSteps !== null && source.modelSteps !== undefined) target.modelSteps = (target.modelSteps || 0) + source.modelSteps;
  target.unpriced += source.unpriced || 0;
  target.unknownModelSteps += source.unknownModelSteps || 0;
  for (const cost of source.costs || []) {
    const bucket = target.costs.find((item) => ["currency", "estimated", "source", "version"].every((key) => item[key] === cost[key]));
    if (bucket) { bucket.amount += cost.amount; bucket.maxAmount += cost.maxAmount ?? cost.amount; }
    else target.costs.push({ ...cost, maxAmount: cost.maxAmount ?? cost.amount });
  }
  return target;
}

export function aggregateMeters(traces) {
  const meter = emptyMeter();
  for (const trace of traces) {
    mergeMeter(meter, trace.meter || (paidApi(trace.model) ? { unpriced: 1 } : null));
    if (trace.meter?.modelSteps == null) meter.unknownModelSteps += 1;
  }
  return meter;
}

// Peak windows exclude Chinese public holidays. Without a provider tariff flag,
// keep both possible prices in those windows rather than invent a holiday calendar.
function peakPossible(startedAt, endedAt) {
  const start = Number(startedAt), end = Number(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 7 * 86400000) return true;
  for (let day = Math.floor(start / 86400000) * 86400000; day <= end; day += 86400000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const [from, to] of [[1, 4], [6, 10]]) if (start < day + to * 3600000 && end >= day + from * 3600000) return true;
  }
  return false;
}

export function deepSeekUsage(model, usage, { startedAt = Date.now(), endedAt = Date.now() } = {}) {
  const meter = { ...emptyMeter(), modelSteps: 1 };
  const input = count(usage?.inputTokens), output = count(usage?.outputTokens);
  if (input === null || output === null) return { in: 0, out: 0, meter: { ...meter, unpriced: 1 } };
  const read = count(usage.cacheReadTokens), write = count(usage.cacheWriteTokens) || 0;
  const total = count(usage.totalTokens);
  // DSH's inputTokens excludes cache reads AND writes; provider total includes them.
  const aggregateInput = total !== null && total >= input + output + write ? total - output : input + (read || 0) + write;
  const cached = read ?? (total !== null ? aggregateInput - input - write : null);
  const rates = DEEPSEEK_RATES[model];
  if (!rates || cached === null || new Date(endedAt).toISOString().slice(0, 10) < PRICE_VERSION) meter.unpriced = 1;
  else {
    const amount = ((input + write) * rates[0] + cached * rates[1] + output * rates[2]) / 1000000;
    meter.costs.push({ currency: "USD", amount, maxAmount: amount * (peakPossible(startedAt, endedAt) ? 2 : 1), estimated: true, source: DEEPSEEK_PRICING, version: PRICE_VERSION });
  }
  return { in: aggregateInput, out: output, cacheRead: cached, meter };
}

export function routerUsage(usage, source) {
  const meter = { ...emptyMeter(), modelSteps: 1 };
  const amount = count(usage?.cost);
  if (amount === null) meter.unpriced = 1;
  else meter.costs.push({ currency: "USD", amount, maxAmount: amount, estimated: false, source, version: "provider" });
  return { in: count(usage?.prompt_tokens) || 0, out: count(usage?.completion_tokens) || 0, meter };
}
