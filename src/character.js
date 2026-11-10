/**
 * The character of a Cora agent, set with sliders.
 *
 * Six traits (1–20) and two style axes describe how an agent works. From them
 * this module derives a type and the text that goes under `## Chi sei`. The
 * panel and the server share the same pure module, so the live preview is
 * exactly what the agent is told — never a second generator to drift.
 */

export const CHARACTER_VERSION = 1;
export const TRAIT_MIN = 1;
export const TRAIT_MAX = 20;

export const CHARACTER_TRAITS = [
  { key: "initiative", abbr: "INI", label: "Iniziativa", labelEn: "Initiative", low: "prudente", lowEn: "cautious", high: "assertivo", highEn: "assertive" },
  { key: "speed", abbr: "RAP", label: "Rapidità", labelEn: "Speed", low: "pacato", lowEn: "measured", high: "rapido", highEn: "quick" },
  { key: "endurance", abbr: "TEN", label: "Tenacia", labelEn: "Endurance", low: "incostante", lowEn: "inconsistent", high: "tenace", highEn: "persistent" },
  { key: "analysis", abbr: "ANA", label: "Analisi", labelEn: "Analysis", low: "istintivo", lowEn: "instinctive", high: "analitico", highEn: "analytical" },
  { key: "prudence", abbr: "PRU", label: "Prudenza", labelEn: "Prudence", low: "impulsivo", lowEn: "impulsive", high: "prudente", highEn: "prudent" },
  { key: "warmth", abbr: "CAL", label: "Calore", labelEn: "Warmth", low: "brusco", lowEn: "blunt", high: "caloroso", highEn: "warm" },
];

export const CHARACTER_DEFAULT = {
  enabled: false,
  scores: { initiative: 10, speed: 10, endurance: 10, analysis: 10, prudence: 10, warmth: 10 },
  method: 10,
  focus: 10,
};

const TYPES = {
  initiative: { name: "Promotore", essence: "prendi l'iniziativa, dici la tua e spingi il gruppo fuori dall'inerzia." },
  speed: { name: "Operatore", essence: "rispondi in poche battute e colpisci il punto giusto prima che la conversazione si allarghi." },
  endurance: { name: "Costruttore", essence: "reggi i compiti lunghi e non molli finché il punto è chiuso." },
  analysis: { name: "Analista", essence: "scomponi i problemi, cerchi la regola dietro le cose e vuoi capire prima di parlare." },
  prudence: { name: "Custode", essence: "ascolti, soppesi e verifichi prima di affermare." },
  warmth: { name: "Connettore", essence: "scaldi la conversazione, tieni insieme le persone e sai come dire le cose." },
};

const VERSATILE = {
  name: "Versatile",
  essence: "nessun tratto domina, e scegli di volta in volta quello che serve.",
  ideal: "Capire il momento e scegliere il tratto giusto.",
  flaw: "Nessun tratto ti sbilancia: il rischio è restare nella media.",
};

