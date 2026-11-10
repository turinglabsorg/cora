import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";

/** The CLI child started by the turn running in this async context. */
export const noteChildPid = new AsyncLocalStorage();

const STALE_MS = 45000;

/** A dead harness: the account spend limit, or a broken transport. A model's own quota reply is handled by the brain and must not start a second instance. A stop or an abort is not one of these. */
export function sessionFailure(error) {
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || error || ""}`;
  if (/abort|stopped|fermata|disengag/i.test(text) && !/spend limit|out of extra usage/i.test(text)) return false;
  return /spend limit|out of extra usage|rate limit|overloaded|529|internal server error|api error|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|ENOMEM|out of memory|system error|no answer within|timed out/i.test(text);
}

export function pidAlive(pid) {
  const id = Number(pid);
  if (!id) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop a CLI child and the process group it leads, when it was started detached. */
export function killPid(pid) {
  const id = Number(pid);
  if (!id) return;
  const signal = (sig) => {
    try { process.kill(-id, sig); } catch {
      try { process.kill(id, sig); } catch { /* already gone */ }
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => { if (pidAlive(id)) signal("SIGKILL"); }, 2000);
  timer.unref?.();
}

/**
 * One live session per agent and thread, stored so a restart can see it.
 * The in-memory lock is not enough: it disappears when the process does,
 * and the old CLI can still be running.
 */
export class ThreadSessions {
  constructor(store) {
    this.store = store;
    this.boot = `boot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.host = hostname();
    this.beats = new Map();
  }

  /** Previous process: if its CLI is still alive, kill it, then the row is no longer active. */
  reap() {
    for (const session of this.store.activeThreadSessions()) {
      if (session.boot === this.boot) continue;
      if (pidAlive(session.pid)) killPid(session.pid);
      this.store.closeThreadSession(session.id, { status: "killed", error: "chiusa al riavvio: il processo precedente è stato fermato" });
    }
  }

  blocking(agentId, channelId) {
    const session = this.store.activeThreadSession(agentId, channelId);
    return session && this.alive(session) ? session : null;
  }

  alive(session) {
    if (!session || session.status !== "active") return false;
    if (pidAlive(session.pid)) return true;
    return session.boot === this.boot && Date.now() - Date.parse(session.heartbeatAt) < STALE_MS;
  }

  begin({ agentId, channelId, kind, replaces = "" }) {
    const session = this.store.tx(() => {
      const current = this.store.activeThreadSession(agentId, channelId);
      if (current && this.alive(current)) return null;
      if (current) this.store.closeThreadSession(current.id, { status: "interrupted", error: "segnale di vita assente" });
      return this.store.openThreadSession({ agentId, channelId, kind, boot: this.boot, host: this.host, replaces });
    });
    if (!session) return null;
    const beat = setInterval(() => {
      if (this.store.threadSession(session.id)?.status === "active") this.store.touchThreadSession(session.id);
    }, 10000);
    beat.unref?.();
    this.beats.set(session.id, beat);
    return session;
  }

  notePid(id, pid) {
    this.store.noteThreadSessionPid(id, pid);
  }

  finish(session, { status = "done", error = "" } = {}) {
    if (!session?.id) return;
    const beat = this.beats.get(session.id);
    if (beat) clearInterval(beat);
    this.beats.delete(session.id);
    const row = this.store.threadSession(session.id);
    if (row?.status === "active") this.store.closeThreadSession(session.id, { status, error });
  }

  /** Panel stop: the row is closed before the CLI dies, so the error is not a reason to open another. */
  stop(agentId, channelId) {
    const session = this.store.activeThreadSession(agentId, channelId);
    if (!session) return null;
    const pid = session.pid;
    this.finish(session, { status: "stopped", error: "fermata dal pannello" });
    if (pidAlive(pid)) killPid(pid);
    return session;
  }
}
