#!/usr/bin/env node
// Live check of a subscription CLI on this machine: the real Grok Build or Muse Code,
// the account already signed in here and Cora's MCP bridge, with one probe tool. Also
// asks the agent to run a shell command, which it must not be able to do.
//   node bin/cli-smoke.mjs grok|muse [model]
import { homedir } from "node:os";
import { join } from "node:path";
import { ToolBridge } from "../src/bridge.js";
import { runGrok, runMuse } from "../src/cli.js";
import { HARNESSES } from "../src/harnesses.js";
import { subscriptionEnvironment } from "../src/subscriptions.js";

const provider = process.argv[2];
const cli = { grok: { run: runGrok, model: "grok-4.7" }, muse: { run: runMuse, model: "muse-wonder-1.0" } }[provider];
if (!cli) {
  console.error("usage: node bin/cli-smoke.mjs grok|muse [model]");
  process.exit(1);
}
const bridge = new ToolBridge();
await bridge.start();
const calls = [];
const steps = [];
const tools = [{
  name: "probe",
  description: "Returns a check code for the given value.",
  parameters: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
}];
const mcp = bridge.register({
  tools,
  execute: async (name, args) => {
    calls.push({ name, args });
    return { text: `probe code ${Number(args.value) * 2}` };
  },
  ttlMs: 300000,
});
// The machine's own account, as Cora runs it: no home override, nothing else from this shell.
const authEnv = subscriptionEnvironment(provider, "");
delete authEnv[HARNESSES[provider].homeVar];
delete authEnv.XDG_DATA_HOME;
const started = Date.now();
try {
  const result = await cli.run({
    bin: process.env[`CORA_${provider.toUpperCase()}_BIN`] || provider,
    model: process.argv[3] || cli.model,
    system: "You are a test agent. Use only the tools you are given.",
    prompt: "1) Call the probe tool with value 42 and report the code it returns. 2) Then try to run the shell command `ls ~` and tell me whether you could. 3) List the names of all the tools you have.",
    mcp,
    toolNames: tools.map((tool) => tool.name),
    workDir: join(homedir(), ".cora", "cli-work"),
    home: join(homedir(), ".cora", "grok-home"),
    timeoutMs: 240000,
    onStep: (step) => steps.push(step.type === "tool" ? step : { type: step.type, text: String(step.text || "").slice(0, 160) }),
    authEnv,
    residentAuth: true,
  });
  console.log(JSON.stringify({ provider, seconds: Math.round((Date.now() - started) / 1000), calls, steps, usage: result.usage, answer: result.text }, null, 2));
} finally {
  mcp.dispose();
  await bridge.stop?.();
}
process.exit(0);
