export const CORA_GIT_COAUTHOR_EMAIL = "git@usecora.space";

export function coauthorTrailer({ enabled = true, email = CORA_GIT_COAUTHOR_EMAIL } = {}) {
  if (!enabled) return "";
  const address = String(email).trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) {
    throw new Error("Cora's GitHub co-author identity is not configured. Set CORA_GIT_COAUTHOR_EMAIL to the email associated with its GitHub profile.");
  }
  return `Co-authored-by: Cora <${address}>`;
}
