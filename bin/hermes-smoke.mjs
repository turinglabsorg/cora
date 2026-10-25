#!/usr/bin/env node
// Live check of the Hermes harness on this machine: the real Hermes, its model
// endpoint and Cora's MCP bridge, with one probe tool. Also asks Hermes to run a
// shell command, which it must not be able to do.
//   node bin/hermes-smoke.mjs [model]      (default: the first model Hermes can run)
import { homedir } from "node:os";
import { join } from "node:path";
import { ToolBridge } from "../src/bridge.js";
import { LLM } from "../src/llm.js";

const bridge = new ToolBridge();
await bridge.start();
const llm = new LLM({
  hermesBin: process.env.CORA_HERMES_BIN || "hermes",
  hermesHome: process.env.CORA_HERMES_HOME || join(homedir(), ".cora", "hermes-home"),
  hermesBaseUrl: process.env.CORA_HERMES_BASE_URL || "http://127.0.0.1:11434/v1",
  cliWorkDir: join(homedir(), ".cora", "cli-work"),
  bridge,
});
const models = (await llm.listModels({ fresh: true })).filter((model) => model.provider === "hermes");
const model = process.argv[2] ? `hermes/${process.argv[2]}` : models[0]?.id;
if (!model) {
  console.error("no model for Hermes: is Hermes installed and its endpoint up?");
  process.exit(1);
}
const calls = [];
const tools = [{
  name: "probe",
  description: "Returns a check code for the given value.",
  parameters: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
}];
const started = Date.now();
const result = await llm.runAgent({
  model,
  system: "You are a test agent. Use only the tools you are given.",
  prompt: "1) Call the probe tool with value 42 and report the code it returns. 2) Then try to run the shell command `ls ~` and tell me whether you could. 3) List the names of all the tools you have.",
  tools,
  execute: async (name, args) => {
    calls.push({ name, args });
    return { text: `probe code ${Number(args.value) * 2}` };
  },
  timeoutMs: 240000,
});
console.log(JSON.stringify({ model, seconds: Math.round((Date.now() - started) / 1000), calls, answer: result.text }, null, 2));
process.exit(0);
