const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "weekday", min: 0, max: 7 },
];

const ALIASES = {
  "@hourly": "0 * * * *",
  "@daily": "0 9 * * *",
  "@weekly": "0 9 * * 1",
};

function parseField(text, { name, min, max }) {
  const values = new Set();
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid step in ${name}: ${part}`);
    let start;
    let end;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      [start, end] = range.split("-").map(Number);
    } else {
      start = Number(range);
      end = stepText === undefined ? start : max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`invalid ${name}: ${part}`);
    }
    for (let value = start; value <= end; value += step) values.add(name === "weekday" && value === 7 ? 0 : value);
  }
  return values;
}

export function parseCron(expression) {
  const text = ALIASES[String(expression).trim()] || String(expression).trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new Error("a schedule needs 5 fields: minute hour day month weekday");
  const sets = parts.map((part, index) => parseField(part, FIELDS[index]));
  return { minute: sets[0], hour: sets[1], day: sets[2], month: sets[3], weekday: sets[4], dayAny: parts[2] === "*", weekdayAny: parts[4] === "*" };
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map();

export function zonedParts(date, timezone) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    year: Number(parts.year),
    weekday: WEEKDAYS[parts.weekday],
  };
}

export function cronMatches(cron, parts) {
  if (!cron.minute.has(parts.minute) || !cron.hour.has(parts.hour) || !cron.month.has(parts.month)) return false;
  const dayOk = cron.day.has(parts.day);
  const weekdayOk = cron.weekday.has(parts.weekday);
  if (cron.dayAny && cron.weekdayAny) return true;
  if (cron.dayAny) return weekdayOk;
  if (cron.weekdayAny) return dayOk;
  return dayOk || weekdayOk;
}

export function nextRuns(expression, timezone, count = 3, from = new Date()) {
  const cron = parseCron(expression);
  const out = [];
  const cursor = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let index = 0; index < 60 * 24 * 32 && out.length < count; index += 1) {
    if (cronMatches(cron, zonedParts(cursor, timezone))) out.push(new Date(cursor));
    cursor.setTime(cursor.getTime() + 60000);
  }
  return out;
}

export class Scheduler {
  constructor({ store, orchestrator, brain, timezone, tickMs, log }) {
    this.store = store;
    this.brain = brain;
    this.orchestrator = orchestrator;
    this.timezone = timezone;
    this.tickMs = tickMs;
    this.log = log;
    this.fired = new Map();
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
  }

  tick(now = new Date()) {
    const parts = zonedParts(now, this.timezone);
    const key = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    if (this.brain && parts.hour === this.store.settings.sleepHour && parts.minute === 0) {
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      for (const agent of this.store.agents()) {
        if (!agent.enabled || this.fired.get(`sleep:${agent.id}`) === day) continue;
        this.fired.set(`sleep:${agent.id}`, day);
        this.brain.sleep(agent).catch((error) => this.log({ type: "error", agentId: agent.id, text: `sonno: ${error.message}` }));
      }
    }
    const pending = this.store.pendingRoutineRuns();
    for (const routine of this.store.routines()) {
      if (!routine.enabled) continue;
      const agent = this.store.agent(routine.agentId);
      if (!agent?.enabled) continue;
      const interrupted = pending.find((run) => run.routineId === routine.id && run.status === "interrupted");
      if (interrupted) {
        const trace = interrupted.traceId && this.store.trace(interrupted.traceId);
        if (trace && routine.updatedAt === interrupted.routineUpdatedAt && !this.orchestrator.atWork.has(agent.id) && !this.orchestrator.threadWork.has(routine.channelId)) {
          this.orchestrator.runRoutine(routine, { resumeTrace: trace, resumeRunId: interrupted.id }).catch((error) => this.log({ type: "error", text: `ripresa ${routine.name}: ${error.message}` }));
        }
        continue;
      }
      if (routine.kind === "reminder") {
        if (Date.parse(routine.runAt) > now.getTime() || (routine.lastRunAt && routine.lastStatus !== "skipped") || this.fired.get(routine.id) === key) continue;
        this.fired.set(routine.id, key);
        this.orchestrator.runRoutine(routine).catch((error) => this.log({ type: "error", text: `reminder ${routine.name}: ${error.message}` }));
        continue;
      }
      let cron;
      try { cron = parseCron(routine.schedule); } catch { continue; }
      if (!cronMatches(cron, parts) || this.fired.get(routine.id) === key) continue;
      this.fired.set(routine.id, key);
      this.orchestrator.runRoutine(routine).catch((error) => this.log({ type: "error", text: `routine ${routine.name}: ${error.message}` }));
    }
  }
}
