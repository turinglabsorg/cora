import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { EN } from "../web/i18n.js";

class Element {
  constructor(tag = "", text = "") {
    this.tagName = tag;
    this.text = text;
    this.attributes = {};
    this.children = [];
    this.style = { setProperty() {} };
  }
  get className() { return this.attributes.class || ""; }
  set className(value) { this.attributes.class = value; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.text = value; this.replaceChildren(); }
  get lastChild() { return this.children.at(-1); }
  get isConnected() { return this.tagName === "document" || Boolean(this.parent?.isConnected); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  scrollIntoView() {}
  append(...children) {
    for (const child of children) {
      const node = child instanceof Element ? child : new Element("text", String(child));
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith(".") ? node.className.split(" ").includes(selector.slice(1)) : node.tagName === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

/** Runs the served panel against the integration server with a small, inert DOM. */
export function panelHarness({ source, fetch, hash = "", language = "it" }) {
  const document = new Element("document");
  document.documentElement = new Element("html");
  document.body = new Element("body");
  const app = new Element("div");
  document.append(document.documentElement);
  document.documentElement.append(document.body);
  document.body.append(app);
  document.createElement = (tag) => new Element(tag);
  document.createElementNS = (_, tag) => new Element(tag);
  document.createTextNode = (text) => new Element("text", String(text));
  document.getElementById = () => app;
  const context = createContext({
    EN, Node: Element, document, fetch,
    navigator: { language }, location: { hash },
    localStorage: { getItem: () => language },
    window: { addEventListener() {} },
    requestAnimationFrame: (fn) => fn(),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    EventSource: class { close() {} },
    URL, URLSearchParams,
  });
  const script = source || readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  runInContext(script.replace(/^import .*;\n/, "").replace(/boot\(\);\s*$/, ""), context);
  return {
    app,
    run: (expression) => runInContext(expression, context),
    navigate: (hash) => { context.location.hash = hash; return runInContext("render()", context); },
  };
}
