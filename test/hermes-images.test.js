import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ToolBridge } from "../src/bridge.js";
import { hermesConfig } from "../src/cli.js";

const adapter = fileURLToPath(new URL("../src/hermes-cora/__init__.py", import.meta.url));
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOO8AAAAASUVORK5CYII=";
function python(env, source) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", source, adapter], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", (part) => { output += part; });
    child.stderr.on("data", (part) => { error += part; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  });
}
const run = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("cora_adapter",sys.argv[1]); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Context:
 def __init__(self): self.tools=[]
 def register_tool(self,**tool): self.tools.append(tool)
c=Context();module.register(c)
tool=c.tools[0]
result=tool["handler"]({})
print(json.dumps({"names":[t["name"] for t in c.tools],"toolset":tool["toolset"],"result":result}))`;

test("Hermes' native adapter delivers actual PNG content through the authorized bridge", async () => {
  const bridge = new ToolBridge(); await bridge.start(); let calls = 0;
  const session = bridge.register({ tools: [{ name: "screenshot", description: "Desktop pixels", parameters: { type: "object", properties: {} } }], execute: async () => { calls++; return { text: "Desktop screenshot", image: png }; } });
  try {
    const env = { CORA_BRIDGE_URL: session.url, CORA_BRIDGE_TOKEN: session.token, CORA_MODEL_VISION: "1" };
    const output = await python(env, run);
    assert.deepEqual(output.names, ["mcp_cora_screenshot"]); assert.equal(output.toolset, "cora");
    assert.equal(output.result._multimodal, true);
    assert.equal(output.result.content[1].image_url.url, `data:image/png;base64,${png}`);
    assert.doesNotMatch(JSON.stringify(output.result), /MEDIA:/);
    assert.equal(calls, 1);
    const unsupported = await python(env, run.replace('result=tool["handler"]({})', 'result=module.result_content({"text":"kept tool metadata","image":"fixture","mimeType":"image/tiff"})'));
    assert.match(unsupported.result, /unsupported image MIME type\nkept tool metadata/);
    const noVision = await python({ ...env, CORA_MODEL_VISION: "0" }, run);
    assert.match(noVision.result, /does not support image input/);
    assert.doesNotMatch(noVision.result, /base64|MEDIA:/);
    const denied = await python({ ...env, CORA_BRIDGE_TOKEN: "wrong-token" }, run.replace("module.register(c)", "c.register_tool(name='denied',toolset='cora',handler=module.handler('screenshot'))"));
    assert.match(denied.result, /HTTP 401/); assert.equal(calls, 2);
  } finally { session.dispose(); await bridge.stop(); }
});

test("Hermes records the selected vision capability and enables only Cora's image-aware adapter", () => {
  for (const vision of [false, true]) {
    const config = hermesConfig({ baseUrl: "https://example.test/v1", model: "vision-fixture", keyed: true, vision });
    assert.match(config, new RegExp(`supports_vision: ${vision}`));
    assert.match(config, /plugins:\n  enabled:\n    - cora-tools/);
    assert.doesNotMatch(config, /mcp_servers|CORA_BRIDGE_TOKEN/);
    assert.match(config, /\$\{CORA_ENDPOINT_KEY\}/);
  }
});