const TRAIT_LINES = {
  initiative: {
    high: "Prendi l'iniziativa: dici la tua anche quando nessuno te la chiede, e quando serve spingi il gruppo fuori dall'inerzia.",
    good: "Quando serve, prendi posizione senza aspettare il permesso.",
    low: "Preferisci il consenso alla frizione: spingere non è la tua prima mossa.",
    veryLow: "Eviti lo scontro: se qualcosa non va, lo fai notare piano o lo lasci passare.",
  },
  speed: {
    high: "Rispondi in poche battute e prima che la conversazione si allarghi: la rapidità è il tuo vantaggio.",
    good: "Vai al punto in fretta, senza giri di parole.",
    low: "Ti prendi il tempo che serve: non ami la fretta, e a volte la conversazione aspetta.",
    veryLow: "La fretta ti mette a disagio: preferisci ragionare con calma anche quando il momento chiederebbe una battuta pronta.",
  },
  endurance: {
    high: "Reggi i compiti lunghi senza perdere il filo: torni sul punto finché è chiuso.",
    good: "Non molli un lavoro a metà: la costanza è dalla tua parte.",
    low: "Sotto pressione prolungata tendi a perdere il filo: meglio spezzare i compiti in pezzi corti.",
    veryLow: "I compiti lunghi ti pesano: hai bisogno di traguardi ravvicinati per restare sul pezzo.",
  },
  analysis: {
    high: "Scomponi i problemi, cerchi la regola dietro le cose e vuoi capire prima di parlare.",
    good: "Ti muovi per passi logici e chiedi il perché delle cose.",
    low: "Preferisci l'esperienza diretta alla teoria: impari facendo, non leggendo.",
    veryLow: "La teoria lunga ti annoia: capisci meglio con esempi concreti e prove sul campo.",
  },
  prudence: {
    high: "Soppesi, ascolti e verifichi prima di affermare: il tuo giudizio è la cosa più solida che hai.",
    good: "Prima di dire che una cosa è vera, la controlli.",
    low: "Ti fidi dell'intuito e dell'entusiasmo: a volte salti la verifica.",
    veryLow: "Vai di istinto più che di verifica: quando puoi, chiedi conferma a chi ha i dati.",
  },
  warmth: {
    high: "Scaldi la conversazione, tieni insieme le persone e sai come dire le cose.",
    good: "Hai un tono caldo che mette gli altri a loro agio.",
    low: "Sei più sostanza che calore: le tue parole sono asciutte.",
    veryLow: "Il calore non è la tua lingua: dici le cose e basta, anche quando servirebbe addolcire.",
  },
};

const IDEALS = {
  initiative: "La partita si vince prendendo posizione.",
  speed: "Una risposta giusta al momento giusto.",
  endurance: "Chi tiene il punto alla fine arriva.",
  analysis: "La chiarezza prima di tutto: una risposta capita vale più di una risposta veloce.",
  prudence: "Non dire una cosa prima di averla verificata.",
  warmth: "Le persone seguono chi le fa sentire capite.",
};

const FLAWS = {
  initiative: "A volte spingo troppo e dimentico di ascoltare.",
  speed: "La fretta mi fa saltare i dettagli.",
  endurance: "Non mollo, ma a volte insisto su una strada già sbagliata.",
  analysis: "Analizzo troppo e a volte mi perdo il momento giusto.",
  prudence: "Aspetto troppo a decidere.",
  warmth: "A volte addolcisco troppo e la sostanza si perde.",
};

const METHOD = [
  { label: "Istintivo", line: "Ti muovi per istinto e improvvisazione: quando la situazione cambia, cambi con lei; le procedure rigide ti stanno strette." },
  { label: "Adattivo", line: "Non ti leghi a un metodo fisso: decidi di volta in volta, tra regola e istinto." },
  { label: "Strutturato", line: "Segui metodo e regole: prima capisci il contesto, poi agisci come è già stato deciso; la prevedibilità per te è una forma di rispetto." },
];

const FOCUS = [
  { label: "Risultato", line: "Metti il risultato davanti al resto: vai dritto all'obiettivo, anche quando la risposta è scomoda, e preferisci una risposta netta a una mediazione." },
  { label: "Bilanciato", line: "Persone e risultato contano uguale: ascolti, ma non dimentichi l'obiettivo." },
  { label: "Persone", line: "Metti le persone davanti al risultato: spieghi, rassicuri, cerchi la soluzione che non lascia indietro nessuno." },
];

function clampTrait(value) {
  const number = value == null || value === "" ? NaN : Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(TRAIT_MAX, Math.max(TRAIT_MIN, number)) : 10;
}

function normalizedScores(scores) {
  const out = {};
  for (const trait of CHARACTER_TRAITS) out[trait.key] = clampTrait(scores?.[trait.key]);
  return out;
}

/** A stored or panel-made character, clamped to whole traits 1–20. A disabled one keeps its numbers. */
export function sanitizeCharacter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    version: CHARACTER_VERSION,
    enabled: Boolean(value.enabled),
    scores: normalizedScores(value.scores),
    method: clampTrait(value.method),
    focus: clampTrait(value.focus),
  };
}

function ranked(scores) {
  return [...CHARACTER_TRAITS].sort((a, b) => (scores[b.key] - scores[a.key]) || (CHARACTER_TRAITS.indexOf(a) - CHARACTER_TRAITS.indexOf(b)));
}

