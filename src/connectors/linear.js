import { count, defined, fail, FILE_PARAMS, list, localFile, pick, text } from "./tooling.js";

/**
 * Linear: a personal API key made by the person who connects it (writes carry that
 * person's name), or an OAuth app authorised with actor=app (each issue and comment
 * carries the name and avatar of the agent that wrote it). Authorised agents get
 * one tool per action (linear_create_issue, linear_comment, …); every tool sends its
 * GraphQL with Cora's key and resolves teams, states, labels, people, projects and
 * cycles by name, so an agent never needs the ids first.
 */
const ISSUE = { type: "string", description: "issue identifier such as REF-62, its id or its Linear URL" };
const TEAM = { type: "string", description: "team key such as REF, or its name or id" };
const PERSON = { type: "string", description: "\"me\", an email, a name or a user id; \"none\" unassigns" };
const PRIORITY = { type: ["string", "number"], description: "urgent, high, medium, low, none (or 1-4, 0)" };
const LABELS = { type: "array", items: { type: "string" }, description: "label names or ids" };

const PRIORITIES = { none: 0, "no priority": 0, urgent: 1, high: 2, medium: 3, normal: 3, low: 4 };
const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const HEALTH = { on_track: "onTrack", at_risk: "atRisk", off_track: "offTrack", ontrack: "onTrack", atrisk: "atRisk", offtrack: "offTrack" };

const ISSUE_LIST = "id identifier title url priority priorityLabel dueDate updatedAt state { name type } assignee { name email } team { key } project { name } labels { nodes { name } }";
const ISSUE_FULL = `id identifier title description url priority priorityLabel estimate dueDate createdAt updatedAt completedAt archivedAt
  state { name type } assignee { name email } creator { name } team { key name } project { id name url } cycle { number name }
  labels { nodes { name } } parent { identifier title } children(first: 100) { nodes { identifier title state { name } assignee { name } } }
  relations(first: 50) { nodes { type relatedIssue { identifier title state { name } } } }
  inverseRelations(first: 50) { nodes { type issue { identifier title state { name } } } }
  attachments(first: 50) { nodes { title subtitle url createdAt } }`;
const PROJECT_LIST = "id name url description status { name type } lead { name } startDate targetDate progress teams(first: 10) { nodes { key } }";

/** The Linear GraphQL client a tool works with: Cora's key and the API from api. */
function client({ token, request, api, record, agent }) {
  const authorization = token.startsWith("lin_api_") ? token : `Bearer ${token}`;
  const gql = async (query, variables) => {
    const { status, data } = await request(api.linear, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: { query, variables } });
    if (status === 401 || status === 403) fail("Linear refuses the key: the owner reconnects Linear in Connettori");
    if (data?.errors?.length) fail(`Linear: ${data.errors.map((item) => item.message).join("; ").slice(0, 1500)}`);
    if (status >= 400 || !data?.data) fail(`Linear answered ${status}`);
    return data.data;
  };
  // An app authorised with actor=app writes as itself; Linear then shows the agent's name and avatar on what it creates.
  const signature = record?.mode === "oauth" && agent?.name
    ? defined({ createAsUser: String(agent.name).slice(0, 80), displayIconUrl: /^https:\/\//.test(agent.avatarUrl || "") ? agent.avatarUrl : undefined })
    : {};
  return { gql, authorization, signed: (input) => ({ ...input, ...signature }) };
}

const flat = (value) => {
  if (Array.isArray(value)) return value.map(flat);
  if (value && typeof value === "object") {
    if (Array.isArray(value.nodes) && Object.keys(value).length === 1) return value.nodes.map(flat);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flat(item)]));
  }
  return value;
};

const identifierOf = (value) => {
  const raw = text(value, 400);
  if (!raw) fail("issue is required");
  const fromUrl = raw.match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)/);
  return fromUrl ? fromUrl[1].toUpperCase() : /^[A-Za-z0-9]+-\d+$/.test(raw) ? raw.toUpperCase() : raw;
};

async function teamOf(value, ctx) {
  const wanted = text(value, 200);
  if (!wanted) fail("team is required (its key, e.g. REF)");
  ctx.teams ||= (await ctx.linear.gql("{ teams(first: 250) { nodes { id key name } } }")).teams.nodes;
  const team = ctx.teams.find((item) => item.key.toLowerCase() === wanted.toLowerCase()) || pick(ctx.teams, wanted, { what: "team" });
  if (!team.states) {
    const data = await ctx.linear.gql(`query($id: String!) { team(id: $id) { id key name activeCycle { id number } states { nodes { id name type position } } labels(first: 250) { nodes { id name } } } }`, { id: team.id });
    Object.assign(team, flat(data.team));
  }
  return team;
}

