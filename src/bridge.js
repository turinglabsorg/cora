import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";

/**
 * Loopback HTTP endpoint that the MCP server (spawned by the Claude Code or
 * Codex CLI) calls to run cora's tools inside the right agent context. It
 * listens on its own random port, never on the panel's port, and every run
 * gets its own random token that dies with the run.
 */
export class ToolBridge {
  constructor() {
    this.runs = new Map();
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.url = "";
  }

  start() {
    return new Promise((resolve) => this.server.listen(0, "127.0.0.1", () => {
      this.url = `http://127.0.0.1:${this.server.address().port}`;
      resolve(this.url);
    }));
  }

  stop() {
    this.runs.clear();
    this.server.closeAllConnections?.();
    return new Promise((resolve) => this.server.close(resolve));
  }

  /** Register a run: `tools` are definitions, `execute(name, args)` returns {text, image?}. */
  register({ tools, execute, ttlMs = 20 * 60 * 1000 }) {
    const token = randomBytes(32).toString("hex");
    const timer = setTimeout(() => this.runs.delete(token), ttlMs);
    this.runs.set(token, { tools, execute });
    return { token, url: this.url, dispose: () => { clearTimeout(timer); this.runs.delete(token); } };
  }

  find(req) {
    const header = String(req.headers.authorization || "");
    const given = Buffer.from(header.replace(/^Bearer /, ""));
    for (const [token, run] of this.runs) {
      const expected = Buffer.from(token);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return run;
    }
    return null;
  }

  async handle(req, res) {
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST") return reply(405, { error: "method not allowed" });
    const run = this.find(req);
    if (!run) return reply(401, { error: "unknown run" });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return reply(400, { error: "invalid JSON" }); }
    if (req.url === "/tools/list") return reply(200, { tools: run.tools });
    if (req.url === "/tools/call") {
      const name = String(body.name || "");
      if (!run.tools.some((tool) => tool.name === name)) return reply(200, { text: `error: the tool ${name} is not available now` });
      try {
        const out = await run.execute(name, body.arguments && typeof body.arguments === "object" ? body.arguments : {});
        return reply(200, { text: out.text, image: out.image || null });
      } catch (error) {
        return reply(200, { text: `error: ${error.message}` });
      }
    }
    return reply(404, { error: "not found" });
  }
}
