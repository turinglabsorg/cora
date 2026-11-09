/**
 * The cloud's transactional mail: share sign-in links and space invitations. Resend sends them from
 * usecora.space when its key is there; otherwise ambox (an agent mailbox with an
 * HTTP API). Without either nothing is sent, and the page a visitor sees says the
 * same either way.
 */
export function createMailer({ resendKey = "", resendUrl = "https://api.resend.com", from = "Cora <cora@usecora.space>", url = "https://ambox.dev", key = "", log = () => {} } = {}) {
  const post = async (endpoint, token, body) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${new URL(endpoint).host} answered ${response.status}`);
    return true;
  };
  return {
    enabled: Boolean(resendKey || key),
    provider: resendKey ? "resend" : key ? "ambox" : "",
    async send({ to, subject, text, html }) {
      if (resendKey) return post(`${String(resendUrl).replace(/\/$/, "")}/emails`, resendKey, { from, to: [to], subject, text, html });
      if (key) return post(`${String(url).replace(/\/$/, "")}/v1/send`, key, { to: [to], subject, body_text: text, body_html: html });
      log({ type: "mail-skipped", reason: "no-key" });
      return false;
    },
  };
}
