function modelLabel(model) {
  const claude = String(model || "").match(/claude-(opus|sonnet)-(\d+(?:\.\d+)?)(?:-(\d+))?/i);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1).toLowerCase()} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  const gpt = String(model || "").match(/gpt-oss-(\d+b)/i);
  if (gpt) return `GPT-OSS ${gpt[1].toUpperCase()}`;
  const match = String(model || "").match(/gemini-(\d+(?:\.\d+)?)-(argon|flash|pro)/i);
  return match ? `Gemini ${match[1]} ${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()}` : "Gemini";
}

export function geminiQuotaMessage({ model, usage, language = "it", timezone = "UTC" }) {
  const english = language === "en";
  const label = modelLabel(model);
  const groups = (Array.isArray(usage?.command?.data?.groups) ? usage.command.data.groups : []).filter((group) => group && typeof group === "object").map((group) => ({
    name: String(group.name || ""),
    buckets: (Array.isArray(group.buckets) ? group.buckets : []).filter((bucket) =>
      bucket && ["weekly", "5h"].includes(bucket.window) && typeof bucket.remaining_fraction === "number"
      && Number.isFinite(bucket.remaining_fraction) && bucket.remaining_fraction >= 0 && bucket.remaining_fraction <= 1),
  }));
  const gemini = groups.find((group) => /^gemini models$/i.test(group.name));
  const argon = groups.find((group) => /^gemini 4 argon$/i.test(group.name));
  const thirdParty = groups.find((group) => /^claude and gpt models$/i.test(group.name));
  const thirdPartyModel = /^(?:gemini\/)?(?:claude|gpt)-/i.test(String(model || ""));
  const target = thirdPartyModel ? thirdParty : /argon/i.test(label) && argon ? argon : gemini;
  const exhausted = target?.buckets.find((bucket) => bucket.window === "weekly" && bucket.remaining_fraction === 0)
    || target?.buckets.find((bucket) => bucket.remaining_fraction === 0);
  const window = exhausted?.window === "weekly" ? (english ? "weekly " : "settimanale ")
    : exhausted?.window === "5h" ? (english ? "five-hour " : "di cinque ore ") : "";
  const parts = [english ? `${label} has reached its ${window}usage limit.` : `${label} ha raggiunto il limite ${window}di utilizzo.`];
  if (target === gemini && gemini) parts.push(english ? "This limit applies to the shared Gemini model group." : "Questo limite riguarda la quota condivisa del gruppo Gemini.");
  if (target === thirdParty && thirdParty) parts.push(english ? "This limit applies to the shared Claude and GPT model group in Antigravity." : "Questo limite riguarda la quota condivisa di Claude e GPT in Antigravity.");
  if (exhausted?.reset_time && Number.isFinite(Date.parse(exhausted.reset_time))) {
    let reset;
    try { reset = new Intl.DateTimeFormat(english ? "en-GB" : "it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(exhausted.reset_time)); }
    catch { timezone = "UTC"; reset = new Date(exhausted.reset_time).toISOString().slice(0, 16).replace("T", " "); }
    parts.push(english ? `Resets: ${reset} (${timezone}).` : `Ripristino: ${reset} (${timezone}).`);
  }
  const other = thirdPartyModel || target === argon ? gemini : target === gemini ? argon : null;
  if (other?.buckets.length) {
    const title = other === gemini ? (thirdPartyModel ? (english ? "Gemini models" : "I modelli Gemini") : (english ? "Other Gemini models" : "Gli altri modelli Gemini")) : "Gemini 4 Argon";
    const remaining = other.buckets.map((bucket) => `${Math.round(bucket.remaining_fraction * 100)}% ${bucket.window === "weekly" ? (english ? "weekly" : "settimanale") : (english ? "five-hour" : "su cinque ore")}`).join(", ");
    parts.push(english ? `${title}: ${remaining} remaining.` : `${title}: quota residua ${remaining}.`);
  } else if (target !== gemini || !gemini) {
    parts.push(english ? "The remaining quota of other Gemini models could not be verified." : "Non ho potuto verificare la quota residua degli altri modelli Gemini.");
  }
  if (!exhausted && target?.buckets.length) parts.push(english
    ? "The provider rejected the request even though its quota counters still show capacity."
    : "Google ha rifiutato la richiesta anche se i suoi contatori mostrano ancora disponibilità.");
  return parts.join(" ");
}
