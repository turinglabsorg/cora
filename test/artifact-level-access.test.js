import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeWorld } from "./knowledge-fixtures.js";

test("team access given on a level reaches every folder of its owner under it, the ones there now and the ones made later", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const make = async (actor, path) => {
    const created = await f.request(actor, "/api/artifacts/folders", { method: "POST", body: { path, description: path, policy: "direct" } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return created.data;
  };
  const report = await make(f.alice, "clienti/acme/report");
  const docs = await make(f.alice, "clienti/beta/docs");
  const sees = async (actor, folder) => (await f.request(actor, "/api/artifacts")).data.folders.some((item) => item.id === folder.id);
  assert.equal(await sees(f.bob, report), false, "a new folder is private to its owner");
  const level = (path, suffix = "") => `/api/artifacts/level${suffix}?${new URLSearchParams({ path })}`;
  assert.equal((await f.request(f.bob, level("clienti", "/access"), { method: "PUT", body: { default: "read", users: {} } })).status, 404, "a level with nothing of yours is not there for you");

  const info = await f.request(f.alice, level("clienti"));
  assert.equal(info.status, 200);
  assert.equal(info.data.canManage, true);
  assert.equal(info.data.managed, 2);
  assert.deepEqual(info.data.access, { default: "none", users: {} });
  assert.ok(info.data.people.some((person) => person.id === f.bob.user.id));

  const saved = await f.request(f.alice, level("clienti", "/access"), { method: "PUT", body: { default: "none", users: { [f.bob.user.id]: "read" } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.users, { [f.bob.user.id]: "read" });
  assert.equal(await sees(f.bob, report), true);
  assert.equal(await sees(f.bob, docs), true);
  assert.equal((await f.request(f.bob, `/api/artifacts/folders/${report.id}`)).data.canUpload, false, "read on the level is only read");
  assert.equal((await f.request(f.bob, level("clienti/acme"))).status, 200, "the level below opens too");
  assert.equal(await sees(f.admin, report), false, "only the people named get in");
  assert.equal((await f.request(f.bob, level("clienti", "/access"), { method: "PUT", body: { default: "write", users: {} } })).status, 403, "reading a level does not let you give it away");
  assert.equal((await f.request(f.bob, level("clienti"))).data.canManage, false);

  const later = await make(f.alice, "clienti/gamma/nuovo");
  assert.equal(await sees(f.bob, later), true, "a folder made later under the level is shared like the others");
  const elsewhere = await make(f.alice, "progetti/interno");
  assert.equal(await sees(f.bob, elsewhere), false, "nothing outside the level");

  const own = await f.request(f.alice, `/api/artifacts/folders/${later.id}`);
  assert.deepEqual(own.data.inherited[f.bob.user.id], { permission: "read", level: "clienti" }, "the folder shows where the access comes from");

  await f.request(f.alice, `/api/artifacts/folders/${report.id}`, { method: "PUT", body: { memberAccess: { default: "none", users: { [f.bob.user.id]: "write" } } } });
  assert.equal((await f.request(f.bob, `/api/artifacts/folders/${report.id}`)).data.canUpload, true, "a folder can give more than its level");

  const bobs = await make(f.bob, "clienti/bob-cliente");
  assert.equal(await sees(f.admin, bobs), false);
  await f.request(f.alice, level("clienti", "/access"), { method: "PUT", body: { default: "write", users: {} } });
  assert.equal(await sees(f.admin, report), true, "the whole team now");
  assert.equal(await sees(f.admin, bobs), false, "Alice's level access never opens Bob's folders");
  assert.equal((await f.request(f.bob, level("clienti"))).data.managed, 1, "Bob gives access only to his own folder in the level");

  assert.equal((await f.request(f.alice, level("clienti/acme/report", "/access"), { method: "PUT", body: { default: "read", users: {} } })).status, 404, "a folder is not a level");
  assert.equal((await f.request(f.alice, level("clienti", "/access"), { method: "PUT", body: { default: "tutto", users: {} } })).status, 400);

  await f.request(f.alice, level("clienti", "/access"), { method: "PUT", body: { default: "none", users: {} } });
  assert.equal(await sees(f.admin, report), false, "taking it back closes it again");
  assert.equal(await sees(f.bob, docs), false);
  assert.equal(await sees(f.bob, report), true, "what the folder gives on its own stays");
});
