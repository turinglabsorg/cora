/**
 * What a gateway or socket goes through is written to the activity log, per
 * bot: when one falls silent and comes back, the outage can be traced later.
 * Retries of the same outage are not repeated; the return says how many.
 */
export function logTransitions(client, log, { type, agentId, label }) {
  let down = null;
  client.on("status", ({ state, error }) => {
    if (state === "reconnecting") {
      if (down) {
        down.attempts += 1;
        return;
      }
      down = { since: Date.now(), attempts: 1 };
      // Discord and Slack recycle connections on their own: that is routine, not a warning.
      const routine = /asked to reconnect/i.test(error || "");
      log?.({ type: routine ? type : "warning", agentId, text: `${label}: collegamento ${routine ? "rinnovato" : "perso"} (${error || "nessun motivo"}), mi ricollego` });
      return;
    }
    if (state === "ready" && down) {
      const seconds = Math.round((Date.now() - down.since) / 1000);
      log?.({ type, agentId, text: `${label}: di nuovo in ascolto dopo ${seconds} s${down.attempts > 1 ? ` e ${down.attempts} tentativi` : ""}` });
      down = null;
      return;
    }
    if (state === "stopped" || state === "error") down = null;
  });
}
