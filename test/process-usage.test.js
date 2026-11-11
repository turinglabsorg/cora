import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { ProcessUsage, tree, treeTotals } from "../src/process-usage.js";

const table = (rows) => new Map(rows.map(([pid, ppid, ticks, rss]) => [pid, { ppid, ticks, rss }]));

test("a CLI counts with every process it started, not with its siblings", () => {
  const rows = table([[1, 0, 0, 0], [10, 1, 100, 1000], [11, 10, 50, 500], [12, 11, 5, 50], [20, 1, 999, 99999]]);
  assert.deepEqual(tree(rows, 10).sort(), [10, 11, 12]);
  assert.deepEqual(treeTotals(rows, 10), { processes: 3, rss: 1550, ticks: 155, cpu: 0 });
  assert.equal(treeTotals(rows, 99).processes, 0, "a process already gone weighs nothing");
});

test("CPU is the share of one core between two readings, as top shows it", async () => {
  let clock = 0;
  const reads = [
    table([[10, 1, 100, 4096], [11, 10, 0, 4096]]),
    table([[10, 1, 115, 4096], [11, 10, 15, 8192]]),
    table([[10, 1, 215, 4096]]),
  ];
  const usage = new ProcessUsage({ linux: true, read: () => reads.shift(), now: () => { clock += 300; return clock; } });
  const first = (await usage.sample([10])).get(10);
  assert.equal(first.cpu, 100, "30 ticks in 0.3 s are one whole core");
  assert.equal(first.rss, 12288);
  assert.equal(first.processes, 2);
  clock += 700;
  const second = (await usage.sample([10])).get(10);
  assert.equal(second.cpu, 85, "the child that ended takes its ticks away: never below zero, measured over the last second");
  assert.equal(second.processes, 1);
});

test("a reading within a second keeps the last figure instead of a noisy one", async () => {
  let clock = 0;
  const reads = [table([[10, 1, 0, 1]]), table([[10, 1, 30, 1]]), table([[10, 1, 30, 1]])];
  const usage = new ProcessUsage({ linux: true, read: () => reads.shift(), now: () => { clock += 300; return clock; } });
  assert.equal((await usage.sample([10])).get(10).cpu, 100);
  assert.equal((await usage.sample([10])).get(10).cpu, 100);
  assert.equal((await usage.sample([])).size, 0);
});

test("a real child with its own child is measured on this machine", async () => {
  const child = spawn(process.execPath, ["-e", "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' }); const end = Date.now() + 20000; while (Date.now() < end) {}"], { stdio: "ignore" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const usage = new ProcessUsage();
    const measured = (await usage.sample([child.pid])).get(child.pid);
    assert.ok(measured, "the live CLI is found");
    assert.ok(measured.processes >= 2, "its child is counted too");
    assert.ok(measured.rss > 10 * 1024 * 1024, "two node processes hold more than 10 MB");
    if (process.platform === "linux") assert.ok(measured.cpu > 30, `a busy loop uses most of a core (${measured.cpu}%)`);
    else assert.ok(Number.isFinite(measured.cpu), "ps gives a number");
    assert.equal(usage.machine().cores > 0 && usage.machine().memory > 0, true);
  } finally {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* ended */ }
  }
});
