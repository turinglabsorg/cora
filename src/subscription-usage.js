import { createHash } from "node:crypto";

const INTERVAL = 60 * 1000;
const number = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const fields = (value) => Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key.toLowerCase(), item]));

function timestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value)) ? number(value) : null;
  const ms = numeric === null ? Date.parse(value) : numeric > 1e12 ? numeric : numeric * 1000;
  return Number.isFinite(ms) && ms > 0 && ms < 8640000000000000 ? new Date(ms).toISOString() : null;
}

function window(id, kind, used, reset, group = "", minutes = null) {
  const percent = number(used);
  if (percent === null) return null;
  return { id: String(id).slice(0, 160), kind: ["session", "weekly", "monthly", "custom"].includes(kind) ? kind : "custom", group: String(group || "").replace(/[\r\n]/g, " ").slice(0, 100),
    usedPercent: Math.min(100, Math.max(0, percent)), resetsAt: timestamp(reset), minutes: number(minutes) };
}

const kindFor = (minutes, fallback) => minutes === 300 ? "session" : minutes === 10080 ? "weekly" : minutes >= 42000 && minutes <= 44640 ? "monthly" : minutes > 0 ? "custom" : fallback;

export function parseSubscriptionUsage(provider, data) {
  const root = object(data);
  if (root.normalized === true) return (Array.isArray(root.windows) ? root.windows : []).map((item) =>
    window(item.id, item.kind, item.usedPercent, item.resetsAt, item.group, item.minutes)).filter(Boolean);
  const windows = [];
  const add = (...args) => { const item = window(...args); if (item && !windows.some((old) => old.id === item.id)) windows.push(item); };
  if (provider === "claude") {
    for (const [key, kind] of [["five_hour", "session"], ["seven_day", "weekly"]]) {
      const item = object(root[key]); add(key, kind, item.utilization ?? item.used_percentage, item.resets_at);
    }
    const models = new Set();
    const model = (name, item) => {
      if (!name || models.has(String(name).toLowerCase())) return;
      const used = number(item.percent ?? item.utilization ?? item.used_percentage);
      if (used === null) return;
      models.add(String(name).toLowerCase());
      add(`weekly:${String(name).toLowerCase()}`, "weekly", used, item.resets_at, name);
    };
    for (const item of Array.isArray(root.limits) ? root.limits : []) if (item?.kind === "weekly_scoped") model(item.scope?.model?.display_name, item);
    for (const key of ["fable_weekly", "fable_seven_day"]) model("Fable", object(root[key]));
    for (const [key, item] of Object.entries(root)) if (/^seven_day_\w+$/.test(key)) {
      const name = key.slice(10).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); model(name, object(item));
    }
  } else if (provider === "codex") {
    const buckets = Object.keys(object(root.rateLimitsByLimitId)).length ? Object.entries(root.rateLimitsByLimitId) : [["codex", root.rateLimits]];
    for (const [key, raw] of buckets) {
      const bucket = object(raw), group = key === "codex" ? "" : bucket.limitName || key;
      for (const [slot, fallback] of [["primary", "session"], ["secondary", "weekly"]]) {
        const item = object(bucket[slot]), minutes = number(item.windowDurationMins);
        add(`${key}:${slot}`, kindFor(minutes, fallback), item.usedPercent, item.resetsAt, group, minutes);
      }
    }
  } else if (provider === "gemini") {
    for (const group of Array.isArray(root.command?.data?.groups) ? root.command.data.groups : []) {
      if (!group || typeof group.name !== "string") continue;
      for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
        const left = number(bucket?.remaining_fraction);
        if (left === null || left < 0 || left > 1 || !["weekly", "5h"].includes(bucket.window)) continue;
        add(`${group.name}:${bucket.id || bucket.window}`, bucket.window === "5h" ? "session" : "weekly", (1 - left) * 100, bucket.reset_time, group.name === "Gemini Models" ? "" : group.name);
      }
    }
  } else if (provider === "muse") {
    const usage = object(root.subs_usage || root.usage || root.allowance || root);
    for (const [key, fallback] of [["window", "session"], ["session", "session"], ["weekly", "weekly"]]) {
      const item = object(usage[key]), minutes = number(item.window_duration_mins);
      const kind = kindFor(minutes, fallback);
      add(kind, kind, item.used_percent ?? item.usedPercent ?? item.used_percentage ?? item.utilization, item.resets_at ?? item.resetsAtMs ?? item.resetsAt, "", minutes);
    }
  } else if (provider === "ollama") {
    const included = fields(fields(root).included);
    for (const [key, kind] of [["session", "session"], ["weekly", "weekly"]]) {
      const item = fields(included[key]), left = number(item.remaining_percent);
      if (left !== null && left >= 0 && left <= 100) add(key, kind, 100 - left, item.resets_at);
    }
    const allowance = number(included.allowance_usd), balance = number(included.balance_usd);
    if (allowance > 0 && balance !== null) add("monthly", "monthly", (allowance - balance) * 100 / allowance, fields(included.period).until);
  } else if (provider === "grok") {
    const config = object(root.config || root), period = object(config.currentPeriod);
    const money = (name) => number(object(config[name]).val);
    const monthly = money("monthlyLimit"), used = money("used");
    let percent = number(config.creditUsagePercent);
    if (percent === null && !(monthly > 0 && used !== null)) {
      const unreported = money("onDemandCap") === 0 ? ["onDemandUsed", "used"].some((key) => money(key) > 0)
        : ["onDemandCap", "onDemandUsed", "prepaidBalance", "monthlyLimit", "used"].some((key) => money(key) === 0);
      if (!unreported && period.type === "USAGE_PERIOD_TYPE_WEEKLY" && timestamp(period.start) && timestamp(period.end)
        && timestamp(period.start) === timestamp(config.billingPeriodStart) && timestamp(period.end) === timestamp(config.billingPeriodEnd)) percent = 0;
    }
    const kind = period.type === "USAGE_PERIOD_TYPE_MONTHLY" ? "monthly" : "weekly";
    if (percent !== null) add(kind, kind, percent, period.end || config.billingPeriodEnd);
    else if (monthly > 0 && used !== null) add("monthly", "monthly", used / monthly * 100, period.end || config.billingPeriodEnd);
  }
  return windows;
}

