/**
 * Chat rooms that live in the panel instead of Discord: the "salotto" where
 * every agent is, and one private room per agent. They go through the same
 * orchestrator as Discord channels and land in the same archive.
 */
export const SALOTTO = "web";

export function privateRoom(agentId) {
  return `web-${agentId}`;
}

export function isWebRoom(id) {
  return id === SALOTTO || /^web-[\w-]+$/.test(String(id || ""));
}

/** The agent of a private room, or null for the salotto. */
export function roomAgentId(id) {
  return isWebRoom(id) && id !== SALOTTO ? id.slice(4) : null;
}

export function roomLabel(id, store) {
  if (id === SALOTTO) return "salotto (pannello)";
  const agent = store.agent(roomAgentId(id));
  return `chat privata con ${agent?.name || "un agente"} (pannello)`;
}
