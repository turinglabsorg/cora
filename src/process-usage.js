import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { cpus, totalmem } from "node:os";

const TICKS_PER_SECOND = 100;
const PAGE_BYTES = 4096;
const FIRST_WINDOW_MS = 300;
const FRESH_MS = 30000;

/** Every process on a Linux machine: parent, CPU ticks used so far and resident memory. */
export function linuxTable(root = "/proc") {
  const table = new Map();
  for (const name of readdirSync(root)) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const text = readFileSync(`${root}/${name}/stat`, "utf8");
      const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
      table.set(Number(name), {
        ppid: Number(fields[1]),
        ticks: Number(fields[11]) + Number(fields[12]),
        rss: Number(fields[21]) * PAGE_BYTES,
      });
    } catch { /* gone while reading */ }
  }
  return table;
}

/** Elsewhere ps gives parent, memory and an already averaged CPU percentage. */
function psTable() {
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid=,rss=,%cpu="], { timeout: 5000, env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => {
      const table = new Map();
      if (!error) for (const line of String(stdout).split("\n")) {
        const [pid, ppid, rss, cpu] = line.trim().split(/\s+/).map(Number);
        if (pid) table.set(pid, { ppid, rss: rss * 1024, cpu });
      }
      resolve(table);
    });
  });
}

/** A process and everything it started, still running. */
export function tree(table, pid) {
  const children = new Map();
  for (const [id, row] of table) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(id);
  }
  const ids = [];
  const queue = table.has(pid) ? [pid] : [];
  while (queue.length) {
    const id = queue.shift();
    ids.push(id);
    queue.push(...(children.get(id) || []));
  }
  return ids;
}

export function treeTotals(table, pid) {
  const ids = tree(table, pid);
  return ids.reduce((sum, id) => {
    const row = table.get(id);
    sum.rss += row.rss || 0;
    sum.ticks += row.ticks || 0;
    sum.cpu += row.cpu || 0;
    return sum;
  }, { processes: ids.length, rss: 0, ticks: 0, cpu: 0 });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Memory and CPU of each live CLI with its children, like top: CPU is the share
 * of one core between this reading and the previous one.
 */
export class ProcessUsage {
  constructor({ linux = process.platform === "linux", read = linuxTable, now = () => Date.now() } = {}) {
    this.linux = linux;
    this.read = read;
    this.now = now;
    this.last = new Map();
  }

  machine() {
    return { cores: cpus().length || 1, memory: totalmem() };
  }

  async sample(pids) {
    const wanted = [...new Set(pids.map(Number).filter(Boolean))];
    const result = new Map();
    if (!wanted.length) return result;
    if (!this.linux) {
      const table = await psTable();
      for (const pid of wanted) {
        const totals = treeTotals(table, pid);
        if (totals.processes) result.set(pid, { rss: totals.rss, cpu: Math.round(totals.cpu * 10) / 10, processes: totals.processes });
      }
      return result;
    }
    let table = this.read();
    let at = this.now();
    if (wanted.some((pid) => !this.last.has(pid) || at - this.last.get(pid).at > FRESH_MS)) {
      for (const pid of wanted) {
        const totals = treeTotals(table, pid);
        if (totals.processes) this.last.set(pid, { at, ticks: totals.ticks });
      }
      await wait(FIRST_WINDOW_MS);
      table = this.read();
      at = this.now();
    }
    for (const pid of wanted) {
      const totals = treeTotals(table, pid);
      if (!totals.processes) {
        this.last.delete(pid);
        continue;
      }
      const before = this.last.get(pid);
      const seconds = before ? (at - before.at) / 1000 : 0;
      if (before?.cpu !== undefined && seconds < 1) {
        result.set(pid, { rss: totals.rss, cpu: before.cpu, processes: totals.processes });
        continue;
      }
      const used = seconds > 0 ? Math.max(0, (totals.ticks - before.ticks) / TICKS_PER_SECOND / seconds * 100) : 0;
      const cpu = Math.round(used * 10) / 10;
      this.last.set(pid, { at, ticks: totals.ticks, cpu });
      result.set(pid, { rss: totals.rss, cpu, processes: totals.processes });
    }
    for (const pid of this.last.keys()) if (!wanted.includes(pid)) this.last.delete(pid);
    return result;
  }
}
