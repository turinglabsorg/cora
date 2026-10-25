#!/usr/bin/env node
// Minimal MCP server over stdio (newline-delimited JSON-RPC). The Claude Code
// and Codex CLIs start it for one agent turn; it forwards every tool call to
// cora's loopback tool bridge with the run's token.
import readline from "node:readline";

const BRIDGE_URL = process.env.CORA_BRIDGE_URL;
const BRIDGE_TOKEN = process.env.CORA_BRIDGE_TOKEN;

async function bridge(path, body) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BRIDGE_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`cora bridge answered ${response.status}`);
  return response.json();
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cora", version: "0.1.0" },
      };
    case "ping":
      return {};
    case "tools/list": {
      const { tools } = await bridge("/tools/list", {});
      return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) };
    }
    case "tools/call": {
      const out = await bridge("/tools/call", { name: message.params?.name, arguments: message.params?.arguments || {} });
      const content = [{ type: "text", text: out.text }];
      if (out.image) content.push({ type: "image", data: out.image, mimeType: out.image.startsWith("iVBOR") ? "image/png" : "image/jpeg" });
      return { content, isError: String(out.text).startsWith("error:") };
    }
    default: {
      const error = new Error(`method not found: ${message.method}`);
      error.code = -32601;
      throw error;
    }
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => setTimeout(() => process.exit(0), 200));
lines.on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined || message.id === null) return;
  try {
    send({ jsonrpc: "2.0", id: message.id, result: await handle(message) });
  } catch (error) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: error.code || -32000, message: error.message } });
  }
});
