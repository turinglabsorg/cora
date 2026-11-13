import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def bridge(path, body, timeout=30):
    request = Request(
        os.environ["CORA_BRIDGE_URL"] + path,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + os.environ["CORA_BRIDGE_TOKEN"],
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def result_content(output):
    text = str(output.get("text", ""))
    image = output.get("image")
    if not image:
        return text
    if os.environ.get("CORA_MODEL_VISION") != "1":
        return text + "\nThe selected model does not support image input. The image was captured, but you cannot visually inspect it."
    mime = output.get("mimeType") or "image/jpeg"
    if mime not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
        return "error: unsupported image MIME type\n" + text
    return {
        "_multimodal": True,
        "content": [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": "data:" + mime + ";base64," + image}},
        ],
        "text_summary": text + " [Image content requires a vision-capable model.]",
    }


def handler(name):
    def execute(args, **kwargs):
        try:
            timeout = min(600, max(1, float(args.get("timeout_seconds", 120)))) + 30
            return result_content(bridge("/tools/call", {"name": name, "arguments": args}, timeout))
        except HTTPError as error:
            return "error: Cora tool bridge answered HTTP " + str(error.code)
        except (URLError, TimeoutError):
            return "error: Cora tool bridge could not complete the request"
    return execute


def register(ctx):
    if not os.environ.get("CORA_BRIDGE_URL") or not os.environ.get("CORA_BRIDGE_TOKEN"):
        return
    for tool in bridge("/tools/list", {})["tools"]:
        name = "mcp_cora_" + tool["name"]
        ctx.register_tool(
            name=name,
            toolset="cora",
            schema={"name": name, "description": tool["description"], "parameters": tool["parameters"]},
            handler=handler(tool["name"]),
        )