export function parseSubscriptionBalances(provider, data) {
  const root = object(data), balances = [];
  const add = (kind, currency, value) => {
    const amount = String(value ?? "").trim();
    if (!["USD", "CNY"].includes(currency) || !/^-?\d+(?:\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount))) return;
    balances.push({ kind, currency, amount });
  };
  if (provider === "deepseek") for (const item of Array.isArray(root.balance_infos) ? root.balance_infos : []) {
    for (const [kind, key] of [["total", "total_balance"], ["granted", "granted_balance"], ["topped-up", "topped_up_balance"]]) add(kind, item?.currency, item?.[key]);
  }
  if (provider === "ollama") {
    const included = fields(fields(root).included), purchased = fields(fields(root).purchased);
    add("included", "USD", included.balance_usd); add("allowance", "USD", included.allowance_usd); add("purchased", "USD", purchased.balance_usd);
  }
  return balances;
}

export class SubscriptionUsage {
  constructor({ store, subscriptions, now = Date.now, read = null, emit = () => {}, providerRecords = () => [] }) {
    this.store = store; this.subscriptions = subscriptions; this.now = now;
    this.read = read || ((record, signal) => subscriptions.usageData(record.id, signal));
    this.emit = emit;
    this.providerRecords = providerRecords;
    this.pending = new Map(); this.revisions = new Map(); this.queue = []; this.workers = 0; this.closed = false;
  }

  key(id) { return `subscriptionUsage:${id}`; }
  identity(record) {
    const identity = [record.provider, record.connectedBy?.id, record.email];
    if (record.usageIdentity) identity.push(record.usageIdentity);
    return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  }
  record(id) { return this.store.subscription(id) || this.providerRecords().find((record) => record.id === id); }
  require(id) { return this.record(id) || this.subscriptions.require(id); }
  connections() { return this.providerRecords().map(({ id, provider, label, server, status }) => ({ id, provider, label, server, status, usage: this.get(id) })); }

  view(record, cache = {}) {
    const valid = cache.identity === this.identity(record);
    return { subscriptionId: record.id, state: valid ? cache.state || "unavailable" : "unavailable", windows: valid ? cache.windows || [] : [], balances: valid ? cache.balances || [] : [],
      fetchedAt: valid ? cache.fetchedAt || null : null, checkedAt: valid ? cache.checkedAt || null : null,
      nextCheckAt: cache.nextCheckAt || null, issue: valid ? cache.issue || null : null,
      stale: Boolean(valid && (cache.windows?.length || cache.balances?.length) && (cache.state !== "ready" || cache.windows?.some((item) => item.resetsAt && Date.parse(item.resetsAt) <= this.now()))) };
  }

  get(id) {
    const record = this.require(id);
    const cached = this.store.value(this.key(id), {}) || {};
    if (record.status !== "ready" || (record.resident && !this.store.settings.useResidentSubscriptions)) return { ...this.view(record), issue: "AUTH_REQUIRED" };
    const snapshot = this.view(record, cached);
    if (this.pending.has(id) && !snapshot.windows.length && !snapshot.balances.length) return { ...snapshot, state: "loading" };
    return snapshot;
  }

