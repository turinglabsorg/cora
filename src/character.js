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

const VERSATILE = { name: "Versatile" };

// Six equal traits are Versatile at every height. Only the true middle is "average".
const VERSATILE_LEVELS = {
  high: {
    essence: "ogni tratto è al massimo e nessuno passa davanti agli altri.",
    ideal: "Tenere alta ogni qualità e scegliere comunque da dove partire.",
    flaw: "Quando tutto è al massimo, niente ti dice da dove partire.",
  },
  good: {
    essence: "ogni tratto è alto e non ne sacrifichi uno per farne vincere un altro.",
    ideal: "Restare intero: nessuna qualità viene lasciata indietro.",
    flaw: "Senza un tratto guida, la scelta di dove spingere arriva tardi.",
  },
  mid: {
    essence: "nessun tratto domina, e scegli di volta in volta quello che serve.",
    ideal: "Capire il momento e scegliere il tratto giusto.",
    flaw: "Nessun tratto ti sbilancia: il rischio è restare nella media.",
  },
  low: {
    essence: "ogni tratto è tenuto basso e non ne alzi uno sopra gli altri.",
    ideal: "Non forzare un tratto che non ti appartiene.",
    flaw: "Nessun tratto ti sostiene: il rischio è restare fermo.",
  },
  veryLow: {
    essence: "ogni tratto è al minimo e non ne usi uno per compensare gli altri.",
    ideal: "Non fingere un carattere che non c'è.",
    flaw: "Al minimo su tutto, non hai un tratto a cui appoggiarti.",
  },
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

// The badge stays on three labels. The sentence moves inside each label, so a slider
// in the old 8–13 plateau changes the prompt instead of sitting still.
const METHOD_LINES = [
  { max: 3, line: "Ti muovi quasi solo di istinto: le procedure rigide ti stanno strette e, se la situazione cambia, cambi con lei senza guardare la regola." },
  { max: 7, line: "Ti muovi per istinto e improvvisazione: quando la situazione cambia, cambi con lei; le procedure rigide ti stanno strette." },
  { max: 9, line: "Non ti leghi a un metodo fisso: decidi di volta in volta, e nel dubbio vince l'istinto." },
  { max: 11, line: "Non ti leghi a un metodo fisso: decidi di volta in volta, tra regola e istinto." },
  { max: 13, line: "Non ti leghi a un metodo fisso: decidi di volta in volta, e nel dubbio vince la regola." },
  { max: 16, line: "Segui metodo e regole, lasciandoti un margine quando il contesto non coincide con la procedura." },
  { max: 20, line: "Segui metodo e regole: prima capisci il contesto, poi agisci come è già stato deciso; la prevedibilità per te è una forma di rispetto." },
];

const FOCUS_LINES = [
  { max: 3, line: "Il risultato viene prima di tutto: vai dritto all'obiettivo, anche quando la risposta è scomoda, e una mediazione ti sembra una perdita di tempo." },
  { max: 7, line: "Metti il risultato davanti al resto: vai dritto all'obiettivo, anche quando la risposta è scomoda, e preferisci una risposta netta a una mediazione." },
  { max: 9, line: "Persone e risultato contano quasi uguale, con un passo verso il risultato." },
  { max: 11, line: "Persone e risultato contano uguale: ascolti, ma non dimentichi l'obiettivo." },
  { max: 13, line: "Persone e risultato contano quasi uguale, con un passo verso le persone." },
  { max: 16, line: "Metti le persone davanti, senza dimenticare il risultato: spieghi e cerchi una soluzione che non lasci indietro nessuno." },
  { max: 20, line: "Metti le persone davanti al risultato: spieghi, rassicuri, cerchi la soluzione che non lascia indietro nessuno." },
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

function joinIt(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** The type comes from the highest trait. A tie names every trait that shares it, and six equal traits are Versatile. */
export function characterType(scores) {
  const clean = normalizedScores(scores);
  const rankedTraits = ranked(clean);
  const top = clean[rankedTraits[0].key];
  const leaders = rankedTraits.filter((trait) => clean[trait.key] === top);
  if (leaders.length === CHARACTER_TRAITS.length) return { main: null, second: null, leaders, title: VERSATILE.name };
  if (leaders.length > 1) return { main: null, second: null, leaders, title: leaders.map((trait) => TYPES[trait.key].name).join(" · ") };
  return { main: rankedTraits[0], second: rankedTraits[1], leaders, title: TYPES[rankedTraits[0].key].name };
}

function styleBand(value) {
  const score = clampTrait(value);
  return score <= 7 ? 0 : score <= 13 ? 1 : 2;
}

function axisLine(score, bands) {
  const n = clampTrait(score);
  for (const band of bands) if (n <= band.max) return band.line;
  return bands[bands.length - 1].line;
}

/** The 3×3 style of the two axes: how it works and what it puts first. The label is the wide band; the line moves inside it. */
export function characterStyle(character) {
  const methodScore = clampTrait(character?.method);
  const focusScore = clampTrait(character?.focus);
  const method = { label: METHOD[styleBand(methodScore)].label, line: axisLine(methodScore, METHOD_LINES) };
  const focus = { label: FOCUS[styleBand(focusScore)].label, line: axisLine(focusScore, FOCUS_LINES) };
  return { method, focus, label: `${method.label} · ${focus.label}` };
}

function traitBand(score) {
  if (score >= 17) return "high";
  if (score >= 14) return "good";
  if (score <= 5) return "veryLow";
  if (score <= 9) return "low";
  return "";
}

function levelBand(score) {
  const n = clampTrait(score);
  if (n >= 17) return "high";
  if (n >= 14) return "good";
  if (n <= 5) return "veryLow";
  if (n <= 9) return "low";
  return "mid";
}

function tieProfile(leaders, score) {
  if (leaders.length === 2) {
    const [a, b] = leaders;
    const secondFlaw = FLAWS[b.key];
    return {
      essence: `${TYPES[a.key].essence} ${TYPES[b.key].essence}`,
      ideal: `${IDEALS[a.key]} ${IDEALS[b.key]}`,
      flaw: `${FLAWS[a.key].replace(/\.$/, "")}; ${secondFlaw.charAt(0).toLowerCase()}${secondFlaw.slice(1)}`,
    };
  }
  const names = leaders.map((trait) => TYPES[trait.key].name);
  return {
    essence: `${joinIt(names)} sono pari in cima, a ${score}, e restano insieme.`,
    ideal: "Scegliere sul momento tra i tratti messi allo stesso livello.",
    flaw: levelBand(score) === "mid"
      ? "Nessuno di questi tratti ti sbilancia: il rischio è restare nella media."
      : "Il rischio è non scegliere da quale di questi tratti partire.",
  };
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
  const { main, second, title, leaders } = characterType(scores);
  const style = characterStyle(character);
  const methodScore = clampTrait(character.method);
  const focusScore = clampTrait(character.focus);

  let essence;
  let ideal;
  let flaw;
  let extra = "";
  if (!main && leaders.length === CHARACTER_TRAITS.length) {
    const copy = VERSATILE_LEVELS[levelBand(scores[leaders[0].key])];
    essence = copy.essence;
    ideal = copy.ideal;
    flaw = copy.flaw;
  } else if (!main) {
    const copy = tieProfile(leaders, scores[leaders[0].key]);
    essence = copy.essence;
    ideal = copy.ideal;
    flaw = copy.flaw;
  } else {
    essence = TYPES[main.key].essence;
    ideal = IDEALS[main.key];
    flaw = FLAWS[main.key];
    const secondScore = scores[second.key];
    const band = traitBand(secondScore);
    if (band) {
      extra = ranked(scores)
        .filter((trait) => trait.key !== main.key && scores[trait.key] === secondScore)
        .map((trait) => TRAIT_LINES[trait.key][band])
        .filter(Boolean)
        .join(" ");
    }
  }

  const traits = CHARACTER_TRAITS.map((trait) => `${trait.label} ${scores[trait.key]}`).join(" · ");
  return [
    "### Scheda del carattere",
    `Tipo: **${title}** · Stile: **${style.label}** · Metodo ${methodScore} · Focus ${focusScore}`,
    traits,
    "",
    `**Come sei.** Il tuo tipo è **${title}**: ${essence}${extra ? ` ${extra}` : ""} ${style.method.line} ${style.focus.line}`,
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

/** What goes under `## Chi sei`. An enabled sheet commands it; the old free story stays stored and is not appended. */
export function agentPersona(agent) {
  const sheet = characterSheet(agent?.character);
  if (sheet) return sheet;
  return String(agent?.personality || "").trim();
}

/** Identity, listening and voice must not turn the sheet on. Only a new agent, or a save from Carattere, writes it. */
export function shouldWriteCharacter({ isNew = false, section = "" } = {}) {
  return Boolean(isNew) || section === "carattere";
}

/** The one-line description other agents see: the sheet's tagline, or the first line of the story. */
export function agentTagline(agent) {
  if (agent?.character?.enabled) return characterTagline(agent.character);
  return String(agent?.personality || "").split("\n")[0].trim();
}