async function stateOf(value, team) {
  const wanted = text(value, 100);
  const byType = STATE_TYPES.includes(wanted.toLowerCase()) && !team.states.some((state) => state.name.toLowerCase() === wanted.toLowerCase())
    ? team.states.filter((state) => state.type === wanted.toLowerCase()).sort((a, b) => a.position - b.position)[0] : null;
  return (byType || pick(team.states, wanted, { what: `state of ${team.key}` })).id;
}

async function labelIds(names, team, ctx) {
  if (!names.length) return [];
  ctx.workspaceLabels ||= flat((await ctx.linear.gql("{ issueLabels(first: 250, filter: { team: { null: true } }) { nodes { id name } } }")).issueLabels);
  const labels = [...team.labels, ...ctx.workspaceLabels];
  return names.map((name) => pick(labels, name, { what: `label of ${team.key}` }).id);
}

async function userOf(value, ctx) {
  const wanted = text(value, 200);
  if (["none", "null", "nobody", "unassigned"].includes(wanted.toLowerCase())) return null;
  if (wanted.toLowerCase() === "me") return (await ctx.linear.gql("{ viewer { id } }")).viewer.id;
  ctx.users ||= flat((await ctx.linear.gql("{ users(first: 250) { nodes { id name displayName email active } } }")).users).filter((user) => user.active !== false);
  const byEmail = ctx.users.find((user) => String(user.email).toLowerCase() === wanted.toLowerCase());
  if (byEmail) return byEmail.id;
  const byDisplay = ctx.users.filter((user) => String(user.displayName).toLowerCase() === wanted.toLowerCase());
  if (byDisplay.length === 1) return byDisplay[0].id;
  return pick(ctx.users, wanted, { what: "user" }).id;
}

async function projectOf(value, ctx) {
  const wanted = text(value, 300);
  if (["none", "null"].includes(wanted.toLowerCase())) return null;
  ctx.projects ||= flat((await ctx.linear.gql("{ projects(first: 250) { nodes { id name slugId } } }")).projects);
  const fromUrl = wanted.match(/linear\.app\/[^/]+\/project\/[^/]*?([0-9a-f]{8,})(?:\/|$)/);
  if (fromUrl) { const found = ctx.projects.find((item) => item.slugId === fromUrl[1]); if (found) return found.id; }
  return pick(ctx.projects, wanted, { what: "project" }).id;
}

async function cycleOf(value, team, ctx) {
  const wanted = text(value, 40).toLowerCase();
  if (["none", "null"].includes(wanted)) return null;
  if (["current", "active"].includes(wanted)) return team.activeCycle?.id || fail(`${team.key} has no active cycle`);
  const cycles = flat((await ctx.linear.gql(`query($id: String!) { team(id: $id) { cycles(first: 100) { nodes { id number name } } } }`, { id: team.id })).team.cycles);
  const found = cycles.find((cycle) => String(cycle.number) === wanted || cycle.id === wanted || String(cycle.name || "").toLowerCase() === wanted);
  return found?.id || fail(`no cycle "${value}" in ${team.key}`);
}

const priorityOf = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 4) return number;
  const named = PRIORITIES[String(value).toLowerCase()];
  return named ?? fail("priority is urgent, high, medium, low or none");
};

const dateOf = (value) => (value === undefined ? undefined : ["none", "null", ""].includes(String(value).toLowerCase()) ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : fail("dates are YYYY-MM-DD"));

/** The fields an issue write takes, resolved against its team. */
async function issueInput(args, team, ctx) {
  return defined({
    title: args.title === undefined ? undefined : text(args.title, 500),
    description: args.description === undefined ? undefined : text(args.description),
    stateId: args.state ? await stateOf(args.state, team) : undefined,
    assigneeId: args.assignee === undefined ? undefined : await userOf(args.assignee, ctx),
    priority: priorityOf(args.priority),
    labelIds: args.labels !== undefined ? await labelIds(list(args.labels), team, ctx) : undefined,
    projectId: args.project === undefined ? undefined : await projectOf(args.project, ctx),
    cycleId: args.cycle === undefined ? undefined : await cycleOf(args.cycle, team, ctx),
    parentId: args.parent === undefined ? undefined : ["none", "null"].includes(String(args.parent).toLowerCase()) ? null : (await ctx.linear.gql("query($id: String!) { issue(id: $id) { id } }", { id: identifierOf(args.parent) })).issue.id,
    dueDate: dateOf(args.due_date),
    estimate: args.estimate === undefined ? undefined : Number(args.estimate),
  });
}

