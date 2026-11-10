import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHARACTER_DEFAULT,
  CHARACTER_TRAITS,
  agentPersona,
  agentTagline,
  characterSheet,
  characterStyle,
  characterType,
  sanitizeCharacter,
} from "../src/character.js";
import { Store } from "../src/store.js";
import { tempHome } from "./helpers.js";

const makeSheet = (scores, extra = {}) => sanitizeCharacter({ enabled: true, scores, ...extra });
const BASE = CHARACTER_DEFAULT.scores;

test("traits are whole numbers from 1 to 20, and a missing one is average", () => {
  const fixed = sanitizeCharacter({ enabled: true, scores: { analysis: 99, initiative: 0, speed: "x" }, method: -3, focus: 500 });
  assert.equal(fixed.version, 1);
  assert.equal(fixed.scores.analysis, 20);
  assert.equal(fixed.scores.initiative, 1);
  assert.equal(fixed.scores.speed, 10);
  assert.equal(fixed.scores.endurance, 10);
  assert.equal(fixed.method, 1);
  assert.equal(fixed.focus, 20);
  assert.equal(sanitizeCharacter(null), null);
  assert.equal(sanitizeCharacter("nope"), null);
  const off = sanitizeCharacter({ enabled: false, scores: { warmth: 17 } });
  assert.equal(off.enabled, false);
  assert.equal(off.scores.warmth, 17, "turning the character off does not throw the traits away");
});

test("the type is the highest trait; six equal traits are Versatile", () => {
  assert.equal(characterType(BASE).title, "Versatile");
  for (const [key, title] of [["initiative", "Promotore"], ["speed", "Operatore"], ["endurance", "Costruttore"], ["analysis", "Analista"], ["prudence", "Custode"], ["warmth", "Connettore"]]) {
    assert.equal(characterType({ ...BASE, [key]: 18 }).title, title);
  }
  const analyst = characterType({ ...BASE, analysis: 18, prudence: 14 });
  assert.equal(analyst.main.key, "analysis");
  assert.equal(analyst.second.key, "prudence");
});

test("the two axes make the work style", () => {
  assert.equal(characterStyle({ method: 20, focus: 20 }).label, "Strutturato · Persone");
  assert.equal(characterStyle({ method: 1, focus: 1 }).label, "Istintivo · Risultato");
  assert.equal(characterStyle({ method: 10, focus: 10 }).label, "Adattivo · Bilanciato");
  assert.equal(characterStyle({ method: 7, focus: 8 }).label, "Istintivo · Bilanciato");
  assert.equal(characterStyle({ method: 14, focus: 13 }).label, "Strutturato · Bilanciato");
});

test("the generated sheet carries type, style, every trait and a limit", () => {
  const ada = characterSheet(makeSheet({ initiative: 8, speed: 12, endurance: 10, analysis: 18, prudence: 14, warmth: 12 }, { method: 18, focus: 16 }));
  assert.match(ada, /^### Scheda del carattere/);
  assert.match(ada, /Tipo: \*\*Analista\*\* · Stile: \*\*Strutturato · Persone\*\*/);
  assert.match(ada, /Iniziativa 8 · Rapidità 12 · Tenacia 10 · Analisi 18 · Prudenza 14 · Calore 12/);
  assert.match(ada, /\*\*Come sei\.\*\* Il tuo tipo è \*\*Analista\*\*/);
  assert.match(ada, /\*\*Come parli\.\*\*/);
  assert.match(ada, /\*\*Ti muove\.\*\* La chiarezza prima di tutto/);
  assert.match(ada, /\*\*Il tuo limite\.\*\* Analizzo troppo/);
  assert.equal(characterSheet({ ...makeSheet(BASE), enabled: false }), "", "a character switched off adds nothing to the prompt");
});

test("the agent's persona is the sheet followed by its free story", () => {
  const character = makeSheet({ analysis: 18, prudence: 14 });
  assert.match(agentPersona({ character, personality: "Ha lavorato con Seb dal 2024." }), /Scheda del carattere[\s\S]*Ha lavorato con Seb dal 2024\.$/);
  assert.equal(agentPersona({ character: null, personality: "Solo storia." }), "Solo storia.");
  assert.equal(agentTagline({ character, personality: "Solo storia." }), "Analista · Adattivo · Bilanciato");
  assert.equal(agentTagline({ personality: "Prima riga.\nSeconda." }), "Prima riga.");
  assert.equal(agentTagline({}), "");
});

test("the store keeps a character through unrelated updates and can switch it off", () => {
  const home = tempHome();
  const store = new Store(home);
  const agent = store.createAgent({ name: "Carattere", character: { enabled: true, scores: { analysis: 18, prudence: 14 }, method: 18, focus: 16 } });
  assert.equal(agent.character.scores.analysis, 18);
  assert.equal(agent.character.scores.initiative, 10);
  assert.equal(agent.character.method, 18);
  const renamed = store.updateAgent(agent.id, { name: "Carattere rinominato" });
  assert.equal(renamed.character.scores.analysis, 18, "an update that does not mention the character keeps it");
  const off = store.updateAgent(agent.id, { character: { enabled: false } });
  assert.equal(off.character.enabled, false);
  assert.equal(off.character.scores.analysis, 18);
  assert.ok(CHARACTER_TRAITS.every((trait) => Number.isInteger(off.character.scores[trait.key])));
  store.close();
});
