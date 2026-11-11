import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { linear } from "../src/connectors/linear.js";
import { toolFor } from "../src/connectors/index.js";

const KEY = "lin_api_fixture";

/** A small Linear GraphQL endpoint: answers by the root field each query asks for and records the variables. */
async function fakeLinear(t) {
  const calls = [];
  const team = { id: "team-ref", key: "REF", name: "Refracto", activeCycle: { id: "cyc-7", number: 7 }, states: { nodes: [{ id: "st-b", name: "Backlog", type: "backlog", position: 0 }, { id: "st-t", name: "Todo", type: "unstarted", position: 1 }, { id: "st-p", name: "In Progress", type: "started", position: 2 }, { id: "st-r", name: "In Review", type: "started", position: 3 }, { id: "st-d", name: "Done", type: "completed", position: 4 }] }, labels: { nodes: [{ id: "lb-bug", name: "Bug" }, { id: "lb-ui", name: "UI" }] } };
  const issues = { "REF-62": { id: "iss-62", identifier: "REF-62", team: { key: "REF" } }, "REF-23": { id: "iss-23", identifier: "REF-23", team: { key: "REF" } } };
  const answer = (query, variables) => {
    const ok = (field, value) => ({ data: { [field]: value } });
    if (/issueCreate\(/.test(query)) return ok("issueCreate", { success: true, issue: { id: "iss-100", identifier: "REF-100", title: variables.input.title, url: "https://linear.app/x/issue/REF-100" } });
    if (/issueUpdate\(/.test(query)) return ok("issueUpdate", { success: true, issue: { id: variables.id, identifier: "REF-62" } });
    if (/commentCreate\(/.test(query)) return ok("commentCreate", { success: true, comment: { id: "com-1", url: "https://linear.app/c" } });
    if (/attachmentLinkURL\(/.test(query)) return ok("attachmentLinkURL", { success: true, attachment: { id: "att-1", title: variables.title, url: variables.url } });
    if (/fileUpload\(/.test(query)) return ok("fileUpload", { success: true, uploadFile: { uploadUrl: `${base}/upload`, assetUrl: "https://uploads.linear.app/a/shot.png", headers: [{ key: "x-goog-meta", value: "1" }] } });
    if (/issueRelationCreate\(/.test(query)) return ok("issueRelationCreate", { success: true, issueRelation: { id: "rel-1", type: variables.input.type } });
    if (/issueArchive\(/.test(query)) return ok("issueArchive", { success: true });
    if (/issueDelete\(/.test(query)) return ok("issueDelete", { success: true });
    if (/projectCreate\(/.test(query)) return ok("projectCreate", { success: true, project: { id: "prj-2", name: variables.input.name, url: "u" } });
    if (/projectUpdateCreate\(/.test(query)) return ok("projectUpdateCreate", { success: true, projectUpdate: { id: "pu-1", health: variables.input.health } });
    if (/projectUpdate\(/.test(query)) return ok("projectUpdate", { success: true, project: { id: variables.id, name: "Admin", status: { name: "In Progress" } } });
    if (/projectStatuses/.test(query)) return ok("projectStatuses", { nodes: [{ id: "ps-plan", name: "Planned", type: "planned" }, { id: "ps-go", name: "In Progress", type: "started" }] });
    if (/viewer \{ id \}/.test(query)) return ok("viewer", { id: "usr-seb" });
    if (/team\(id: \$id\) \{ cycles/.test(query)) return ok("team", { cycles: { nodes: [{ id: "cyc-6", number: 6 }, { id: "cyc-7", number: 7 }] } });
    if (/team\(id: \$id\)/.test(query)) return ok("team", variables.id === team.id ? team : { id: "team-ops", key: "OPS", name: "Operations", states: { nodes: [] }, labels: { nodes: [] } });
    if (/issueLabels\(first: 250, filter/.test(query)) return ok("issueLabels", { nodes: [{ id: "lb-ws", name: "Customer" }] });
    if (/issueLabels/.test(query)) return ok("issueLabels", { nodes: [{ name: "Bug", team: { key: "REF" } }, { name: "Customer", team: null }] });
    if (/teams\(first: 100\)/.test(query)) return { data: { viewer: { id: "usr-seb", name: "Seb" }, teams: { nodes: [{ ...team, states: team.states, labels: undefined }] } } };
    if (/teams\(first: 250\)/.test(query)) return ok("teams", { nodes: [{ id: team.id, key: "REF", name: "Refracto" }, { id: "team-ops", key: "OPS", name: "Operations" }] });
    if (/users\(first: 250\)/.test(query)) return ok("users", { nodes: [{ id: "usr-seb", name: "Sebastiano Cataudo", displayName: "seb", email: "seb@example.test", active: true }, { id: "usr-vir", name: "Virginia Russo", displayName: "virginia", email: "virginia@example.test", active: true }, { id: "usr-old", name: "Virginia Old", displayName: "vold", email: "old@example.test", active: false }] });
    if (/projects\(first: 250\)/.test(query)) return ok("projects", { nodes: [{ id: "prj-1", name: "Admin rationalization", slugId: "4f2a9c1b77" }, { id: "prj-3", name: "Admin v2", slugId: "0a0a0a0a0a" }] });
    if (/project\(id: \$id\)/.test(query)) return ok("project", { id: variables.id, name: "Admin rationalization", teams: { nodes: [{ key: "REF" }] }, members: { nodes: [{ name: "Seb" }] }, issues: { nodes: [] } });
    if (/searchIssues/.test(query)) return ok("searchIssues", { nodes: [{ identifier: "REF-62", labels: { nodes: [{ name: "UI" }] } }] });
    if (/issues\(filter/.test(query)) return ok("issues", { nodes: [{ identifier: "REF-62", state: { name: "In Progress" }, labels: { nodes: [] } }] });
    if (/issue\(id: \$id\) \{ id \}/.test(query) || /issue\(id: \$id\) \{ id identifier team/.test(query)) return issues[variables.id] ? ok("issue", issues[variables.id]) : { data: null, errors: [{ message: "Entity not found: Issue" }] };
    if (/issue\(id: \$id\)/.test(query)) return ok("issue", { id: "iss-62", identifier: "REF-62", labels: { nodes: [{ name: "UI" }] }, children: { nodes: [] }, comments: { nodes: [{ id: "c2", body: "second", createdAt: "2026-11-10T12:00:00Z", user: { name: "Nico" }, parent: { id: "c1" } }, { id: "c1", body: "first", createdAt: "2026-11-10T10:00:00Z", user: { name: "Seb" }, parent: null }] } });
    return { data: null, errors: [{ message: `fixture has no answer for ${query.slice(0, 80)}` }] };
  };
  const uploads = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (req.url === "/upload") { uploads.push({ method: req.method, headers: req.headers, raw: raw.toString("latin1") }); res.writeHead(200); return res.end(); }
    if (req.headers.authorization !== KEY) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ errors: [{ message: "Authentication required" }] })); }
    const { query, variables } = JSON.parse(raw);
    calls.push({ query: query.replace(/\s+/g, " "), variables: variables || {} });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer(query, variables || {})));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, { method = "GET", headers = {}, body, raw } = {}) => {
    const response = await fetch(url, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  };
  const files = { "/home/agent/work/shot.png": Buffer.from("PNG proof") };
  const run = (name, args = {}, key = KEY, extra = {}) => toolFor(name).run(args, linear.context({ token: key, request, api: { linear: `${base}/graphql` }, record: { workspace: "refracto" }, ...extra, readFile: async (path) => { if (!files[path]) throw new Error("missing"); return files[path]; } }));
  const last = (pattern) => [...calls].reverse().find((call) => pattern.test(call.query));
  return { run, calls, last, uploads };
}

test("the Linear tools read teams, issues, projects and people, turning names into filters", async (t) => {
  const l = await fakeLinear(t);
  const names = linear.tools.map((tool) => tool.name);
  for (const name of ["linear_teams", "linear_list_issues", "linear_get_issue", "linear_list_projects", "linear_get_project", "linear_list_users", "linear_create_issue", "linear_update_issue", "linear_comment", "linear_attach", "linear_relate_issues", "linear_delete_issue", "linear_create_project", "linear_update_project", "linear_post_project_update", "linear_graphql"]) assert.ok(names.includes(name), name);
  assert.equal(names.at(-1), "linear_graphql", "the generic call comes last, as the fallback");
  assert.match(linear.tools[0].description({ workspace: "refracto", account: "seb@example.test" }), /workspace refracto, acting as seb@example.test/);

  const teams = await l.run("linear_teams");
  assert.deepEqual(teams.teams[0].states.map((state) => state.name), ["Backlog", "Todo", "In Progress", "In Review", "Done"]);
  assert.deepEqual(teams.teams[0].labels, ["Bug", "Customer"], "team labels plus workspace labels");

  await l.run("linear_list_issues", { team: "ref" });
  assert.deepEqual(l.last(/issues\(filter/).variables.filter, { team: { key: { eq: "REF" } }, state: { type: { nin: ["completed", "canceled"] } } }, "open issues by default");
  await l.run("linear_list_issues", { team: "REF", state: "In Review", assignee: "virginia", label: "bug", priority: "high", cycle: "current", updated_since: "2026-11-01", first: 900 });
  const { filter, first } = l.last(/issues\(filter/).variables;
  assert.deepEqual(filter, { team: { key: { eq: "REF" } }, state: { name: { eqIgnoreCase: "In Review" } }, assignee: { id: { eq: "usr-vir" } }, labels: { some: { name: { eqIgnoreCase: "bug" } } }, priority: { eq: 2 }, cycle: { isActive: { eq: true } }, updatedAt: { gte: "2026-11-01" } });
  assert.equal(first, 250, "capped");
  await l.run("linear_list_issues", { assignee: "me", state: "closed" });
  assert.deepEqual(l.last(/issues\(filter/).variables.filter, { state: { type: { in: ["completed", "canceled"] } }, assignee: { isMe: { eq: true } } });
  assert.deepEqual(await l.run("linear_list_issues", { text: "source health" }), [{ identifier: "REF-62", labels: [{ name: "UI" }] }]);
  assert.equal(l.last(/searchIssues/).variables.term, "source health");

  const issue = await l.run("linear_get_issue", { issue: "https://linear.app/refracto/issue/ref-62/rationalize" });
  assert.equal(l.last(/issue\(id: \$id\) \{ id identifier title description/).variables.id, "REF-62", "the identifier comes out of the URL");
  assert.deepEqual(issue.labels, ["UI"]);
  assert.deepEqual(issue.comments.map((comment) => [comment.by, comment.body, comment.reply_to]), [["Seb", "first", undefined], ["Nico", "second", "c1"]], "oldest first, replies marked");

  await l.run("linear_get_project", { project: "https://linear.app/refracto/project/admin-rationalization-4f2a9c1b77/overview" });
  assert.equal(l.last(/project\(id: \$id\)/).variables.id, "prj-1", "a project URL resolves by its slug");
  assert.match(String(await l.run("linear_get_project", { project: "Admin" }).catch((error) => error.message)), /more than one project matches "Admin"/);
  assert.deepEqual((await l.run("linear_list_users", { query: "virginia" })).map((user) => user.id), ["usr-vir", "usr-old"]);
  assert.match(String(await l.run("linear_teams", {}, "lin_api_wrong").catch((error) => error.message)), /Linear refuses the key/);
});

test("the Linear tools create, change, comment, attach, relate and delete with names turned into ids", async (t) => {
  const l = await fakeLinear(t);
  const created = await l.run("linear_create_issue", { team: "REF", title: "Source Health", description: "## Why", state: "unstarted", assignee: "virginia@example.test", priority: "urgent", labels: ["bug", "Customer"], project: "Admin rationalization", cycle: "current", parent: "REF-62", due_date: "2026-11-30", estimate: 2 });
  assert.equal(created.identifier, "REF-100");
  assert.deepEqual(l.last(/issueCreate/).variables.input, { teamId: "team-ref", title: "Source Health", description: "## Why", stateId: "st-t", assigneeId: "usr-vir", priority: 1, labelIds: ["lb-bug", "lb-ws"], projectId: "prj-1", cycleId: "cyc-7", parentId: "iss-62", dueDate: "2026-11-30", estimate: 2 });
  assert.match(String(await l.run("linear_create_issue", { team: "REF", title: "x", due_date: "30/11" }).catch((error) => error.message)), /dates are YYYY-MM-DD/);
  assert.match(String(await l.run("linear_create_issue", { team: "NOPE", title: "x" }).catch((error) => error.message)), /no team named "NOPE"/);

  await l.run("linear_update_issue", { issue: "REF-62", state: "started", assignee: "none", due_date: "none", add_labels: ["UI"], remove_labels: ["Bug"], cycle: "6" });
  assert.deepEqual(l.last(/issueUpdate/).variables, { id: "iss-62", input: { stateId: "st-p", assigneeId: null, cycleId: "cyc-6", dueDate: null, addedLabelIds: ["lb-ui"], removedLabelIds: ["lb-bug"] } }, "a state type picks its first state");
  assert.match(String(await l.run("linear_update_issue", { issue: "REF-62" }).catch((error) => error.message)), /name something to change/);
  assert.match(String(await l.run("linear_update_issue", { issue: "REF-999", title: "x" }).catch((error) => error.message)), /Entity not found/);

  assert.equal((await l.run("linear_comment", { issue: "ref-62", body: "Verified", reply_to: "c1" })).issue, "REF-62");
  assert.deepEqual(l.last(/commentCreate/).variables.input, { issueId: "iss-62", body: "Verified", parentId: "c1" });

  await l.run("linear_attach", { issue: "REF-62", url: "https://admin.refracto.ai/sources", title: "Source Health" });
  assert.deepEqual(l.last(/attachmentLinkURL/).variables, { issueId: "iss-62", url: "https://admin.refracto.ai/sources", title: "Source Health" });
  const attached = await l.run("linear_attach", { issue: "REF-62", path: "/home/agent/work/shot.png", comment: "After the fix" });
  assert.deepEqual(l.last(/fileUpload/).variables, { contentType: "image/png", filename: "shot.png", size: 9 });
  assert.equal(l.uploads[0].method, "PUT");
  assert.equal(l.uploads[0].headers["x-goog-meta"], "1", "Linear's signed headers go with the upload");
  assert.equal(l.uploads[0].raw, "PNG proof");
  assert.equal(l.last(/commentCreate/).variables.input.body, "After the fix\n\n![shot.png](https://uploads.linear.app/a/shot.png)", "an image shows inline in the comment");
  assert.equal(attached.assetUrl, "https://uploads.linear.app/a/shot.png");
  assert.deepEqual(await l.run("linear_attach", { path: "/home/agent/work/shot.png" }), { filename: "shot.png", assetUrl: "https://uploads.linear.app/a/shot.png", markdown: "![shot.png](https://uploads.linear.app/a/shot.png)" });
  assert.match(String(await l.run("linear_attach", { issue: "REF-62", path: "/etc/../secret" }).catch((error) => error.message)), /absolute path of the file/);

  const relation = await l.run("linear_relate_issues", { issue: "REF-62", relation: "blocked_by", other: "REF-23" });
  assert.deepEqual(l.last(/issueRelationCreate/).variables.input, { issueId: "iss-23", relatedIssueId: "iss-62", type: "blocks" }, "blocked_by turns around");
  assert.equal(relation.issue, "REF-23");

  assert.deepEqual(await l.run("linear_delete_issue", { issue: "REF-62" }), { archived: "REF-62" }, "archive by default");
  assert.deepEqual(await l.run("linear_delete_issue", { issue: "REF-62", mode: "delete" }), { deleted: "REF-62" });

  await l.run("linear_create_project", { name: "Content", teams: ["REF", "OPS"], lead: "me", description: "Briefing, audio, social", target_date: "2026-12-31" });
  assert.deepEqual(l.last(/projectCreate/).variables.input, { name: "Content", teamIds: ["team-ref", "team-ops"], content: "Briefing, audio, social", leadId: "usr-seb", targetDate: "2026-12-31" });
  await l.run("linear_update_project", { project: "Admin rationalization", status: "started" });
  assert.deepEqual(l.last(/projectUpdate\(/).variables, { id: "prj-1", input: { statusId: "ps-go" } });
  await l.run("linear_post_project_update", { project: "prj-1", health: "at_risk", body: "Sources slow" });
  assert.deepEqual(l.last(/projectUpdateCreate/).variables.input, { projectId: "prj-1", health: "atRisk", body: "Sources slow" });

  assert.deepEqual(await l.run("linear_graphql", { query: "query($id: String!) { issue(id: $id) { id } }", variables: { id: "REF-62" } }), { issue: { id: "iss-62", identifier: "REF-62", team: { key: "REF" } } });
});

test("only an OAuth app signs issues and comments with the agent; a personal key writes as its owner", async (t) => {
  const l = await fakeLinear(t);
  const agent = { id: "ag1", name: "Nico", avatarUrl: "https://space.example/avatars/ag1.png?v=3" };
  await l.run("linear_create_issue", { team: "REF", title: "As key" }, KEY, { agent });
  await l.run("linear_comment", { issue: "REF-62", body: "As key" }, KEY, { agent });
  assert.equal(l.last(/issueCreate\(/).variables.input.createAsUser, undefined, "a personal key cannot sign as someone else");
  assert.equal(l.last(/commentCreate\(/).variables.input.createAsUser, undefined);

  const app = { record: { workspace: "refracto", mode: "oauth", account: "Cora" }, agent };
  await l.run("linear_create_issue", { team: "REF", title: "As agent" }, KEY, app);
  assert.deepEqual([l.last(/issueCreate\(/).variables.input.createAsUser, l.last(/issueCreate\(/).variables.input.displayIconUrl], ["Nico", agent.avatarUrl]);
  await l.run("linear_comment", { issue: "REF-62", body: "As agent", reply_to: "c1" }, KEY, app);
  assert.deepEqual(l.last(/commentCreate\(/).variables.input, { issueId: "iss-62", body: "As agent", parentId: "c1", createAsUser: "Nico", displayIconUrl: agent.avatarUrl });
  await l.run("linear_attach", { issue: "REF-62", path: "/home/agent/work/shot.png" }, KEY, app);
  assert.equal(l.last(/commentCreate\(/).variables.input.createAsUser, "Nico", "the comment with a file is signed too");
  await l.run("linear_comment", { issue: "REF-62", body: "No picture" }, KEY, { ...app, agent: { name: "Vera", avatarUrl: "http://127.0.0.1/avatars/v.png" } });
  assert.deepEqual([l.last(/commentCreate\(/).variables.input.createAsUser, l.last(/commentCreate\(/).variables.input.displayIconUrl], ["Vera", undefined], "Linear only takes a public https avatar");
});
