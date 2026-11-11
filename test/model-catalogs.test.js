import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fakeCli } from "./helpers.js";
import { knowledgeWorld } from "./knowledge-fixtures.js";

test("subscription CLIs list the models their provider serves today through the connected account, with the machine's cache as fallback", async (t) => {
  const cli = fakeCli();
  const f = await knowledgeWorld({ claudeBin: cli.claude, codexBin: cli.codex, grokBin: cli.grok, museBin: cli.muse, codexModelsFile: cli.models });
  t.after(() => f.close());
  const ids = async (provider) => (await f.app.llm.listModels({ fresh: true })).filter((model) => model.provider === provider);

  assert.deepEqual((await ids("codex")).map((model) => model.id), ["codex/gpt-6-sol"], "without an account the machine's own cache still answers");
  assert.deepEqual((await ids("muse")).map((model) => model.id), ["muse/muse-wonder-1.0", "muse/muse-spark-1.3"]);
  assert.ok(!cli.calls().some((call) => call.flavor === "codex-catalog"), "no account, no CLI asked");

  for (const provider of ["claude", "codex", "grok", "muse"]) {
    const account = f.app.store.createSubscription({ provider, label: provider, connectedBy: { id: f.alice.user.id, name: "Alice" } });
    f.app.store.updateSubscription(account.id, { status: "ready" });
  }
  const codex = await ids("codex");
  assert.deepEqual(codex.map((model) => [model.id, model.label]), [["codex/gpt-6.1-terra", "GPT-6.1 Terra"], ["codex/gpt-6-sol", "GPT-6-Sol"]], "a new model shows up, a hidden one does not");
  assert.ok(codex.every((model) => model.vision && model.thinking && model.tools));
  assert.deepEqual((await ids("grok")).map((model) => [model.id, model.label]), [["grok/grok-4.8", "Grok 4.8"], ["grok/grok-4.7-build-fast", "Grok 4.7 Build Fast"]]);
  assert.deepEqual((await ids("muse")).map((model) => [model.id, model.label, model.thinking]), [["muse/muse-wonder-1.1", "Muse Wonder 1.1", false]]);
  assert.deepEqual((await ids("claude")).map((model) => [model.id, model.label]), [["claude/claude-opus-5-5", "Opus 5.5"], ["claude/claude-sonnet-5-6", "Sonnet 5.6"]], "aliases fold into one model each");
  const catalog = cli.calls().find((call) => call.flavor === "codex-catalog");
  assert.ok(catalog.home && catalog.home !== process.env.CODEX_HOME, "the catalog is read through the connected account's own home");

  const saved = join(f.app.store.home, "model-catalogs.json");
  assert.ok(existsSync(saved));
  assert.equal(JSON.parse(readFileSync(saved, "utf8")).codex.models[0].name, "gpt-6.1-terra", "the last answer survives a restart");
  assert.equal((await f.app.llm.capabilities("codex/gpt-6.1-terra")).vision, true, "an agent on a new model gets its traits");
});
