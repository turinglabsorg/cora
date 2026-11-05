/**
 * The cloud's mail, through ambox (an agent mailbox with an HTTP API): only the
 * sign-in links that open a share. Without a key nothing is sent, and the page a
 * visitor sees says the same either way.
 */
export function createMailer({ url = "https://ambox.dev", key = "", log = () => {} } = {}) {
  return {
    enabled: Boolean(key),
    async send({ to, subject, text, html }) {
      if (!key) {
        log({ type: "mail-skipped", reason: "no-key" });
        return false;
      }
      const response = await fetch(`${String(url).replace(/\/$/, "")}/v1/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: [to], subject, body_text: text, body_html: html }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`ambox answered ${response.status}`);
      return true;
    },
  };
}
