/** Where a Hermes model that is not on this machine's Ollama actually runs. */
export const HERMES_KEY_PROVIDERS = ["ollama", "deepseek"];

export const HERMES_ENDS = {
  // /api/tags is a public catalog: a bad key still gets 200. The key is checked with POST /api/me.
  ollama: { baseUrl: "https://ollama.com/v1", modelsUrl: "https://ollama.com/api/tags", authUrl: "https://ollama.com/api/me" },
  // DeepSeek's OpenAI-compatible root, the one Hermes setup asks for. The path is /chat/completions.
  // /models refuses a key the account does not own.
  deepseek: { baseUrl: "https://api.deepseek.com", modelsUrl: "https://api.deepseek.com/models" },
};

export const DEEPSEEK_CATALOG = [
  { name: "deepseek-flash", label: "DeepSeek V4.1 Flash" },
  { name: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

/**
 * The key a Hermes model id needs: ollama or deepseek.
 * Empty means this machine's Ollama, which has no key of its own.
 * `hermes/ollama/<name>` and `hermes/deepseek/<name>` are the keyed forms.
 */
export function hermesKeyBackend(model) {
  const parts = String(model || "").split("/");
  if (parts[0] !== "hermes" || parts.length < 3) return "";
  return HERMES_KEY_PROVIDERS.includes(parts[1]) ? parts[1] : "";
}

/** The model name Hermes sends to that endpoint, after `hermes/<backend>/`. */
export function hermesRemoteModel(model) {
  return String(model || "").split("/").slice(2).join("/");
}