const issueId = async (value, ctx) => (await ctx.linear.gql("query($id: String!) { issue(id: $id) { id identifier team { key } } }", { id: identifierOf(value) })).issue;

const ISSUE_WRITE = {
  title: { type: "string" },
  description: { type: "string", description: "Markdown" },
  state: { type: "string", description: "workflow state name (e.g. In Progress) or type (backlog, unstarted, started, completed, canceled)" },
  assignee: PERSON, priority: PRIORITY, labels: LABELS,
  project: { type: "string", description: "project name, id or URL; \"none\" removes it" },
  cycle: { type: "string", description: "\"current\", a cycle number, or \"none\"" },
  parent: { type: "string", description: "parent issue identifier; \"none\" removes it" },
  due_date: { type: "string", description: "YYYY-MM-DD; \"none\" clears it" },
  estimate: { type: "number" },
};

/** Uploads a file from the agent's computer to Linear's storage: answers the asset URL to use in Markdown. */
async function upload(args, ctx) {
  const file = await localFile(args, ctx);
  const data = await ctx.linear.gql("mutation($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }", { contentType: file.contentType, filename: file.filename, size: file.bytes.length });
  const target = data.fileUpload?.uploadFile;
  if (!target?.uploadUrl) fail("Linear did not give an upload address");
  const headers = { "Content-Type": file.contentType, "Cache-Control": "public, max-age=31536000", ...Object.fromEntries((target.headers || []).map((item) => [item.key, item.value])) };
  const put = await ctx.request(target.uploadUrl, { method: "PUT", headers, raw: file.bytes, timeout: 120000 });
  if (put.status < 200 || put.status >= 300) fail(`the upload to Linear failed (${put.status})`);
  return { ...file, assetUrl: target.assetUrl };
}

