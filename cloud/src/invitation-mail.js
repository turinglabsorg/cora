import { signPass } from "../../src/pass.js";

const esc = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export async function sendSpaceInvitation({ space, nonce, audience, origin, privateKey, mailer, allowSend }) {
  if (!space || !/^[A-Za-z0-9_-]{43}$/.test(String(nonce || ""))) return { status: 403, error: "invitation_refused" };
  if (!mailer.enabled) return { status: 503, error: "mail_unavailable" };
  let invitation;
  try {
    const response = await fetch(`${space.upstream}/api/cloud/invitation`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" },
      body: JSON.stringify({ pass: signPass(privateKey, { aud: `invitation:${audience}`, nonce }) }),
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (!response.ok) return { status: 403, error: "invitation_refused" };
    invitation = await response.json();
  } catch { return { status: 502, error: "invitation_unconfirmed" }; }
  const email = String(invitation.email || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email) || email.length > 254) return { status: 403, error: "invitation_refused" };
  if (!allowSend("email", email) || !allowSend("host", `invitation:${space.slug}`) || !allowSend("day", "all")) return { status: 429, error: "invitation_rate_limited" };
  const link = `${origin}/go/${encodeURIComponent(space.slug)}`;
  const english = invitation.language === "en";
  const title = english ? `Join ${space.slug} on Cora` : `Entra in ${space.slug} su Cora`;
  const who = String(invitation.invitedBy || "").replace(/[\r\n]/g, " ").slice(0, 120);
  const intro = english ? `${who || "The space owner"} invited you to ${space.slug}.` : `${who || "Il proprietario dello spazio"} ti ha invitato in ${space.slug}.`;
  const steps = english
    ? [`Open the space: ${link}`, `Sign in with Google or GitHub using an account with the verified address ${email}.`, "After signing in, Cora opens the space automatically."]
    : [`Apri lo spazio: ${link}`, `Accedi con Google o GitHub usando un account con l'indirizzo verificato ${email}.`, "Dopo l'accesso, Cora apre lo spazio automaticamente."];
  const permissions = english ? "Your access to agents, Brain pages and files follows the permissions set in the space." : "L'accesso ad agenti, pagine del Brain e file segue i permessi impostati nello spazio.";
  const ignored = english ? "If you were not expecting this invitation, you can ignore this email." : "Se non aspettavi questo invito, puoi ignorare questa e-mail.";
  const text = `${intro}\n\n${steps.map((line, i) => `${i + 1}. ${line}`).join("\n")}\n\n${permissions}\n\n${ignored}`;
  const html = `<!doctype html><html><body style="margin:0;background:#050505;color:#f5f5f3;font-family:Manrope,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;table-layout:fixed;margin:auto;background:#0f0f0f;border:1px solid #232323;border-radius:16px"><tr><td style="padding:32px;overflow-wrap:anywhere;word-break:break-word"><p style="margin:0 0 24px;color:#f2a93b;font-size:24px;font-weight:600">Cora</p><h1 style="font-size:26px;line-height:1.3">${esc(title)}</h1><p style="line-height:1.6">${esc(intro)}</p><ol style="padding-left:20px;line-height:1.8">${steps.map((line) => `<li>${esc(line)}</li>`).join("")}</ol><p style="margin:28px 0"><a href="${esc(link)}" style="display:inline-block;background:#f2a93b;color:#1d1b18;text-decoration:none;border-radius:6px;padding:14px 22px;font-weight:600">${english ? "Open the space" : "Apri lo spazio"}</a></p><p style="font-size:14px;line-height:1.6;color:#bcbcb7">${esc(permissions)}</p><p style="margin-top:28px;font-size:12px;line-height:1.6;color:#8f8f8a">${esc(ignored)}</p></td></tr></table></td></tr></table></body></html>`;
  try {
    const sent = await mailer.send({ to: email, subject: title, text, html });
    return sent ? { status: 200, sent: true } : { status: 503, error: "mail_unavailable" };
  } catch { return { status: 502, error: "invitation_unconfirmed" }; }
}
