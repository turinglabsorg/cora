import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { EN } from "../web/i18n.js";

class Element {
  constructor(tag = "", text = "") {
    this.tagName = tag;
    this.text = text;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.style = { setProperty() {} };
    // A browser's text fields start empty, never undefined.
    if (tag === "input") this.value = "";
  }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === "textarea") return this.textContent;
    if (this.tagName === "select") {
      const options = this.querySelectorAll("option");
      const chosen = options.find((option) => option.selected) || options[0];
      return chosen?.value ?? chosen?.textContent ?? "";
    }
  }
  set value(value) { this._value = value; }
  get className() { return this.attributes.class || ""; }
  set className(value) { this.attributes.class = value; }
  get id() { return this.attributes.id || ""; }
  set id(value) { this.attributes.id = String(value); }
  get classList() {
    const names = () => this.className.split(" ").filter(Boolean);
    const write = (list) => { this.className = [...new Set(list)].join(" "); };
    return {
      contains: (name) => names().includes(name),
      add: (...added) => write([...names(), ...added]),
      remove: (...gone) => write(names().filter((name) => !gone.includes(name))),
      toggle: (name, force) => {
        const on = force === undefined ? !names().includes(name) : Boolean(force);
        write(on ? [...names(), name] : names().filter((item) => item !== name));
        return on;
      },
    };
  }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.text = value; this.replaceChildren(); }
  get lastChild() { return this.children.at(-1); }
  get lastElementChild() { return this.children.filter((child) => child.tagName !== "text").at(-1) || null; }
  get isConnected() { return this.tagName === "document" || Boolean(this.parent?.isConnected); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  /** What a real click does to the panel, so a test can follow a choice through. */
  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] || []) handler({ type, preventDefault() {}, stopPropagation() {}, ...event });
    return this;
  }
  click() { return this.dispatch("click"); }
  /** Every named field below this one, the way form.elements and FormData see them. */
  get fields() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.attributes.name && ["input", "select", "textarea"].includes(child.tagName)) out.push(child);
        walk(child);
      }
    };
    if (this.tagName === "form" && this.id && this.isConnected) {
      let root = this;
      while (root.parent) root = root.parent;
      walk(root);
      return out.filter((field) => {
        if (field.attributes.form) return field.attributes.form === this.id;
        let parent = field.parent;
        while (parent && parent.tagName !== "form") parent = parent.parent;
        return parent === this;
      });
    }
    walk(this);
    return out;
  }
  get elements() { return Object.fromEntries(this.fields.map((field) => [field.attributes.name, field])); }
  scrollIntoView() {}
  focus() { let root = this; while (root.parent) root = root.parent; root.activeElement = this; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
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
    const matches = (node) => selector.split(",").some((value) => {
      const part = value.trim();
      return part.startsWith(".") ? node.className.split(" ").includes(part.slice(1)) : node.tagName === part;
    });
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

/** What a browser submits for a form: enabled fields, checked boxes, a select's chosen option. */
class FormData {
  constructor(form) {
    this.entries = [];
    for (const field of form.fields) {
      if (field.disabled === true || "disabled" in field.attributes) continue;
      const type = field.attributes.type;
      if ((type === "checkbox" || type === "radio") && !field.checked) continue;
      let value = field.value;
      if (field.tagName === "select" && value === undefined) {
        const options = field.querySelectorAll("option");
        const chosen = options.find((option) => option.selected) || options[0];
        value = chosen ? chosen.value ?? chosen.attributes.value ?? chosen.textContent : "";
      }
      this.entries.push([field.attributes.name, String(value ?? "")]);
    }
  }
  get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
  has(name) { return this.entries.some(([key]) => key === name); }
  getAll(name) { return this.entries.filter(([key]) => key === name).map(([, value]) => value); }
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
  const location = { hash };
  const context = createContext({
    EN, Node: Element, document, fetch, FormData,
    navigator: { language }, location,
    history: { replaceState(_state, _title, url) { location.hash = String(url); } },
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
