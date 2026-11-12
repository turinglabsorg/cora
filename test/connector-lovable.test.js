import assert from "node:assert/strict";
import { test } from "node:test";
import { toolFor } from "../src/connectors/index.js";
import { lovable, rpcAnswer } from "../src/connectors/lovable.js";
import { fakeLovable, LOVABLE_PROJECT, LOVABLE_TOKEN } from "./lovable-fixtures.js";

/** The same request KeyConnectors gives a tool: status, JSON, headers and the raw text. */
const request = async (target, { method = "GET", headers = {}, body, raw, timeout = 30000 } = {}) => {
  let response, text = "";
  try {
    response = await fetch(target, { method, headers: { Accept: "application/json", ...headers }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    text = await response.text();
  } catch { return { status: 0, data: null, headers: {}, text: "" }; }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, data, headers: Object.fromEntries(response.headers), text };
};

function runner(l, { token = LOVABLE_TOKEN, mode = "oauth" } = {}) {
  const written = new Map();
  const files = { "/home/agent/work/mock.png": Buffer.from("mockup bytes") };
  const run = async (name, args = {}) => toolFor(name).run(args, { ...lovable.context({ token, request, api: { lovable: l.mcp }, record: { account: "seb@example.test", mode }, readFile: async (path) => { if (!files[path]) throw new Error("missing"); return files[path]; }, writeFile: async (path, bytes) => { written.set(path, Buffer.from(bytes)); } }), request, allowHttpUpload: true });
  return { run, written };
}

test("the Lovable tools cover the plugin's actions, with the generic call last", () => {
  const names = lovable.tools.map((tool) => tool.name);
  for (const name of ["lovable_me", "lovable_list_workspaces", "lovable_list_projects", "lovable_get_project", "lovable_create_project", "lovable_send_message", "lovable_get_message", "lovable_respond_to_approval", "lovable_get_diff", "lovable_read_file", "lovable_list_files", "lovable_list_edits", "lovable_deploy_project", "lovable_remix_project", "lovable_get_knowledge", "lovable_set_knowledge", "lovable_database_status", "lovable_enable_database", "lovable_query_database", "lovable_upload_file", "lovable_analytics", "lovable_list_connectors", "lovable_mcp"]) assert.ok(names.includes(name), name);
  assert.equal(names.at(-1), "lovable_mcp");
  assert.equal(new Set(names).size, names.length);
  assert.match(lovable.tools[0].description({ account: "seb@example.test" }), /acting as seb@example\.test/);
  assert.match(toolFor("lovable_deploy_project").description, /pending/);
  assert.match(toolFor("lovable_query_database").description, /full rights/);
  assert.match(toolFor("lovable_send_message").description, /lovable_get_diff/);
  for (const tool of lovable.tools) assert.ok((typeof tool.description === "string" ? tool.description : tool.description({})).length < 520, `${tool.name} keeps a short description`);
});

test("the MCP client opens one session, reuses it and reads JSON and SSE answers", async (t) => {
  const l = await fakeLovable(t);
  const { run, written } = runner(l);
  const me = await run("lovable_me");
  assert.equal(me.user.email, "seb@example.test");
  const project = await run("lovable_get_project", { project: `https://lovable.dev/projects/${LOVABLE_PROJECT}?foo=1` });
  assert.equal(project.latest_commit_sha, "abc123");
  assert.equal(project.images.length, 1, "the screenshot goes to the agent's computer");
  assert.match(project.images[0], /^\/home\/agent\/work\/lovable\/get_project-\d+-1\.png$/);
  assert.equal(written.get(project.images[0]).toString(), "PNGDATA");
  const sent = await run("lovable_send_message", { project: LOVABLE_PROJECT, message: "Add a dark mode toggle", plan_mode: true });
  assert.deepEqual(sent, { message_id: "m1", status: "completed", plan_mode: true }, "the SSE answer is read past the progress event");
  const initialize = l.calls.filter((call) => call.method === "initialize");
  assert.equal(initialize.length, 1, "one session for the three calls");
  assert.ok(l.toolCalls().every((call) => call.session === "sess-1" && call.version === "2025-06-18"));
  await run("lovable_send_message", { project: LOVABLE_PROJECT, message: "Match this mockup", files: ["file-1"], wait: false });
  assert.deepEqual(l.toolCalls().at(-1).args.files, [{ file_id: "file-1" }], "file ids become Lovable file references");
  assert.equal(l.toolCalls().at(-1).args.wait, false);
  const sendCall = l.toolCalls().find((call) => call.name === "send_message");
  assert.deepEqual(sendCall.args, { project_id: LOVABLE_PROJECT, message: "Add a dark mode toggle", plan_mode: true, wait: true, timeout_seconds: 180 });
});

test("an expired MCP session is opened again once", async (t) => {
  const l = await fakeLovable(t);
  const { run } = runner(l);
  await run("lovable_list_workspaces");
  l.state.expireNext = true;
  const diff = await run("lovable_get_diff", { project: LOVABLE_PROJECT, message_id: "m1" });
  assert.match(diff.diff, /dark mode/);
  assert.equal(l.calls.filter((call) => call.method === "initialize").length, 2);
});

test("Lovable refusals reach the agent as clear errors", async (t) => {
  const l = await fakeLovable(t);
  const { run } = runner(l);
  await assert.rejects(run("lovable_query_database", { project: LOVABLE_PROJECT, sql: "DROP TABLE users" }), /Lovable: permission denied/);
  await assert.rejects(run("lovable_mcp", { name: "no_such_tool" }), /Lovable: Unknown tool: no_such_tool/);
  await assert.rejects(run("lovable_get_project", { project: "../../etc" }), /Lovable project id/);
  await assert.rejects(run("lovable_get_diff", { project: LOVABLE_PROJECT }), /message_id or sha/);
  await assert.rejects(run("lovable_set_knowledge", { project: LOVABLE_PROJECT, content: "x".repeat(10001) }), /10,000/);
  await assert.rejects(run("lovable_analytics", { project: LOVABLE_PROJECT, start_date: "2026-11-01T00:00:00Z" }), /both start_date and end_date/);
  const other = runner(await fakeLovable(t), { token: "wrong" });
  await assert.rejects(other.run("lovable_me"), /connects Lovable again in Connettori/);
});

test("files from the agent's computer upload to Lovable and come back as a file id", async (t) => {
  const l = await fakeLovable(t);
  const { run } = runner(l);
  const uploaded = await run("lovable_upload_file", { path: "/home/agent/work/mock.png" });
  assert.deepEqual(uploaded, { file_id: "file-1", name: "mock.png", bytes: 12, content_type: "image/png" });
  assert.deepEqual(l.uploads, [{ bytes: "mockup bytes", type: "image/png", extra: "yes" }]);
  assert.deepEqual(l.toolCalls().find((call) => call.name === "get_file_upload_url").args, { file_name: "mock.png", content_type: "image/png" });
  await assert.rejects(run("lovable_upload_file", { path: "/etc/../passwd" }), /absolute path/);
});

test("skills are created or replaced, analytics fall back to live traffic and the generic call lists the server's tools", async (t) => {
  const l = await fakeLovable(t);
  const { run } = runner(l);
  assert.deepEqual(await run("lovable_save_skill", { workspace: "ws1", skill_name: "brand", markdown: "---\nname: brand\n---" }), { updated: "brand", result: { ok: true, name: "brand" } });
  assert.deepEqual(await run("lovable_save_skill", { workspace: "ws1", skill_name: "tone", markdown: "---\nname: tone\n---" }), { created: "tone", result: { ok: true, name: "tone" } });
  assert.deepEqual(await run("lovable_analytics", { project: LOVABLE_PROJECT }), { live: 2 });
  const listed = await run("lovable_mcp", { name: "tools/list" });
  assert.deepEqual(listed.tools[0], { name: "grep_files", description: "Search committed files", parameters: { project_id: "string", query: "string" }, required: ["project_id", "query"] });
  const deployed = await run("lovable_deploy_project", { project: LOVABLE_PROJECT });
  assert.equal(deployed.status, "pending");
});

test("rpcAnswer picks the matching JSON-RPC message from an SSE stream", () => {
  const stream = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assert.deepEqual(rpcAnswer({ text: stream, headers: { "content-type": "text/event-stream" } }, 7), { jsonrpc: "2.0", id: 7, result: { ok: true } });
  assert.equal(rpcAnswer({ text: "", headers: {} }, 1), null);
});

test("a workspace API key travels in the Lovable-API-Key header", async (t) => {
  const l = await fakeLovable(t);
  const { run } = runner(l, { token: "lov_fixture_key", mode: "key" });
  const me = await run("lovable_me");
  assert.equal(me.user.email, "seb@example.test");
  assert.ok(l.state.keyed >= 2, "initialize and the call carry the key header");
});
