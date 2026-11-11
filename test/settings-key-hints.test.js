import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeWorld } from "./knowledge-fixtures.js";

test("settings key hints expose only a masked suffix to the owner and follow successful replacement", async (t) => {
  const f = await knowledgeWorld({ ollamaKey: "synthetic-ollama-ABCD", orcaKey: "synthetic-router-EFGH", sonioxKey: "synthetic-voice-IJKL", typesafeKey: "tiny" });
  t.after(() => f.close());
  const owner = await f.request(f.admin, "/api/state");
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.data.keyHints, { ollama: "•••• ABCD", orcarouter: "•••• EFGH", soniox: "•••• IJKL", typesafe: "••••", deepseek: "" });
  assert.doesNotMatch(JSON.stringify(owner.data), /synthetic-ollama|synthetic-router|synthetic-voice|tiny/);
  assert.deepEqual((await f.request(f.alice, "/api/state")).data.keyHints, {});
  assert.equal((await f.request(f.alice, "/api/providers/ollama/key", { method: "PUT", body: { key: "synthetic-denied-ZZZZ" } })).status, 403);
  const saved = await f.request(f.admin, "/api/providers/ollama/key", { method: "PUT", body: { key: "synthetic-new-WXYZ" } });
  assert.deepEqual(saved.data, { provider: "ollama", configured: true, keyHint: "•••• WXYZ" });
  assert.equal((await f.request(f.admin, "/api/state")).data.keyHints.ollama, "•••• WXYZ");
  assert.equal((await f.request(f.admin, "/api/providers/ollama/key", { method: "PUT", body: { key: "" } })).status, 400);
  assert.equal((await f.request(f.admin, "/api/state")).data.keyHints.ollama, "•••• WXYZ");
});
