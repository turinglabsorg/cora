import { count, defined, fail, FILE_PARAMS, list, localFile, pick, text } from "./tooling.js";

/**
 * Asana: a personal access token or an OAuth app. Authorised agents get one tool per
 * action (asana_create_task, asana_comment, …); every tool takes the key from Cora,
 * resolves names to gids itself and answers only the fields an agent needs.
 */
const WORKSPACE = { type: "string", description: "workspace gid; default the connected one" };
const TASK = { type: "string", description: "task gid or its Asana URL" };
const PROJECT = { type: "string", description: "project gid or exact name" };
const SECTION = { type: "string", description: "section gid, or its name inside the project" };
const PERSON = { type: "string", description: "\"me\", an email or a user gid" };
const DATE = { type: "string", description: "YYYY-MM-DD; \"none\" clears it" };

const TASK_LIST = "name,completed,assignee.name,due_on,due_at,permalink_url,memberships.project.name,memberships.section.name";
const TASK_FULL = "name,notes,completed,completed_at,assignee.name,assignee.email,due_on,due_at,start_on,created_at,created_by.name,modified_at,permalink_url,parent.name,memberships.project.name,memberships.section.name,tags.name,followers.name,custom_fields.name,custom_fields.display_value,num_subtasks,dependencies.name";
const PROJECT_FIELDS = "name,notes,archived,color,team.name,owner.name,due_on,start_on,permalink_url,created_at,current_status_update.title,current_status_update.status_type,current_status_update.created_at,members.name,custom_field_settings.custom_field.name,custom_field_settings.custom_field.resource_subtype,custom_field_settings.custom_field.enum_options.name";

const STATUS = ["on_track", "at_risk", "off_track", "on_hold", "complete"];
const COLORS = ["dark-pink", "dark-green", "dark-blue", "dark-red", "dark-teal", "dark-brown", "dark-orange", "dark-purple", "dark-warm-gray", "light-pink", "light-green", "light-blue", "light-red", "light-teal", "light-brown", "light-orange", "light-purple", "light-warm-gray", "none"];

