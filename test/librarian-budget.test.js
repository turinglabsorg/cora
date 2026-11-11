import assert from "node:assert/strict";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
import { fakeDocker, fakeOllama, tempHome } from "./helpers.js";

const LIBRARIAN = /^Sei il bibliotecario del brain aziendale/;

test("the librarian's prompt stays under its budget: the chats and notes go whole, pages only whole, and a page it did not see whole is not rewritten", async (t) => {
  const prompts = [];
  let answer = () => ({ pages: [] });
  const ollama = await fakeOllama(async (body) => {
    if (!LIBRARIAN.test(String(body.messages[0]?.content || ""))) return { content: "PASS" };
    const prompt = String(body.messages.at(-1).content);
    prompts.push(prompt);
    return { content: JSON.stringify(answer(prompt)) };
  });
  const home = tempHome();
  const seed = new Store(home);
  seed.updateSettings({ brainModel: "ollama/test-model" });
  seed.close();
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true, adminPassword: "fixture-password", sessionKey: "fixture-librarian-budget",
    discordToken: "", telegramToken: "", ollamaUrl: ollama.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    brainDatabaseUrl: "pglite:memory", brainEmbedUrl: ollama.url,
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  await app.companyBrain.ready;
  app.librarian.requestRun = () => false;
  t.after(async () => {
    await app.stop();
    await ollama.close();
  });

  const filler = "Fatto vecchio ancora vero, con la sua data e chi lo ha deciso. ".repeat(110);
  for (let page = 1; page <= 220; page += 1) {
    await app.companyBrain.write({ slug: `cliente-${page}`, kind: "client", title: `Cliente Zeta ${page}`, summary: `Cliente Zeta numero ${page}: ${"riassunto lungo ".repeat(12)}`, body: `- Zeta ${page}\n${filler}`, sources: [{ type: "note", id: `seed-${page}` }], author: "librarian", review: "approved" });
  }
  for (let note = 1; note <= 30; note += 1) {
    await app.companyBrain.note({ text: `Zeta: il cliente Zeta ${note} ha confermato il rinnovo. ${"dettaglio ".repeat(50)}fine nota ${note}`, author: "Ada" });
  }

  let shownSlug = "";
  let hiddenSlug = "";
  answer = (prompt) => {
    shownSlug = /^### (cliente-\d+) \(client\)/m.exec(prompt)?.[1] || "";
    const whole = new Set([...prompt.matchAll(/^### (cliente-\d+) /gm)].map((match) => match[1]));
    hiddenSlug = [...prompt.matchAll(/^- (cliente-\d+) \|/gm)].map((match) => match[1]).find((slug) => !whole.has(slug)) || "";
    return { reasoning: "Rinnovi confermati.", pages: [
      { slug: shownSlug, kind: "client", title: "Cliente visto", summary: "Rinnovato.", body: "- rinnovato", note: "rinnovo", sources: ["n1"] },
      { slug: hiddenSlug, kind: "client", title: "Cliente non visto", summary: "Rinnovato.", body: "- rinnovato", note: "rinnovo", sources: ["n2"] },
    ] };
  };
  const run = await app.librarian.run();
  assert.equal(run.status, "done");
  assert.equal(prompts.length, 1);
  const prompt = prompts[0];
  assert.ok(Buffer.byteLength(prompt, "utf8") <= 80000, `the prompt is ${Buffer.byteLength(prompt, "utf8")} bytes`);
  assert.match(prompt, /## Note degli agenti e ricordi condivisi\n\[n1\] Ada: Zeta: il cliente Zeta 1 /);
  assert.match(prompt, /\[n30\] Ada: [^\n]*fine nota 30/, "the last note arrives whole");
  assert.match(prompt, /- Scrivi nella lingua delle conversazioni\.$/, "the rules close the prompt");
  assert.match(prompt, /## Pagine esistenti\n- cliente-/);
  assert.ok(shownSlug, "at least one page is shown whole");
  assert.ok(hiddenSlug, "a listed page is not shown whole");
  for (const [, number] of prompt.matchAll(/^### cliente-(\d+) /gm)) assert.ok(prompt.includes(`- Zeta ${number}\n${filler.trim()}`), `cliente-${number} is shown whole`);
  assert.deepEqual([run.updated, run.skipped], [1, 1]);
  assert.equal((await app.companyBrain.page(shownSlug)).body, "- rinnovato");
  assert.match((await app.companyBrain.page(hiddenSlug)).body, /^- Zeta \d+\nFatto vecchio/, "a page the model did not read whole keeps its text");
  assert.match(run.log.find((event) => event.kind === "skip").text, /non era nel prompt per intero/);
});
