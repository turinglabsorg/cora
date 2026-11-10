import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { asana } from "../src/connectors/asana.js";
import { summarizeTool, toolFor } from "../src/connectors/index.js";

const TOKEN = "asana_fixture_pat";

/** A small Asana: one organization, one team, two projects with sections, custom fields, tags, users and tasks. */
async function fakeAsana(t) {
  const calls = [];
  const db = {
    users: [{ gid: "u1", name: "Sebastiano", email: "seb@example.test" }, { gid: "u2", name: "Virginia Russo", email: "virginia@example.test" }],
    projects: [{ gid: "p1", name: "Dopamina", team: { gid: "t1", name: "Studio" } }, { gid: "p2", name: "Dopamina Social", team: { gid: "t1", name: "Studio" } }],
    sections: { p1: [{ gid: "s1", name: "To do" }, { gid: "s2", name: "Done" }], p2: [] },
    tags: [{ gid: "g1", name: "urgent" }, { gid: "g2", name: "client" }],
    fields: [{ gid: "f1", name: "Priority", resource_subtype: "enum", enum_options: [{ gid: "o1", name: "High" }, { gid: "o2", name: "Low" }] }, { gid: "f2", name: "Hours", resource_subtype: "number" }],
    tasks: new Map([["100", { gid: "100", name: "Brief", completed: false, notes: "old", num_subtasks: 1, memberships: [{ project: { gid: "p1" }, section: { gid: "s1" } }] }], ["101", { gid: "101", name: "Shipped", completed: true, memberships: [{ project: { gid: "p1" }, section: { gid: "s2" } }] }]]),
    stories: [{ gid: "st1", resource_subtype: "comment_added", text: "looks good", created_by: { name: "Virginia Russo" } }, { gid: "st2", resource_subtype: "assigned", text: "assigned" }],
    serial: 200,
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const type = String(req.headers["content-type"] || "");
    const body = type.includes("json") && raw.length ? JSON.parse(raw).data : null;
    const url = new URL(req.url, "http://asana.test");
    const path = url.pathname.replace(/^\/api/, "");
    const q = Object.fromEntries(url.searchParams);
    calls.push({ method: req.method, path, query: q, body, type, size: raw.length, raw: type.includes("multipart") ? raw.toString("latin1") : "" });
    const send = (status, data, extra = {}) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data, ...extra })); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, null, { errors: [{ message: "Not Authorized" }] });
    let m;
    if (path === "/users/me") return send(200, { gid: "u1", name: "Sebastiano", email: "seb@example.test", workspaces: [{ gid: "w1", name: "Dopamina", is_organization: true }] });
    if (path === "/workspaces/w1/teams") return send(200, [{ gid: "t1", name: "Studio" }]);
    if (path === "/workspaces/w1/users") return send(200, db.users);
    if (path === "/workspaces/w1/tags") return send(200, db.tags);
    if (path === "/projects" && req.method === "GET") {
      // Two pages, to prove the tools follow Asana's offsets.
      if (!q.offset) return send(200, [db.projects[0]], { next_page: { offset: "page2" } });
      return send(200, db.projects.slice(1));
    }
    if (path === "/teams/t1/projects") return send(200, db.projects);
    if ((m = path.match(/^\/projects\/(p\d)$/)) && req.method === "GET") return send(200, { ...db.projects.find((p) => p.gid === m[1]), custom_field_settings: db.fields.map((field) => ({ custom_field: field })) });
    if ((m = path.match(/^\/projects\/(p\d)$/)) && req.method === "PUT") return send(200, { ...db.projects.find((p) => p.gid === m[1]), ...body });
    if ((m = path.match(/^\/projects\/(p\d+)\/sections$/))) {
      if (req.method === "POST") { const section = { gid: `s${++db.serial}`, name: body.name }; (db.sections[m[1]] ||= []).push(section); return send(201, section); }
      return send(200, db.sections[m[1]]);
    }
    if ((m = path.match(/^\/projects\/(p\d)\/custom_field_settings$/))) return send(200, db.fields.map((field) => ({ custom_field: field })));
    if (path === "/projects" && req.method === "POST") { const project = { gid: `p${++db.serial}`, ...body }; return send(201, project); }
    if (path === "/status_updates") return send(201, { gid: "su1", resource_type: "status_update", ...body });
    if (path === "/tasks" && req.method === "GET") {
      let tasks = [...db.tasks.values()];
      if (q.project) tasks = tasks.filter((task) => task.memberships?.some((item) => item.project.gid === q.project));
      if (q.completed_since === "now") tasks = tasks.filter((task) => !task.completed);
      return send(200, tasks);
    }
    if ((m = path.match(/^\/sections\/(s\d+)\/addTask$/))) { const task = db.tasks.get(body.task); const project = Object.keys(db.sections).find((key) => db.sections[key].some((item) => item.gid === m[1])); task.memberships = [...task.memberships.filter((item) => item.project.gid !== project), { project: { gid: project }, section: { gid: m[1] } }]; return send(200, {}); }
    if ((m = path.match(/^\/sections\/(s\d+)\/tasks$/))) return send(200, [...db.tasks.values()].filter((task) => task.memberships?.some((item) => item.section?.gid === m[1]) && (q.completed_since !== "now" || !task.completed)));
    if (path === "/workspaces/w1/tasks/search") return send(200, [...db.tasks.values()].filter((task) => !q.text || task.name.toLowerCase().includes(q.text.toLowerCase())));
    if (path === "/tasks" && req.method === "POST") { const task = { gid: String(++db.serial), ...body, memberships: (body.projects || []).map((project) => ({ project: { gid: project } })) }; if (!body.projects && !body.workspace) return send(400, null, { errors: [{ message: "You should specify one of workspace, parent, projects" }] }); db.tasks.set(task.gid, task); return send(201, task); }
    if ((m = path.match(/^\/tasks\/(\d+)\/subtasks$/))) {
      if (req.method === "POST") { const task = { gid: String(++db.serial), parent: { gid: m[1] }, ...body }; db.tasks.set(task.gid, task); return send(201, task); }
      return send(200, [{ gid: "150", name: "Sub", completed: false }]);
    }
    if ((m = path.match(/^\/tasks\/(\d+)\/stories$/))) {
      if (req.method === "POST") return send(201, { gid: "st9", text: body.text || body.html_text, created_by: { name: "Sebastiano" } });
      return send(200, db.stories);
    }
    if ((m = path.match(/^\/tasks\/(\d+)\/(addTag|removeTag|addFollowers|removeFollowers|addProject|removeProject|setParent)$/))) {
      const task = db.tasks.get(m[1]);
      if (m[2] === "addTag") (task.tags ||= []).push(body.tag);
      if (m[2] === "addProject") task.memberships = [...(task.memberships || []).filter((item) => item.project.gid !== body.project), { project: { gid: body.project }, section: body.section ? { gid: body.section } : undefined }];
      if (m[2] === "removeProject") task.memberships = (task.memberships || []).filter((item) => item.project.gid !== body.project);
      if (m[2] === "setParent") task.parent = body.parent ? { gid: body.parent } : null;
      return send(200, {});
    }
    if (path === "/attachments" && req.method === "GET") return send(200, [{ gid: "a1", resource_type: "attachment", name: "spec.pdf" }]);
    if (path === "/attachments" && req.method === "POST") return send(200, { gid: "a2", resource_type: "attachment", name: "uploaded" });
    if ((m = path.match(/^\/tasks\/(\d+)$/))) {
      const task = db.tasks.get(m[1]);
      if (!task) return send(404, null, { errors: [{ message: `task: Unknown object: ${m[1]}` }] });
      if (req.method === "PUT") Object.assign(task, body);
      if (req.method === "DELETE") { db.tasks.delete(m[1]); return send(200, {}); }
      if (q.opt_fields?.startsWith("custom_fields")) return send(200, { custom_fields: db.fields });
      return send(200, task);
    }
    if (path === "/workspaces/w2/tasks/search") return send(402, null, { errors: [{ message: "Search is only available to premium users." }] });
    return send(404, null, { errors: [{ message: `no route ${req.method} ${path}` }] });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (url, { method = "GET", headers = {}, body, raw } = {}) => {
    const response = await fetch(url, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  const files = new Map([["/home/agent/work/shot.png", Buffer.from("PNGDATA")]]);
  const ctx = (token = TOKEN) => asana.context({ token, request, api: { asana: base }, record: { workspace: "Dopamina", workspaceId: "w1", account: "Sebastiano" }, readFile: async (path) => { if (!files.has(path)) throw new Error("missing"); return files.get(path); } });
  const run = (name, args = {}, token) => toolFor(name).run(args, ctx(token));
  return { calls, db, run, last: (method, path) => calls.filter((call) => call.method === method && call.path === path).at(-1) };
}

test("the Asana tools read the workspace, projects, tasks and people, following pages and resolving names", async (t) => {
  const a = await fakeAsana(t);
  const tools = asana.tools.map((tool) => tool.name);
  for (const name of ["asana_workspaces", "asana_list_projects", "asana_get_project", "asana_list_tasks", "asana_search_tasks", "asana_get_task", "asana_list_users", "asana_create_task", "asana_update_task", "asana_move_task", "asana_delete_task", "asana_comment", "asana_attach", "asana_create_project", "asana_update_project", "asana_create_section", "asana_post_status", "asana_api"]) assert.ok(tools.includes(name), name);
  assert.equal(tools.at(-1), "asana_api", "the generic call comes last, as the fallback");

  const workspaces = await a.run("asana_workspaces");
  assert.deepEqual(workspaces.me, { gid: "u1", name: "Sebastiano", email: "seb@example.test" });
  assert.deepEqual(workspaces.workspaces[0].teams, [{ gid: "t1", name: "Studio" }]);
  assert.equal(workspaces.workspaces[0].default, true);

  assert.deepEqual((await a.run("asana_list_projects")).map((item) => item.name), ["Dopamina", "Dopamina Social"], "both pages");
  assert.deepEqual((await a.run("asana_list_projects", { team: "studio", query: "social" })).map((item) => item.gid), ["p2"]);

  const project = await a.run("asana_get_project", { project: "dopamina social" });
  assert.equal(project.gid, "p2", "an exact name wins over a partial one");
  assert.match(String((await a.run("asana_get_project", { project: "Dopa" }).catch((error) => error.message))), /more than one project matches "Dopa": Dopamina \(p1\), Dopamina Social \(p2\)/);
  assert.match(String((await a.run("asana_get_project", { project: "Nope" }).catch((error) => error.message))), /no project named "Nope"/);
  const withSections = await a.run("asana_get_project", { project: "p1" });
  assert.deepEqual(withSections.sections, [{ gid: "s1", name: "To do" }, { gid: "s2", name: "Done" }]);
  assert.equal(withSections.custom_field_settings[0].custom_field.name, "Priority");

  assert.deepEqual((await a.run("asana_list_tasks", { project: "Dopamina" })).map((task) => task.gid), ["100"], "open tasks by default");
  assert.equal(a.last("GET", "/tasks").query.completed_since, "now");
  assert.deepEqual((await a.run("asana_list_tasks", { project: "p1", status: "completed" })).map((task) => task.gid), ["101"]);
  assert.deepEqual((await a.run("asana_list_tasks", { project: "p1", section: "done", status: "all" })).map((task) => task.gid), ["101"]);
  await a.run("asana_list_tasks", { assignee: "me" });
  assert.deepEqual([a.last("GET", "/tasks").query.assignee, a.last("GET", "/tasks").query.workspace], ["me", "w1"]);
  assert.match(String(await a.run("asana_list_tasks", {}).catch((error) => error.message)), /name a project, a section or an assignee/);

  assert.deepEqual((await a.run("asana_search_tasks", { text: "brief", completed: false, due_after: "2026-11-01", assignee: "me" })).map((task) => task.gid), ["100"]);
  const search = a.last("GET", "/workspaces/w1/tasks/search").query;
  assert.deepEqual([search.text, search.completed, search["due_on.after"], search["assignee.any"]], ["brief", "false", "2026-11-01", "me"]);
  assert.match(String(await a.run("asana_search_tasks", { workspace: "w2", text: "x" }).catch((error) => error.message)), /paid Asana plan/);

  const task = await a.run("asana_get_task", { task: "https://app.asana.com/1/w1/project/p1/task/100" });
  assert.equal(task.gid, "100");
  assert.deepEqual(task.comments.map((item) => [item.by, item.text]), [["Virginia Russo", "looks good"]], "only comments, not the activity");
  assert.deepEqual(task.subtasks.map((item) => item.name), ["Sub"]);
  assert.deepEqual(task.attachments, [{ gid: "a1", name: "spec.pdf" }]);
  assert.match(String(await a.run("asana_get_task", { task: "999" }).catch((error) => error.message)), /Asana answered 404: task: Unknown object: 999/);
  assert.match(String(await a.run("asana_get_task", { task: "not-a-task" }).catch((error) => error.message)), /task is a gid/);

  assert.deepEqual((await a.run("asana_list_users", { query: "virginia" })).map((user) => user.gid), ["u2"]);
  assert.match(String(await a.run("asana_workspaces", {}, "wrong").catch((error) => error.message)), /Asana refuses the token/);
});

test("the Asana tools create, change, move, comment, attach and delete with names turned into gids", async (t) => {
  const a = await fakeAsana(t);
  const created = await a.run("asana_create_task", { name: "Landing copy", notes: "draft", project: "Dopamina", section: "To do", assignee: "virginia@example.test", due_on: "2026-11-20", tags: ["urgent"], custom_fields: { Priority: "high", Hours: 3 } });
  const post = a.last("POST", "/tasks").body;
  assert.deepEqual(post.projects, ["p1"]);
  assert.deepEqual(a.last("POST", "/sections/s1/addTask").body, { task: created.gid }, "the section is set after the task exists");
  assert.deepEqual(a.db.tasks.get(created.gid).memberships, [{ project: { gid: "p1" }, section: { gid: "s1" } }]);
  assert.deepEqual([post.assignee, post.due_on, post.tags, post.custom_fields], ["virginia@example.test", "2026-11-20", ["g1"], { f1: "o1", f2: 3 }]);
  assert.equal(created.name, "Landing copy");

  const sub = await a.run("asana_create_task", { name: "Check", parent: created.gid });
  assert.equal(a.db.tasks.get(sub.gid).parent.gid, created.gid);
  await a.run("asana_create_task", { name: "Loose" });
  assert.equal(a.last("POST", "/tasks").body.workspace, "w1", "a task outside projects goes in the workspace");

  await a.run("asana_update_task", { task: created.gid, assignee: "none", due_on: "none", completed: true, custom_fields: { priority: "Low" }, add_tags: ["client"] });
  const put = a.last("PUT", `/tasks/${created.gid}`).body;
  assert.deepEqual([put.assignee, put.due_on, put.completed, put.custom_fields], [null, null, true, { f1: "o2" }]);
  assert.equal(put.notes, undefined, "an update sends only what the agent named");
  assert.deepEqual(a.db.tasks.get(created.gid).tags, ["g1", "g2"]);
  assert.equal(a.last("POST", `/tasks/${created.gid}/addTag`).body.tag, "g2");

  await a.run("asana_move_task", { task: created.gid, section: "Done" });
  assert.deepEqual(a.last("POST", `/tasks/${created.gid}/addProject`).body, { project: "p1", section: "s2" }, "the section of the task's own project");
  await a.run("asana_move_task", { task: created.gid, remove_from_project: "Dopamina", parent: "100" });
  assert.equal(a.last("POST", `/tasks/${created.gid}/removeProject`).body.project, "p1");
  assert.equal(a.last("POST", `/tasks/${created.gid}/setParent`).body.parent, "100");
  await a.run("asana_move_task", { task: created.gid, parent: "none" });
  assert.equal(a.last("POST", `/tasks/${created.gid}/setParent`).body.parent, null);
  assert.match(String(await a.run("asana_move_task", { task: created.gid }).catch((error) => error.message)), /name where to move it/);

  const comment = await a.run("asana_comment", { task: created.gid, text: "Pronto per la revisione" });
  assert.deepEqual([comment.text, comment.by], ["Pronto per la revisione", "Sebastiano"]);
  assert.match(String(await a.run("asana_comment", { task: created.gid }).catch((error) => error.message)), /write text or html_text/);

  const link = await a.run("asana_attach", { task: created.gid, url: "https://example.test/brief", name: "Brief" });
  assert.deepEqual(link, { gid: "a2", name: "uploaded" });
  assert.match(a.last("POST", "/attachments").raw, /name="resource_subtype"\r\n\r\nexternal/);
  await a.run("asana_attach", { task: created.gid, path: "/home/agent/work/shot.png" });
  const upload = a.last("POST", "/attachments");
  assert.match(upload.type, /multipart\/form-data/);
  assert.match(upload.raw, /filename="shot\.png"\r\nContent-Type: image\/png\r\n\r\nPNGDATA/);
  assert.match(String(await a.run("asana_attach", { task: created.gid, path: "/home/agent/work/missing.png" }).catch((error) => error.message)), /cannot read/);
  assert.match(String(await a.run("asana_attach", { task: created.gid, path: "relative.png" }).catch((error) => error.message)), /absolute path/);

  assert.deepEqual(await a.run("asana_delete_task", { task: sub.gid }), { deleted: sub.gid });
  assert.equal(a.db.tasks.has(sub.gid), false);

  const project = await a.run("asana_create_project", { name: "Nuovo cliente", sections: ["Brief", "Design"], default_view: "board" });
  assert.equal(a.last("POST", "/projects").body.team, "t1", "the only team is used");
  assert.deepEqual(project.sections.map((item) => item.name), ["Brief", "Design"]);
  await a.run("asana_update_project", { project: "p1", archived: true });
  assert.deepEqual(a.last("PUT", "/projects/p1").body, { archived: true });
  assert.match(String(await a.run("asana_update_project", { project: "p1" }).catch((error) => error.message)), /name something to change/);
  assert.equal((await a.run("asana_create_section", { project: "p2", name: "Review" })).name, "Review");
  const status = await a.run("asana_post_status", { project: "p1", status: "at_risk", title: "Late copy", text: "Waiting on the client" });
  assert.deepEqual([status.parent, status.status_type, status.resource_type], ["p1", "at_risk", undefined]);
  assert.match(String(await a.run("asana_post_status", { project: "p1", status: "fine", title: "x" }).catch((error) => error.message)), /status is one of/);

  const raw = await a.run("asana_api", { method: "PUT", path: "/tasks/100?opt_fields=name", body: { name: "Brief v2" } });
  assert.equal(raw.data.name, "Brief v2");
  assert.deepEqual(a.last("PUT", "/tasks/100").query, { opt_fields: "name" });
  assert.equal(summarizeTool("asana_create_task", { name: "Landing copy", notes: "secret notes" }), '"Landing copy"');
  assert.equal(summarizeTool("asana_attach", { task: "1", path: "/home/agent/work/shot.png" }), "task 1 · /home/agent/work/shot.png");
});