/** The Asana REST client a tool works with: Cora's key, the host from api, bodies wrapped in {data}. */
function client({ token, request, api }) {
  const call = async (method, path, { query = {}, body, raw } = {}) => {
    const url = new URL(`${api.asana}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    const headers = { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
    const { status, data } = await request(url.href, { method, headers, body: body === undefined ? undefined : { data: body }, raw });
    if (status === 401) fail("Asana refuses the token: the owner reconnects Asana in Connettori");
    if (status === 402) fail("this needs a paid Asana plan on the workspace");
    if (status >= 400) fail(`Asana answered ${status}${data?.errors?.length ? `: ${data.errors.map((item) => item.message).join("; ").slice(0, 1500)}` : ""}`);
    return data ?? {};
  };
  /** Follows Asana's offset pages until `max` items. */
  const all = async (path, query = {}, max = 100) => {
    const items = [];
    let offset;
    do {
      const page = await call("GET", path, { query: { ...query, limit: Math.min(100, max - items.length), offset } });
      items.push(...(page.data || []));
      offset = page.next_page?.offset;
    } while (offset && items.length < max);
    return items;
  };
  return { call, all };
}

const gidOf = (value, what) => {
  const raw = text(value, 400);
  if (!raw) fail(`${what} is required`);
  if (/^\d+$/.test(raw)) return raw;
  const fromUrl = raw.match(/\/task\/(\d+)/) || raw.match(/\/(\d+)(?:\/f)?\/?(?:[?#].*)?$/);
  if (fromUrl) return fromUrl[1];
  fail(`${what} is a gid (digits) or an Asana URL`);
};

const workspaceOf = async (args, ctx) => {
  if (args.workspace) return /^\w+$/.test(String(args.workspace).trim()) ? String(args.workspace).trim() : gidOf(args.workspace, "workspace");
  if (ctx.record.workspaceId) return ctx.record.workspaceId;
  const me = await ctx.asana.call("GET", "/users/me", { query: { opt_fields: "workspaces.name" } });
  return me.data?.workspaces?.[0]?.gid || fail("no workspace: name one");
};

async function projectOf(value, args, ctx) {
  const wanted = text(value, 300);
  if (/^\d+$/.test(wanted)) return wanted;
  const fromUrl = wanted.match(/\/project\/(\d+)/) || wanted.match(/app\.asana\.com\/0\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  const projects = await ctx.asana.all("/projects", { workspace: await workspaceOf(args, ctx), archived: false, opt_fields: "name" }, 1000);
  return pick(projects, wanted, { what: "project", id: "gid" }).gid;
}

async function sectionOf(value, project, ctx) {
  const wanted = text(value, 300);
  if (/^\d+$/.test(wanted)) return wanted;
  if (!project) fail("a section by name needs its project");
  const sections = await ctx.asana.all(`/projects/${project}/sections`, { opt_fields: "name" });
  return pick(sections, wanted, { what: "section", id: "gid" }).gid;
}

const person = (value) => {
  const raw = text(value, 200);
  if (!raw) return undefined;
  if (["none", "null", "nobody", "unassigned"].includes(raw.toLowerCase())) return null;
  return raw;
};

const date = (value) => (value === undefined ? undefined : ["none", "null", ""].includes(String(value).toLowerCase()) ? null : text(value, 40));

async function tagGids(names, args, ctx) {
  if (!names.length) return [];
  const tags = await ctx.asana.all(`/workspaces/${await workspaceOf(args, ctx)}/tags`, { opt_fields: "name" }, 1000);
  return names.map((name) => (/^\d+$/.test(name) ? name : pick(tags, name, { what: "tag", id: "gid" }).gid));
}

/** Custom fields by name or gid; enum and multi-enum values by option name. */
async function customFields(values, settings) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
  const fields = settings.map((item) => item.custom_field || item).filter(Boolean);
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const field = /^\d+$/.test(key) ? fields.find((item) => item.gid === key) || { gid: key } : pick(fields, key, { what: "custom field", id: "gid" });
    const options = field.enum_options || [];
    const option = (wanted) => (/^\d+$/.test(String(wanted)) ? String(wanted) : pick(options, wanted, { what: `option of ${field.name}`, id: "gid" }).gid);
    if (value === null || value === "none") out[field.gid] = null;
    else if (field.resource_subtype === "enum") out[field.gid] = option(value);
    else if (field.resource_subtype === "multi_enum") out[field.gid] = list(value).map(option);
    else out[field.gid] = value;
  }
  return out;
}

const FIELD_SETTINGS = "custom_field.name,custom_field.resource_subtype,custom_field.enum_options.name";

async function taskFieldSettings(task, ctx) {
  const found = await ctx.asana.call("GET", `/tasks/${task}`, { query: { opt_fields: "custom_fields.name,custom_fields.resource_subtype,custom_fields.enum_options.name" } });
  return found.data?.custom_fields || [];
}

const read = async (ctx, task, fields = TASK_FULL) => (await ctx.asana.call("GET", `/tasks/${task}`, { query: { opt_fields: fields } })).data;

const TASK_WRITE = {
  name: { type: "string" },
  notes: { type: "string", description: "plain-text description" },
  html_notes: { type: "string", description: "rich description, wrapped in <body>…</body>" },
  assignee: PERSON,
  due_on: DATE,
  due_at: { type: "string", description: "ISO date-time, instead of due_on" },
  start_on: DATE,
  custom_fields: { type: "object", description: "field name or gid → value (option name for dropdowns, a list for multi-select)" },
};

const TOOLS = [
  {
    name: "asana_workspaces",
    description: (record) => `Asana${record.workspace ? `, workspace ${record.workspace}${record.workspaceId ? ` (gid ${record.workspaceId})` : ""}` : ""}${record.account ? `, acting as ${record.account}` : ""}. Start here: the connected user, the workspaces and their teams. Cora adds the token to every Asana tool; you never see it.`,
    parameters: { type: "object", properties: {} },
    async run(args, ctx) {
      const me = (await ctx.asana.call("GET", "/users/me", { query: { opt_fields: "name,email,workspaces.name,workspaces.is_organization" } })).data || {};
      const workspaces = [];
      for (const workspace of me.workspaces || []) {
        const teams = workspace.is_organization ? await ctx.asana.all(`/workspaces/${workspace.gid}/teams`, { opt_fields: "name" }, 200).catch(() => []) : [];
        workspaces.push({ gid: workspace.gid, name: workspace.name, organization: Boolean(workspace.is_organization), teams: teams.map(({ gid, name }) => ({ gid, name })), default: workspace.gid === ctx.record.workspaceId || undefined });
      }
      return { me: { gid: me.gid, name: me.name, email: me.email }, workspaces };
    },
  },
  {
    name: "asana_list_projects",
    description: "Asana: list projects of the workspace or of one team, with team, owner, due date, status and URL.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, team: { type: "string", description: "team gid or name" }, archived: { type: "boolean", description: "true lists archived ones; default false" }, query: { type: "string", description: "keep only projects whose name contains this" }, limit: { type: "number", description: "default 100, at most 500" } } },
    async run(args, ctx) {
      const fields = "name,archived,team.name,owner.name,due_on,permalink_url,current_status_update.status_type";
      const max = count(args.limit, 100, 500);
      let projects;
      if (args.team) {
        const workspace = await workspaceOf(args, ctx);
        const team = /^\d+$/.test(String(args.team)) ? String(args.team) : pick(await ctx.asana.all(`/workspaces/${workspace}/teams`, { opt_fields: "name" }, 500), args.team, { what: "team", id: "gid" }).gid;
        projects = await ctx.asana.all(`/teams/${team}/projects`, { archived: args.archived === true, opt_fields: fields }, args.query ? 1000 : max);
      } else projects = await ctx.asana.all("/projects", { workspace: await workspaceOf(args, ctx), archived: args.archived === true, opt_fields: fields }, args.query ? 1000 : max);
      const needle = text(args.query, 200).toLowerCase();
      return (needle ? projects.filter((item) => String(item.name).toLowerCase().includes(needle)) : projects).slice(0, max);
    },
  },
  {
    name: "asana_get_project",
    description: "Asana: one project with notes, team, owner, members, latest status update, custom fields (with dropdown options) and its sections.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE }, required: ["project"] },
    async run(args, ctx) {
      const project = await projectOf(args.project, args, ctx);
      const data = (await ctx.asana.call("GET", `/projects/${project}`, { query: { opt_fields: PROJECT_FIELDS } })).data;
      const sections = await ctx.asana.all(`/projects/${project}/sections`, { opt_fields: "name" }, 200);
      return { ...data, sections: sections.map(({ gid, name }) => ({ gid, name })) };
    },
  },
  {
    name: "asana_list_tasks",
    description: "Asana: tasks of a project, of one section, or assigned to a person (\"me\" = your My Tasks). Default only open tasks.",
    parameters: { type: "object", properties: { project: PROJECT, section: SECTION, assignee: PERSON, workspace: WORKSPACE, status: { type: "string", enum: ["open", "completed", "all"], description: "default open" }, limit: { type: "number", description: "default 50, at most 500" } } },
    async run(args, ctx) {
      const status = ["open", "completed", "all"].includes(args.status) ? args.status : "open";
      const max = count(args.limit, 50, 500);
      const query = { opt_fields: TASK_LIST, ...(status === "open" ? { completed_since: "now" } : {}) };
      let tasks;
      if (args.section) {
        const project = args.project ? await projectOf(args.project, args, ctx) : "";
        tasks = await ctx.asana.all(`/sections/${await sectionOf(args.section, project, ctx)}/tasks`, query, status === "completed" ? 1000 : max);
      } else if (args.project) tasks = await ctx.asana.all("/tasks", { ...query, project: await projectOf(args.project, args, ctx) }, status === "completed" ? 1000 : max);
      else if (args.assignee) tasks = await ctx.asana.all("/tasks", { ...query, assignee: text(args.assignee, 200), workspace: await workspaceOf(args, ctx) }, status === "completed" ? 1000 : max);
      else fail("name a project, a section or an assignee");
      return (status === "completed" ? tasks.filter((task) => task.completed) : tasks).slice(0, max);
    },
  },
  {
    name: "asana_search_tasks",
    description: "Asana: search tasks in the workspace by text and filters (assignee, project, completed, due dates, last change). Needs a paid workspace.",
    parameters: { type: "object", properties: {
      text: { type: "string", description: "words in the name or description" },
      assignee: PERSON, project: PROJECT, workspace: WORKSPACE,
      completed: { type: "boolean", description: "true only completed, false only open; leave out for both" },
      due_before: { type: "string", description: "YYYY-MM-DD" }, due_after: { type: "string", description: "YYYY-MM-DD" },
      modified_after: { type: "string", description: "ISO date-time" },
      sort_by: { type: "string", enum: ["modified_at", "due_date", "created_at", "completed_at", "likes"], description: "default modified_at" },
      limit: { type: "number", description: "default 25, at most 100" },
    } },
    async run(args, ctx) {
      const workspace = await workspaceOf(args, ctx);
      const query = defined({
        text: text(args.text, 300) || undefined,
        "assignee.any": args.assignee ? text(args.assignee, 200) : undefined,
        "projects.any": args.project ? await projectOf(args.project, args, ctx) : undefined,
        completed: typeof args.completed === "boolean" ? args.completed : undefined,
        "due_on.before": text(args.due_before, 20) || undefined,
        "due_on.after": text(args.due_after, 20) || undefined,
        "modified_at.after": text(args.modified_after, 40) || undefined,
        sort_by: args.sort_by || undefined,
        limit: count(args.limit, 25, 100),
        opt_fields: TASK_LIST,
      });
      return (await ctx.asana.call("GET", `/workspaces/${workspace}/tasks/search`, { query })).data || [];
    },
  },
  {
    name: "asana_get_task",
    description: "Asana: one task whole: description, assignee, dates, projects and sections, tags, custom fields, subtasks, comments and attachments.",
    parameters: { type: "object", properties: { task: TASK, comments: { type: "boolean", description: "default true" }, attachments: { type: "boolean", description: "default true" } }, required: ["task"] },
    async run(args, ctx) {
      const task = gidOf(args.task, "task");
      const data = await read(ctx, task);
      const subtasks = data.num_subtasks ? await ctx.asana.all(`/tasks/${task}/subtasks`, { opt_fields: "name,completed,assignee.name,due_on" }, 200) : [];
      const comments = args.comments === false ? undefined : (await ctx.asana.all(`/tasks/${task}/stories`, { opt_fields: "created_at,created_by.name,text,resource_subtype" }, 300))
        .filter((story) => story.resource_subtype === "comment_added").map(({ gid, created_at, created_by, text: body }) => ({ gid, created_at, by: created_by?.name, text: body }));
      const attachments = args.attachments === false ? undefined : (await ctx.asana.all("/attachments", { parent: task, opt_fields: "name,host,view_url,permanent_url,created_at" }, 100)).map(({ resource_type, ...item }) => item);
      return defined({ ...data, subtasks, comments, attachments });
    },
  },
  {
    name: "asana_list_users",
    description: "Asana: people of the workspace with gid and email, to assign tasks or add followers.",
    parameters: { type: "object", properties: { workspace: WORKSPACE, query: { type: "string", description: "keep only names or emails containing this" } } },
    async run(args, ctx) {
      const users = await ctx.asana.all(`/workspaces/${await workspaceOf(args, ctx)}/users`, { opt_fields: "name,email" }, 2000);
      const needle = text(args.query, 200).toLowerCase();
      return users.filter((user) => !needle || `${user.name} ${user.email}`.toLowerCase().includes(needle)).map(({ gid, name, email }) => ({ gid, name, email }));
    },
  },
  {
    name: "asana_create_task",
    write: true,
    description: "Asana: create a task (or a subtask with parent) in a project and section, with assignee, dates, followers, tags and custom fields. Answers the task and its URL.",
    parameters: { type: "object", properties: {
      ...TASK_WRITE, project: PROJECT, section: SECTION, workspace: WORKSPACE,
      parent: { type: "string", description: "parent task gid or URL: creates a subtask" },
      followers: { type: "array", items: { type: "string" }, description: "\"me\", emails or user gids" },
      tags: { type: "array", items: { type: "string" }, description: "tag names or gids" },
    }, required: ["name"] },
    async run(args, ctx) {
      const name = text(args.name, 1000) || fail("name is required");
      const project = args.project ? await projectOf(args.project, args, ctx) : "";
      const section = args.section ? await sectionOf(args.section, project, ctx) : "";
      const settings = args.custom_fields && project ? (await ctx.asana.call("GET", `/projects/${project}/custom_field_settings`, { query: { opt_fields: FIELD_SETTINGS } })).data || [] : [];
      const body = defined({
        name, notes: args.notes === undefined ? undefined : text(args.notes), html_notes: args.html_notes === undefined ? undefined : text(args.html_notes),
        assignee: person(args.assignee), due_on: date(args.due_on), due_at: date(args.due_at), start_on: date(args.start_on),
        followers: list(args.followers).length ? list(args.followers) : undefined,
        tags: list(args.tags).length ? await tagGids(list(args.tags), args, ctx) : undefined,
        custom_fields: await customFields(args.custom_fields, settings),
      });
      let created;
      if (args.parent) created = (await ctx.asana.call("POST", `/tasks/${gidOf(args.parent, "parent")}/subtasks`, { body })).data;
      else {
        if (project) body.projects = [project];
        else body.workspace = await workspaceOf(args, ctx);
        created = (await ctx.asana.call("POST", "/tasks", { body })).data;
      }
      if (args.parent && project) await ctx.asana.call("POST", `/tasks/${created.gid}/addProject`, { body: defined({ project, section: section || undefined }) });
      else if (section) await ctx.asana.call("POST", `/sections/${section}/addTask`, { body: { task: created.gid } });
      return read(ctx, created.gid, TASK_LIST);
    },
  },
  {
    name: "asana_update_task",
    write: true,
    description: "Asana: change a task: name, description, assignee (\"none\" unassigns), dates (\"none\" clears), completed, custom fields, tags and followers to add or remove.",
    parameters: { type: "object", properties: {
      task: TASK, ...TASK_WRITE,
      completed: { type: "boolean" },
      add_tags: { type: "array", items: { type: "string" } }, remove_tags: { type: "array", items: { type: "string" } },
      add_followers: { type: "array", items: { type: "string" } }, remove_followers: { type: "array", items: { type: "string" } },
    }, required: ["task"] },
    async run(args, ctx) {
      const task = gidOf(args.task, "task");
      const body = defined({
        name: args.name === undefined ? undefined : text(args.name, 1000),
        notes: args.notes === undefined ? undefined : text(args.notes), html_notes: args.html_notes === undefined ? undefined : text(args.html_notes),
        assignee: args.assignee === undefined ? undefined : person(args.assignee),
        due_on: date(args.due_on), due_at: date(args.due_at), start_on: date(args.start_on),
        completed: typeof args.completed === "boolean" ? args.completed : undefined,
        custom_fields: args.custom_fields ? await customFields(args.custom_fields, await taskFieldSettings(task, ctx)) : undefined,
      });
      if (Object.keys(body).length) await ctx.asana.call("PUT", `/tasks/${task}`, { body });
      for (const tag of await tagGids(list(args.add_tags), args, ctx)) await ctx.asana.call("POST", `/tasks/${task}/addTag`, { body: { tag } });
      for (const tag of await tagGids(list(args.remove_tags), args, ctx)) await ctx.asana.call("POST", `/tasks/${task}/removeTag`, { body: { tag } });
      if (list(args.add_followers).length) await ctx.asana.call("POST", `/tasks/${task}/addFollowers`, { body: { followers: list(args.add_followers) } });
      if (list(args.remove_followers).length) await ctx.asana.call("POST", `/tasks/${task}/removeFollowers`, { body: { followers: list(args.remove_followers) } });
      return read(ctx, task, TASK_LIST + ",notes,tags.name,followers.name,custom_fields.name,custom_fields.display_value");
    },
  },
  {
    name: "asana_move_task",
    write: true,
    description: "Asana: move a task: into a project and/or section (also a section of a project it is already in), out of a project, or under a parent task (\"none\" makes it a task again).",
    parameters: { type: "object", properties: {
      task: TASK, project: PROJECT, section: SECTION, workspace: WORKSPACE,
      remove_from_project: { type: "string", description: "project gid or name to take the task out of" },
      parent: { type: "string", description: "new parent task gid or URL; \"none\" removes the parent" },
    }, required: ["task"] },
    async run(args, ctx) {
      const task = gidOf(args.task, "task");
      let done = false;
      if (args.project || args.section) {
        let project = args.project ? await projectOf(args.project, args, ctx) : "";
        if (!project) {
          const memberships = (await read(ctx, task, "memberships.project.name")).memberships || [];
          if (memberships.length !== 1) fail("the task is in more than one project or none: name the project");
          project = memberships[0].project.gid;
        }
        const section = args.section ? await sectionOf(args.section, project, ctx) : undefined;
        await ctx.asana.call("POST", `/tasks/${task}/addProject`, { body: defined({ project, section }) });
        done = true;
      }
      if (args.remove_from_project) { await ctx.asana.call("POST", `/tasks/${task}/removeProject`, { body: { project: await projectOf(args.remove_from_project, args, ctx) } }); done = true; }
      if (args.parent) { await ctx.asana.call("POST", `/tasks/${task}/setParent`, { body: { parent: String(args.parent).toLowerCase() === "none" ? null : gidOf(args.parent, "parent") } }); done = true; }
      if (!done) fail("name where to move it: project, section, remove_from_project or parent");
      return read(ctx, task, "name,parent.name,memberships.project.name,memberships.section.name,permalink_url");
    },
  },
  {
    name: "asana_delete_task",
    write: true,
    description: "Asana: delete a task (it goes to the trash for 30 days). Only when asked.",
    parameters: { type: "object", properties: { task: TASK }, required: ["task"] },
    async run(args, ctx) {
      const task = gidOf(args.task, "task");
      await ctx.asana.call("DELETE", `/tasks/${task}`);
      return { deleted: task };
    },
  },
  {
    name: "asana_comment",
    write: true,
    description: "Asana: add a comment to a task, in plain text or rich html_text (<body>…</body>). It carries the connected account's name.",
    parameters: { type: "object", properties: { task: TASK, text: { type: "string" }, html_text: { type: "string" } }, required: ["task"] },
    async run(args, ctx) {
      const task = gidOf(args.task, "task");
      const body = args.html_text ? { html_text: text(args.html_text) } : { text: text(args.text) || fail("write text or html_text") };
      const story = (await ctx.asana.call("POST", `/tasks/${task}/stories`, { body, query: { opt_fields: "created_at,created_by.name,text" } })).data;
      return { gid: story.gid, task, created_at: story.created_at, by: story.created_by?.name, text: story.text };
    },
  },
  {
    name: "asana_attach",
    write: true,
    description: "Asana: attach to a task a file from your computer (path) or a link (url + name).",
    parameters: { type: "object", properties: { task: TASK, url: { type: "string", description: "a link to attach instead of a file" }, name: { type: "string", description: "the link's title" }, ...FILE_PARAMS }, required: ["task"] },
    summarize: (args) => `task ${String(args.task || "")} · ${String(args.url || args.path || "").slice(0, 120)}`,
    async run(args, ctx) {
      const task = gidOf(args.task, "task");
      const form = new FormData();
      form.set("parent", task);
      if (args.url) {
        const url = text(args.url, 2000);
        if (!/^https?:\/\//i.test(url)) fail("url is an http(s) link");
        form.set("resource_subtype", "external");
        form.set("url", url);
        form.set("name", text(args.name, 300) || url);
      } else {
        const file = await localFile(args, ctx);
        form.set("file", new Blob([file.bytes], { type: file.contentType }), file.filename);
      }
      const data = (await ctx.asana.call("POST", "/attachments", { raw: form, query: { opt_fields: "name,host,view_url,permanent_url" } })).data;
      const { resource_type, ...attachment } = data || {};
      return attachment;
    },
  },
  {
    name: "asana_create_project",
    write: true,
    description: "Asana: create a project in a team (the only team when there is one), with notes, due date, color and default view; optional starting sections.",
    parameters: { type: "object", properties: {
      name: { type: "string" }, notes: { type: "string" }, team: { type: "string", description: "team gid or name" }, workspace: WORKSPACE,
      due_on: DATE, start_on: DATE, color: { type: "string", enum: COLORS },
      default_view: { type: "string", enum: ["list", "board", "calendar", "timeline"] },
      privacy: { type: "string", enum: ["public_to_workspace", "private_to_team", "private"], description: "default the workspace's own" },
      sections: { type: "array", items: { type: "string" }, description: "section names to create, in order" },
    }, required: ["name"] },
    async run(args, ctx) {
      const workspace = await workspaceOf(args, ctx);
      const teams = await ctx.asana.all(`/workspaces/${workspace}/teams`, { opt_fields: "name" }, 500).catch(() => []);
      let team;
      if (args.team) team = /^\d+$/.test(String(args.team)) ? String(args.team) : pick(teams, args.team, { what: "team", id: "gid" }).gid;
      else if (teams.length === 1) team = teams[0].gid;
      else if (teams.length > 1) fail(`name the team: ${teams.map((item) => `${item.name} (${item.gid})`).join(", ")}`);
      const body = defined({ name: text(args.name, 500) || fail("name is required"), notes: args.notes === undefined ? undefined : text(args.notes), team, workspace: team ? undefined : workspace, due_on: date(args.due_on), start_on: date(args.start_on), color: args.color, default_view: args.default_view, privacy_setting: args.privacy });
      const project = (await ctx.asana.call("POST", "/projects", { body, query: { opt_fields: "name,permalink_url,team.name" } })).data;
      const sections = [];
      for (const name of list(args.sections)) sections.push((await ctx.asana.call("POST", `/projects/${project.gid}/sections`, { body: { name: name.slice(0, 300) } })).data);
      return { ...project, sections: sections.map(({ gid, name }) => ({ gid, name })) };
    },
  },
  {
    name: "asana_update_project",
    write: true,
    description: "Asana: change a project: name, notes, owner, dates, color, or archive / unarchive it.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE, name: { type: "string" }, notes: { type: "string" }, owner: PERSON, due_on: DATE, start_on: DATE, color: { type: "string", enum: COLORS }, archived: { type: "boolean" } }, required: ["project"] },
    async run(args, ctx) {
      const project = await projectOf(args.project, args, ctx);
      const body = defined({ name: args.name === undefined ? undefined : text(args.name, 500), notes: args.notes === undefined ? undefined : text(args.notes), owner: args.owner === undefined ? undefined : person(args.owner), due_on: date(args.due_on), start_on: date(args.start_on), color: args.color, archived: typeof args.archived === "boolean" ? args.archived : undefined });
      if (!Object.keys(body).length) fail("name something to change");
      return (await ctx.asana.call("PUT", `/projects/${project}`, { body, query: { opt_fields: "name,notes,archived,owner.name,due_on,start_on,color,permalink_url" } })).data;
    },
  },
  {
    name: "asana_create_section",
    write: true,
    description: "Asana: add a section (a column on boards) to a project.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE, name: { type: "string" } }, required: ["project", "name"] },
    async run(args, ctx) {
      const project = await projectOf(args.project, args, ctx);
      const { gid, name } = (await ctx.asana.call("POST", `/projects/${project}/sections`, { body: { name: text(args.name, 300) || fail("name is required") } })).data;
      return { gid, name, project };
    },
  },
  {
    name: "asana_post_status",
    write: true,
    description: "Asana: post a status update on a project (on_track, at_risk, off_track, on_hold, complete) with a title and text.",
    parameters: { type: "object", properties: { project: PROJECT, workspace: WORKSPACE, status: { type: "string", enum: STATUS }, title: { type: "string" }, text: { type: "string" } }, required: ["project", "status", "title"] },
    async run(args, ctx) {
      if (!STATUS.includes(args.status)) fail(`status is one of ${STATUS.join(", ")}`);
      const project = await projectOf(args.project, args, ctx);
      const data = (await ctx.asana.call("POST", "/status_updates", { body: { parent: project, status_type: args.status, title: text(args.title, 300) || fail("title is required"), text: text(args.text) }, query: { opt_fields: "title,status_type,text,created_at,created_by.name" } })).data;
      const { resource_type, ...status } = data || {};
      return status;
    },
  },
  {
    name: "asana_api",
    write: true,
    description: "Asana fallback, only for what the other asana_ tools do not cover: one REST call (method, path after /api/1.0, query, body = the object's fields, Cora wraps them in {data}).",
    parameters: { type: "object", properties: {
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "default GET" },
      path: { type: "string", description: "e.g. /tags/123?opt_fields=name" },
      query: { type: "object" }, body: { type: "object" },
    }, required: ["path"] },
    summarize: (args) => `${String(args.method || "GET").toUpperCase()} ${String(args.path || "")}`.slice(0, 200),
    async run(args, ctx) {
      const method = String(args.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "DELETE"].includes(method)) fail("method is GET, POST, PUT or DELETE");
      const path = String(args.path || "").trim();
      if (!/^\/[\w\-./]*(\?[^#\s]*)?$/.test(path) || path.includes("..") || path.includes("//")) fail("path is an Asana API path such as /tasks/123: no host, no ..");
      const [route, search = ""] = path.split("?");
      const query = { ...Object.fromEntries(new URLSearchParams(search)), ...(args.query && typeof args.query === "object" ? args.query : {}) };
      const body = method === "POST" || method === "PUT" ? (args.body && typeof args.body === "object" ? ("data" in args.body && Object.keys(args.body).length === 1 ? args.body.data : args.body) : {}) : undefined;
      return ctx.asana.call(method, route, { query, body });
    },
  },
];

export const asana = {
  id: "asana",
  name: "Asana",
  secret: "CORA_ASANA_TOKEN",
  appSecrets: ["CORA_ASANA_CLIENT_ID", "CORA_ASANA_CLIENT_SECRET"],
  label: "workspace",
  oauth: {
    authorize: "https://app.asana.com/-/oauth_authorize",
    token: "https://app.asana.com/-/oauth_token",
    scopes: [],
    clientAuth: "body",
    async identify({ access, request, api }) {
      const headers = { Authorization: `Bearer ${access}` };
      const me = await request(`${api.asana}/users/me`, { headers });
      const workspace = Array.isArray(me.data?.data?.workspaces) ? me.data.data.workspaces[0] : null;
      return { workspace: String(workspace?.name || "").slice(0, 120), workspaceId: String(workspace?.gid || "").slice(0, 40), account: String(me.data?.data?.email || me.data?.data?.name || "").slice(0, 120) };
    },
  },
  card: {
    icon: "check",
    description: "Gli agenti lavorano sui progetti e sulle attività del tuo Asana.",
    meta: "Asana · Progetti e attività",
    intro: "Gli agenti lavorano sui progetti del tuo Asana. Il token resta nella cassaforte, mai nel pannello.",
    modes: [{
      id: "pat",
      label: "Token personale",
      notice: "Collegare Asana richiede un token personale: il workspace lo ricava Cora dal token.",
      body: { mode: "pat" },
      rows: [
        { title: "Il token personale", steps: [
          ["apri ", { href: "https://developers.asana.com/docs/personal-access-token", text: "Asana → Impostazioni → App" }, " e crea un token di accesso personale;"],
          "copia il token;",
          ["incollalo qui: Cora lo verifica su Asana e lo salva nella cassaforte come ", { code: "CORA_ASANA_TOKEN" }, ", senza mostrarlo più."],
        ], field: { name: "token", type: "password", label: "Token personale di Asana" }, submit: "Verifica e collega" },
      ],
    }, {
      id: "oauth",
      label: "App OAuth",
      ready: "app",
      intro: "Con un'app OAuth l'accesso è dell'app che crei tu su Asana, non di una persona sola.",
      notice: "Servono client ID e client secret dell'app Asana; poi autorizzi Asana da qui e Cora salva i token nella cassaforte.",
      body: { mode: "oauth" },
      rows: [
        { title: "L'app Asana", steps: [
          ["apri ", { href: "https://developers.asana.com/docs/authentication", text: "developers.asana.com" }, " → My apps → Create new app;"],
          "copia client ID e client secret dell'app;",
          ["incollali qui: finiscono nella cassaforte come ", { code: "CORA_ASANA_CLIENT_ID" }, " e ", { code: "CORA_ASANA_CLIENT_SECRET" }, ";"],
          ["in OAuth aggiungi come redirect URL l'indirizzo di ritorno di Cora mostrato qui sotto, ", { code: "…/connectors/oauth/asana/callback" }, ";"],
          "poi premi «Autorizza Asana» e accetta con il tuo account.",
        ], fields: [
          { name: "clientId", type: "text", title: "Client ID", label: "Client ID dell'app Asana" },
          { name: "clientSecret", type: "password", title: "Client secret", label: "Client secret dell'app Asana" },
        ], submit: "Salva l'app" },
      ],
    }],
  },
  tools: TOOLS,
  context(ctx) { return { ...ctx, asana: client(ctx) }; },
};