  start(interval = INTERVAL) {
    if (this.timer || this.closed) return;
    void this.refreshAll();
    this.timer = setInterval(() => { void this.refreshAll(); }, interval);
    this.timer.unref();
  }

  async refreshAll() {
    if (this.closed) return;
    const records = [...this.store.subscriptions(), ...this.providerRecords()].filter((record) => record.status === "ready" && (!record.resident || this.store.settings.useResidentSubscriptions));
    await Promise.allSettled(records.map((record) => this.refresh(record.id)));
    if (!this.closed && records.length) this.emit();
  }

  async refresh(id) {
    const record = this.require(id);
    if (record.status !== "ready" || (record.resident && !this.store.settings.useResidentSubscriptions)) return this.view(record);
    const cached = this.store.value(this.key(id), {}) || {};
    if (this.closed || this.subscriptions.logins.has(id) || this.subscriptions.busy.has(id)) return { ...this.view(record, cached), issue: "connecting", stale: true };
    if (Date.parse(cached.nextCheckAt) > this.now()) return this.view(record, cached);
    if (this.pending.has(id)) return this.pending.get(id).promise;
    const controller = new AbortController(), revision = this.revisions.get(id) || 0;
    const promise = this.slot(controller.signal).then(async (release) => {
      try {
        let next;
        const at = () => new Date(this.now()).toISOString();
        try {
          const data = await this.read(record, controller.signal);
          controller.signal.throwIfAborted();
          const windows = parseSubscriptionUsage(record.provider, data), balances = parseSubscriptionBalances(record.provider, data), available = windows.length || balances.length;
          next = { identity: this.identity(record), windows, balances, fetchedAt: available ? at() : cached.identity === this.identity(record) ? cached.fetchedAt || null : null,
            checkedAt: at(), nextCheckAt: new Date(this.now() + INTERVAL).toISOString(), state: available ? "ready" : "unavailable", issue: available ? null : "no-data", failures: 0 };
          if (!available && cached.identity === next.identity) { next.windows = cached.windows || []; next.balances = cached.balances || []; }
        } catch (error) {
          if (controller.signal.aborted || this.closed) return this.view(record);
          const rateLimited = error.code === "RATE_LIMITED";
          const failures = rateLimited ? (cached.failures || 0) + 1 : 0;
          const delay = rateLimited ? Math.max(record.provider === "claude" ? Math.min(30 * 60000 * 2 ** Math.min(failures - 1, 5), 12 * 3600000) : 5 * INTERVAL, Number(error.retryAfterMs) || 0) : error.code === "AUTH_REQUIRED" ? 5 * INTERVAL : INTERVAL;
          next = { ...cached, identity: this.identity(record), windows: cached.identity === this.identity(record) ? cached.windows || [] : [],
            balances: cached.identity === this.identity(record) ? cached.balances || [] : [],
            fetchedAt: cached.identity === this.identity(record) ? cached.fetchedAt || null : null, checkedAt: at(), nextCheckAt: new Date(this.now() + delay).toISOString(),
            state: rateLimited ? "cooldown" : "error", issue: ["AUTH_REQUIRED", "RATE_LIMITED", "UNSUPPORTED"].includes(error.code) ? error.code : "unavailable", failures };
        }
        if (!this.closed && (this.revisions.get(id) || 0) === revision && this.record(id)?.status === "ready" && this.identity(this.record(id)) === this.identity(record)) this.store.setValue(this.key(id), next);
        else return this.view(record);
        return this.view(record, next);
      } finally { release(); }
    }).catch(() => this.view(record, cached)).finally(() => { if (this.pending.get(id)?.controller === controller) this.pending.delete(id); });
    this.pending.set(id, { promise, controller });
    return promise;
  }

  slot(signal) {
    return new Promise((resolve, reject) => {
      const start = () => {
        if (this.closed || signal.aborted) { reject(new Error("usage cancelled")); this.drain(); return; }
        this.workers++;
        resolve(() => { this.workers--; this.drain(); });
      };
      if (this.workers < 3) start(); else this.queue.push(start);
    });
  }

  drain() { while (this.workers < 3 && this.queue.length) this.queue.shift()(); }

  invalidate(id, { remove = false } = {}) {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    this.pending.get(id)?.controller.abort();
    this.pending.delete(id);
    const previous = this.store.value(this.key(id), {}) || {};
    this.store.setValue(this.key(id), remove ? null : { ...previous, windows: [], balances: [], fetchedAt: null, identity: "", ...(previous.state === "cooldown" ? {} : { nextCheckAt: null }) });
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const entry of this.pending.values()) entry.controller.abort();
    this.drain();
    await Promise.allSettled([...this.pending.values()].map((entry) => entry.promise));
  }
}