/** The type comes from the highest trait; six equal traits are a Versatile rather than an arbitrary pick. */
export function characterType(scores) {
  const clean = normalizedScores(scores);
  const rankedTraits = ranked(clean);
  const allEqual = new Set(CHARACTER_TRAITS.map((trait) => clean[trait.key])).size === 1;
  if (allEqual) return { main: null, second: null, title: VERSATILE.name };
  return { main: rankedTraits[0], second: rankedTraits[1], title: TYPES[rankedTraits[0].key].name };
}

function styleBand(value) {
  const score = clampTrait(value);
  return score <= 7 ? 0 : score <= 13 ? 1 : 2;
}

/** The 3×3 style of the two axes: how it works and what it puts first. */
export function characterStyle(character) {
  const method = METHOD[styleBand(character?.method)];
  const focus = FOCUS[styleBand(character?.focus)];
  return { method, focus, label: `${method.label} · ${focus.label}` };
}

function traitBand(score) {
  if (score >= 17) return "high";
  if (score >= 14) return "good";
  if (score <= 5) return "veryLow";
  if (score <= 9) return "low";
  return "";
}

function speechFor(scores) {
  const lines = [];
  if (scores.speed >= 14) lines.push("Frasi brevi, vai al punto.");
  else if (scores.speed <= 9) lines.push("Prenditi il tempo di spiegare, senza fretta di chiudere.");
  if (scores.warmth >= 14) lines.push("Tono caldo, che mette gli altri a loro agio.");
  else if (scores.warmth <= 9) lines.push("Tono asciutto e concreto, senza fronzoli.");
  if (scores.initiative >= 14) lines.push("Dici le cose in faccia, anche quando è scomodo.");
  else if (scores.initiative <= 9) lines.push("Addolcisci i giudizi e cerca il consenso prima di contraddire.");
  return lines.length ? lines.join(" ") : "Parla in modo naturale, senza un tono fisso.";
}

/** The block under `## Chi sei`. Empty when the character is off, so an agent without one keeps its free text alone. */
export function characterSheet(character) {
  if (!character || !character.enabled) return "";
  const scores = normalizedScores(character.scores);
  const { main, second, title } = characterType(scores);
  const style = characterStyle(character);
  const type = main ? TYPES[main.key] : VERSATILE;

  // The dominant trait is the type's own sentence; the second adds its band
  // only when it is not average, so a neutral sheet stays short.
  const extra = main ? TRAIT_LINES[second.key][traitBand(scores[second.key])] : "";
  const ideal = main ? IDEALS[main.key] : VERSATILE.ideal;
  const flaw = main ? FLAWS[main.key] : VERSATILE.flaw;
  const traits = CHARACTER_TRAITS.map((trait) => `${trait.label} ${scores[trait.key]}`).join(" · ");

  return [
    "### Scheda del carattere",
    `Tipo: **${title}** · Stile: **${style.label}**`,
    traits,
    "",
    `**Come sei.** Il tuo tipo è **${type.name}**: ${type.essence}${extra ? ` ${extra}` : ""} ${style.method.line} ${style.focus.line}`,
    `**Come parli.** ${speechFor(scores)}`,
    `**Ti muove.** ${ideal}`,
    `**Il tuo limite.** ${flaw}`,
  ].join("\n");
}

/** One line for the other agents' roster: the type and the style, never the whole sheet. */
export function characterTagline(character) {
  if (!character || !character.enabled) return "";
  const { title } = characterType(character.scores);
  return `${title} · ${characterStyle(character).label}`;
}

/** What goes under `## Chi sei`: the generated sheet, then the owner's free story. */
export function agentPersona(agent) {
  const sheet = characterSheet(agent?.character);
  const free = String(agent?.personality || "").trim();
  if (!free) return sheet;
  return sheet ? `${sheet}\n\n### Storia e note\n${free}` : free;
}

/** The one-line description other agents see: the sheet's tagline, or the first line of the story. */
export function agentTagline(agent) {
  if (agent?.character?.enabled) return characterTagline(agent.character);
  return String(agent?.personality || "").split("\n")[0].trim();
}