const TOOLS = [
  {
    name: "linear_teams",
    description: (record) => `Linear${record.workspace ? `, workspace ${record.workspace}` : ""}${record.mode === "oauth" ? `, through the app ${record.account || "Cora"}: issues and comments you create show your own name and avatar` : record.account ? `, acting as ${record.account}` : ""}. Start here: who the key acts as and every team with its key, workflow states, labels and active cycle. Cora adds the key to every Linear tool; you never see it.`,
    parameters: { type: "object", properties: { team: { type: "string", description: "optional: only this team key" } } },
    async run(args, ctx) {
      // Linear caps a query's complexity: teams with their states, then the labels in a second call.
      const data = await ctx.linear.gql(`{ viewer { id name email organization { name urlKey } } teams(first: 100) { nodes { id key name activeCycle { number name startsAt endsAt } states(first: 50) { nodes { name type position } } } } }`);
      const labels = flat((await ctx.linear.gql("{ issueLabels(first: 250) { nodes { name team { key } } } }")).issueLabels);
      const teams = flat(data.teams).filter((team) => !args.team || team.key.toLowerCase() === String(args.team).toLowerCase())
        .map((team) => ({ ...team, states: team.states.sort((a, b) => a.position - b.position).map(({ name, type }) => ({ name, type })), labels: labels.filter((label) => !label.team || label.team.key === team.key).map((label) => label.name) }));
      return { viewer: data.viewer, teams };
    },
  },
  {
    name: "linear_list_issues",
    description: "Linear: list issues by team, state (default open ones), assignee, project, label, priority, cycle and last change, or search them by text. Newest change first.",
    parameters: { type: "object", properties: {
      text: { type: "string", description: "full-text search in titles, descriptions and comments" },
      team: TEAM, assignee: PERSON,
      state: { type: "string", description: "\"open\" (default), \"all\", \"closed\", a state type or a state name" },
      project: { type: "string" }, label: { type: "string" }, priority: PRIORITY,
      cycle: { type: "string", description: "\"current\" or a cycle number" },
      updated_since: { type: "string", description: "ISO date or date-time" },
      first: { type: "number", description: "default 50, at most 250" },
    } },
    async run(args, ctx) {
      const filter = {};
      if (args.team) filter.team = { key: { eq: (await teamOf(args.team, ctx)).key } };
      const state = text(args.state, 100).toLowerCase() || "open";
      if (state === "open") filter.state = { type: { nin: ["completed", "canceled"] } };
      else if (state === "closed") filter.state = { type: { in: ["completed", "canceled"] } };
      else if (STATE_TYPES.includes(state)) filter.state = { type: { eq: state } };
      else if (state !== "all") filter.state = { name: { eqIgnoreCase: text(args.state, 100) } };
      if (args.assignee) {
        const who = text(args.assignee, 200).toLowerCase();
        filter.assignee = who === "me" ? { isMe: { eq: true } } : ["none", "nobody", "unassigned"].includes(who) ? { null: true } : { id: { eq: await userOf(args.assignee, ctx) } };
      }
      if (args.project) filter.project = { id: { eq: await projectOf(args.project, ctx) } };
      if (args.label) filter.labels = { some: { name: { eqIgnoreCase: text(args.label, 100) } } };
      if (args.priority !== undefined) filter.priority = { eq: priorityOf(args.priority) };
      if (args.cycle) filter.cycle = ["current", "active"].includes(String(args.cycle).toLowerCase()) ? { isActive: { eq: true } } : { number: { eq: Number(args.cycle) } };
      if (args.updated_since) filter.updatedAt = { gte: text(args.updated_since, 40) };
      const first = count(args.first, 50, 250);
      if (args.text) {
        const data = await ctx.linear.gql(`query($term: String!, $filter: IssueFilter, $first: Int) { searchIssues(term: $term, filter: $filter, first: $first) { nodes { ${ISSUE_LIST} } } }`, { term: text(args.text, 300), filter, first });
        return flat(data.searchIssues);
      }
      const data = await ctx.linear.gql(`query($filter: IssueFilter, $first: Int) { issues(filter: $filter, first: $first, orderBy: updatedAt) { nodes { ${ISSUE_LIST} } } }`, { filter, first });
      return flat(data.issues);
    },
  },
  {
    name: "linear_get_issue",
    description: "Linear: one issue whole: description, state, assignee, labels, project, cycle, parent, sub-issues, relations, attachments and comments.",
    parameters: { type: "object", properties: { issue: ISSUE, comments: { type: "boolean", description: "default true" } }, required: ["issue"] },
    async run(args, ctx) {
      const comments = args.comments === false ? "" : "comments(first: 100) { nodes { id body createdAt user { name } parent { id } } }";
      const data = await ctx.linear.gql(`query($id: String!) { issue(id: $id) { ${ISSUE_FULL} ${comments} } }`, { id: identifierOf(args.issue) });
      const issue = flat(data.issue);
      if (issue.comments) issue.comments = issue.comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(({ id, body, createdAt, user, parent }) => defined({ id, by: user?.name, createdAt, body, reply_to: parent?.id }));
      issue.labels = (issue.labels || []).map((label) => label.name);
      return issue;
    },
  },
  {
    name: "linear_list_projects",
    description: "Linear: projects with status, lead, dates, progress and teams; filter by team, name or status.",
    parameters: { type: "object", properties: { team: TEAM, query: { type: "string", description: "keep only names containing this" }, status: { type: "string", description: "e.g. planned, started, completed, canceled, backlog" }, first: { type: "number", description: "default 50, at most 250" } } },
    async run(args, ctx) {
      const filter = {};
      if (args.team) filter.accessibleTeams = { some: { key: { eq: (await teamOf(args.team, ctx)).key } } };
      if (args.query) filter.name = { containsIgnoreCase: text(args.query, 200) };
      if (args.status) filter.status = { type: { eq: text(args.status, 40).toLowerCase() } };
      const data = await ctx.linear.gql(`query($filter: ProjectFilter, $first: Int) { projects(filter: $filter, first: $first, orderBy: updatedAt) { nodes { ${PROJECT_LIST} } } }`, { filter, first: count(args.first, 50, 250) });
      return flat(data.projects).map((project) => ({ ...project, description: project.description ? String(project.description).slice(0, 300) : undefined, teams: project.teams.map((team) => team.key) }));
    },
  },
  {
    name: "linear_get_project",
    description: "Linear: one project with its full description, status, lead, members, milestones, latest project updates and open issues.",
    parameters: { type: "object", properties: { project: { type: "string", description: "project name, id or URL" } }, required: ["project"] },
    async run(args, ctx) {
      const id = await projectOf(args.project, ctx);
      const data = await ctx.linear.gql(`query($id: String!) { project(id: $id) { ${PROJECT_LIST} content health members(first: 50) { nodes { name } }
        projectMilestones(first: 50) { nodes { name targetDate } }
        projectUpdates(first: 5) { nodes { body health createdAt user { name } } }
        issues(first: 100, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { identifier title state { name } assignee { name } } } } }`, { id });
      const project = flat(data.project);
      return { ...project, teams: project.teams.map((team) => team.key), members: project.members.map((member) => member.name) };
    },
  },
  {
    name: "linear_list_users",
    description: "Linear: people of the workspace with name, display name and email, to assign issues.",
    parameters: { type: "object", properties: { query: { type: "string", description: "keep only names or emails containing this" } } },
    async run(args, ctx) {
      const users = flat((await ctx.linear.gql("{ users(first: 250) { nodes { id name displayName email active } } }")).users);
      const needle = text(args.query, 200).toLowerCase();
      return users.filter((user) => !needle || `${user.name} ${user.displayName} ${user.email}`.toLowerCase().includes(needle));
    },
  },
  {
    name: "linear_create_issue",
    write: true,
    description: "Linear: create an issue in a team, with Markdown description and state, assignee, priority, labels, project, cycle, parent, due date and estimate by name. Answers its identifier and URL.",
    parameters: { type: "object", properties: { team: TEAM, ...ISSUE_WRITE }, required: ["team", "title"] },
    async run(args, ctx) {
      if (!text(args.title)) fail("title is required");
      const team = await teamOf(args.team, ctx);
      const input = ctx.linear.signed({ teamId: team.id, ...await issueInput(args, team, ctx) });
      const data = await ctx.linear.gql(`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_LIST} } } }`, { input });
      if (!data.issueCreate?.success) fail("Linear did not create the issue");
      return flat(data.issueCreate.issue);
    },
  },
  {
    name: "linear_update_issue",
    write: true,
    description: "Linear: change an issue: title, description, state, assignee, priority, labels (replace, or add_labels / remove_labels), project, cycle, parent, due date, estimate, or move it to another team.",
    parameters: { type: "object", properties: { issue: ISSUE, ...ISSUE_WRITE, add_labels: LABELS, remove_labels: LABELS, team: { type: "string", description: "move it to this team" } }, required: ["issue"] },
    async run(args, ctx) {
      const found = await issueId(args.issue, ctx);
      const team = await teamOf(args.team || found.team.key, ctx);
      const input = await issueInput(args, team, ctx);
      if (args.team) input.teamId = team.id;
      if (list(args.add_labels).length) input.addedLabelIds = await labelIds(list(args.add_labels), team, ctx);
      if (list(args.remove_labels).length) input.removedLabelIds = await labelIds(list(args.remove_labels), team, ctx);
      if (!Object.keys(input).length) fail("name something to change");
      const data = await ctx.linear.gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_LIST} } } }`, { id: found.id, input });
      if (!data.issueUpdate?.success) fail("Linear did not update the issue");
      return flat(data.issueUpdate.issue);
    },
  },
  {
    name: "linear_comment",
    write: true,
    description: (record) => `Linear: add a Markdown comment to an issue, or a reply to one of its comments. ${record?.mode === "oauth" ? "It shows your name and avatar (via the Cora app)." : "It carries the connected account's name."}`,
    parameters: { type: "object", properties: { issue: ISSUE, body: { type: "string", description: "Markdown" }, reply_to: { type: "string", description: "optional comment id to answer" } }, required: ["issue", "body"] },
    async run(args, ctx) {
      const found = await issueId(args.issue, ctx);
      const input = ctx.linear.signed(defined({ issueId: found.id, body: text(args.body) || fail("body is required"), parentId: args.reply_to ? text(args.reply_to, 100) : undefined }));
      const data = await ctx.linear.gql("mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url createdAt user { name } } } }", { input });
      if (!data.commentCreate?.success) fail("Linear did not add the comment");
      return { issue: found.identifier, ...flat(data.commentCreate.comment) };
    },
  },
  {
    name: "linear_attach",
    write: true,
    description: "Linear: attach a link to an issue (url + title), or upload a file from your computer (path, e.g. a screenshot) and post it in a comment on the issue (images show inline); with no issue it only uploads and answers the asset URL for Markdown.",
    parameters: { type: "object", properties: {
      issue: ISSUE, url: { type: "string", description: "a link to attach instead of a file" }, title: { type: "string" },
      ...FILE_PARAMS,
      comment: { type: "string", description: "optional Markdown that goes with the uploaded file in the comment" },
    } },
    summarize: (args) => `${args.issue ? `issue ${String(args.issue)} · ` : ""}${String(args.url || args.path || "").slice(0, 120)}`,
    async run(args, ctx) {
      if (args.url) {
        const found = await issueId(args.issue || fail("a link needs the issue"), ctx);
        const url = text(args.url, 2000);
        if (!/^https?:\/\//i.test(url)) fail("url is an http(s) link");
        const data = await ctx.linear.gql("mutation($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success attachment { id title url } } }", { issueId: found.id, url, title: text(args.title, 300) || undefined });
        if (!data.attachmentLinkURL?.success) fail("Linear did not attach the link");
        return { issue: found.identifier, ...data.attachmentLinkURL.attachment };
      }
      const file = await upload(args, ctx);
      const markdown = `${file.contentType.startsWith("image/") ? "!" : ""}[${file.filename.replace(/[[\]]/g, "")}](${file.assetUrl})`;
      if (!args.issue) return { filename: file.filename, assetUrl: file.assetUrl, markdown };
      const found = await issueId(args.issue, ctx);
      const body = [text(args.comment), markdown].filter(Boolean).join("\n\n");
      const data = await ctx.linear.gql("mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }", { input: ctx.linear.signed({ issueId: found.id, body }) });
      if (!data.commentCreate?.success) fail("Linear did not add the comment with the file");
      return { issue: found.identifier, filename: file.filename, assetUrl: file.assetUrl, comment: data.commentCreate.comment };
    },
  },
  {
    name: "linear_relate_issues",
    write: true,
    description: "Linear: relate two issues: issue blocks / is blocked by / relates to / duplicates the other.",
    parameters: { type: "object", properties: { issue: ISSUE, relation: { type: "string", enum: ["blocks", "blocked_by", "related", "duplicate_of"] }, other: ISSUE }, required: ["issue", "relation", "other"] },
    async run(args, ctx) {
      const types = { blocks: "blocks", blocked_by: "blocks", related: "related", duplicate_of: "duplicate" };
      if (!types[args.relation]) fail("relation is blocks, blocked_by, related or duplicate_of");
      const [one, two] = [await issueId(args.issue, ctx), await issueId(args.other, ctx)];
      const [from, to] = args.relation === "blocked_by" ? [two, one] : [one, two];
      const data = await ctx.linear.gql("mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { id type } } }", { input: { issueId: from.id, relatedIssueId: to.id, type: types[args.relation] } });
      if (!data.issueRelationCreate?.success) fail("Linear did not relate the issues");
      return { issue: from.identifier, type: data.issueRelationCreate.issueRelation.type, related: to.identifier, id: data.issueRelationCreate.issueRelation.id };
    },
  },
  {
    name: "linear_delete_issue",
    write: true,
    description: "Linear: archive an issue (default), or delete it (to the trash, restorable for 30 days). Only when asked.",
    parameters: { type: "object", properties: { issue: ISSUE, mode: { type: "string", enum: ["archive", "delete"], description: "default archive" } }, required: ["issue"] },
    async run(args, ctx) {
      const found = await issueId(args.issue, ctx);
      const mutation = args.mode === "delete" ? "issueDelete" : "issueArchive";
      const data = await ctx.linear.gql(`mutation($id: String!) { ${mutation}(id: $id) { success } }`, { id: found.id });
      if (!data[mutation]?.success) fail(`Linear did not ${args.mode === "delete" ? "delete" : "archive"} the issue`);
      return { [args.mode === "delete" ? "deleted" : "archived"]: found.identifier };
    },
  },
  {
    name: "linear_create_project",
    write: true,
    description: "Linear: create a project for one or more teams, with Markdown description, lead, start and target dates.",
    parameters: { type: "object", properties: { name: { type: "string" }, teams: { type: "array", items: { type: "string" }, description: "team keys" }, description: { type: "string", description: "Markdown" }, lead: PERSON, start_date: { type: "string" }, target_date: { type: "string" } }, required: ["name", "teams"] },
    async run(args, ctx) {
      const teams = list(args.teams);
      if (!teams.length) fail("teams is required");
      const input = defined({ name: text(args.name, 200) || fail("name is required"), teamIds: await Promise.all(teams.map(async (key) => (await teamOf(key, ctx)).id)), content: args.description === undefined ? undefined : text(args.description), leadId: args.lead ? await userOf(args.lead, ctx) : undefined, startDate: dateOf(args.start_date), targetDate: dateOf(args.target_date) });
      const data = await ctx.linear.gql("mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { id name url } } }", { input });
      if (!data.projectCreate?.success) fail("Linear did not create the project");
      delete ctx.projects;
      return data.projectCreate.project;
    },
  },
  {
    name: "linear_update_project",
    write: true,
    description: "Linear: change a project: name, description, lead, dates or status (by name, e.g. Started, Completed).",
    parameters: { type: "object", properties: { project: { type: "string" }, name: { type: "string" }, description: { type: "string" }, lead: PERSON, start_date: { type: "string" }, target_date: { type: "string" }, status: { type: "string" } }, required: ["project"] },
    async run(args, ctx) {
      const id = await projectOf(args.project, ctx);
      let statusId;
      if (args.status) {
        const statuses = flat((await ctx.linear.gql("{ projectStatuses(first: 50) { nodes { id name type } } }")).projectStatuses);
        statusId = (statuses.find((item) => item.type === String(args.status).toLowerCase()) || pick(statuses, args.status, { what: "project status" })).id;
      }
      const input = defined({ name: args.name === undefined ? undefined : text(args.name, 200), content: args.description === undefined ? undefined : text(args.description), leadId: args.lead === undefined ? undefined : await userOf(args.lead, ctx), startDate: dateOf(args.start_date), targetDate: dateOf(args.target_date), statusId });
      if (!Object.keys(input).length) fail("name something to change");
      const data = await ctx.linear.gql("mutation($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { success project { id name url status { name } lead { name } startDate targetDate } } }", { id, input });
      if (!data.projectUpdate?.success) fail("Linear did not update the project");
      return flat(data.projectUpdate.project);
    },
  },
  {
    name: "linear_post_project_update",
    write: true,
    description: "Linear: post a project update with its health (on_track, at_risk, off_track) and a Markdown body.",
    parameters: { type: "object", properties: { project: { type: "string" }, health: { type: "string", enum: ["on_track", "at_risk", "off_track"] }, body: { type: "string", description: "Markdown" } }, required: ["project", "health", "body"] },
    async run(args, ctx) {
      const health = HEALTH[String(args.health || "").toLowerCase()] || fail("health is on_track, at_risk or off_track");
      const data = await ctx.linear.gql("mutation($input: ProjectUpdateCreateInput!) { projectUpdateCreate(input: $input) { success projectUpdate { id url health createdAt } } }", { input: { projectId: await projectOf(args.project, ctx), health, body: text(args.body) || fail("body is required") } });
      if (!data.projectUpdateCreate?.success) fail("Linear did not post the update");
      return data.projectUpdateCreate.projectUpdate;
    },
  },
  {
    name: "linear_graphql",
    write: true,
    description: "Linear fallback, only for what the other linear_ tools do not cover: one GraphQL query or mutation with optional variables; ask only for the fields you need.",
    parameters: { type: "object", properties: { query: { type: "string" }, variables: { type: "object" } }, required: ["query"] },
    summarize: (args) => String(args.query || "").replace(/\s+/g, " ").slice(0, 200),
    async run(args, ctx) {
      const query = text(args.query) || fail("write the GraphQL query or mutation in query");
      const variables = args.variables && typeof args.variables === "object" && !Array.isArray(args.variables) ? args.variables : undefined;
      const { status, data } = await ctx.request(ctx.api.linear, { method: "POST", headers: { Authorization: ctx.linear.authorization, "Content-Type": "application/json" }, body: { query, variables } });
      if (status === 401 || status === 403) fail("Linear refuses the key: the owner reconnects Linear in Connettori");
      if (data?.errors?.length && !data?.data) fail(`Linear: ${data.errors.map((item) => item.message).join("; ").slice(0, 1500)}`);
      if (status >= 400) fail(`Linear answered ${status}`);
      return data?.errors?.length ? { data: data.data, errors: data.errors.map((item) => item.message) } : data?.data ?? null;
    },
  },
];

export const linear = {
  id: "linear",
  name: "Linear",
  secret: "CORA_LINEAR_KEY",
  appSecrets: ["CORA_LINEAR_CLIENT_ID", "CORA_LINEAR_CLIENT_SECRET"],
  label: "workspace",
  oauth: {
    authorize: "https://linear.app/oauth/authorize",
    token: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    scopeSeparator: ",",
    params: { actor: "app", prompt: "consent" },
    clientAuth: "body",
    async identify({ access, request, api }) {
      const { data } = await request(api.linear, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: { query: "query { viewer { name } organization { id name urlKey } }" } });
      if (!data?.data?.organization?.urlKey) fail("Linear did not confirm the workspace");
      return { workspace: String(data.data.organization.urlKey).slice(0, 80), ...(data.data.organization.id ? { workspaceId: String(data.data.organization.id) } : {}), account: String(data.data.viewer?.name || "").slice(0, 120) };
    },
  },
  card: {
    icon: "list",
    description: "Collega più workspace e scegli gli agenti autorizzati per ciascuno.",
    meta: "Linear · Issue e progetti",
    writes: {
      oauth: "Issue e commenti mostrano nome e avatar dell'agente che li scrive, tramite l'app.",
      key: "Issue e commenti risultano scritti dalla persona che ha creato la chiave.",
    },
    intro: "Collega più workspace e scegli gli agenti autorizzati per ciascuno. La chiave resta nella cassaforte, mai nel pannello.",
    modes: [{
      id: "key",
      label: "Chiave personale",
      intro: "Con la chiave personale issue e commenti degli agenti risultano scritti da te, la persona che ha creato la chiave.",
      notice: "Servono due dati, che si trovano in Linear: il workspace e una chiave API personale.",
      body: { mode: "key" },
      rows: [
        { title: "1. Il workspace", hint: "Il nome che compare in linear.app/<workspace>, per esempio turinglabs.", field: { name: "workspace", type: "text", placeholder: "turinglabs", label: "Workspace di Linear" } },
        { title: "2. La chiave API", steps: [
          ["apri ", { href: "https://linear.app/settings/security", text: "linear.app/settings/security" }, " → Sicurezza → Chiavi API e crea una chiave personale;"],
          "copia la chiave;",
          ["incollala qui: Cora la verifica su Linear e la salva separatamente nella cassaforte (prefisso ", { code: "CORA_LINEAR_KEY" }, "), senza mostrarla più."],
        ], field: { name: "token", type: "password", label: "Chiave API di Linear" }, submit: "Verifica e collega" },
        { title: "3. Gli agenti", hint: "Dopo il collegamento scegli quali agenti possono usare la chiave.", note: "Il passo si sblocca appena il workspace è collegato." },
      ],
    }, {
      id: "oauth",
      label: "App OAuth",
      ready: "app",
      intro: "Con un'app OAuth Linear ogni issue e ogni commento mostra nome e avatar dell'agente che l'ha scritto (per esempio «Nico (via Cora)»), senza occupare posti nel workspace.",
      notice: "Ogni collegamento ha la propria app OAuth, i propri token e agenti autorizzati. Puoi usare app diverse per workspace diversi.",
      body: { mode: "oauth" },
      rows: [
        { title: "Il workspace (facoltativo)", hint: "Scrivi il nome in linear.app/<workspace> per riconoscere questo collegamento prima di autorizzarlo. Cora verifica che corrisponda.", field: { name: "workspace", type: "text", placeholder: "turinglabs", label: "Workspace atteso di Linear" } },
        { title: "L'app Linear", steps: [
          ["apri ", { href: "https://linear.app/settings/api/applications/new", text: "Linear → Settings → API → OAuth applications" }, " e crea una nuova app (nome e icona sono quelli dell'app, per esempio Cora);"],
          ["in Callback URLs aggiungi l'indirizzo di ritorno di Cora mostrato qui sotto, ", { code: "…/connectors/oauth/linear/callback" }, ";"],
          ["copia client ID e client secret e incollali qui: finiscono nella cassaforte con nomi separati per collegamento (prefissi ", { code: "CORA_LINEAR_CLIENT_ID" }, " e ", { code: "CORA_LINEAR_CLIENT_SECRET" }, ");"],
          "poi premi «Autorizza Linear»: serve un amministratore del workspace, perché l'app si installa come app del workspace.",
        ], fields: [
          { name: "clientId", type: "text", title: "Client ID", label: "Client ID dell'app Linear" },
          { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret dell'app Linear" },
        ], submit: "Salva l'app" },
      ],
    }],
  },
  tools: TOOLS,
  context(ctx) { return { ...ctx, linear: client(ctx) }; },
};
