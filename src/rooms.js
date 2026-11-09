/**
 * Chat rooms that live in the panel instead of Discord: the "salotto" where
 * every agent is, and one private room per agent. They go through the same
 * orchestrator as Discord channels and land in the same archive.
 */
import { createHash } from "node:crypto";

export const SALOTTO = "web";

export function ownerRoom(ownerId) {
  return `web-owner-${createHash("sha256").update(ownerId).digest("hex").slice(0, 24)}`;
}

export function isSalotto(id) {
  return id === SALOTTO || /^web-owner-[a-f0-9]{24}$/.test(String(id || ""));
}

export function privateRoom(agentId) {
  return `web-${agentId}`;
}

export function isWebRoom(id) {
  return id === SALOTTO || /^web-[\w-]+$/.test(String(id || ""));
}

/** The agent of a private room, or null for the salotto. */
export function roomAgentId(id) {
  return isWebRoom(id) && !isSalotto(id) ? id.slice(4) : null;
}

export function roomLabel(id, store) {
  if (isSalotto(id)) return "salotto (pannello)";
  const agent = store.agent(roomAgentId(id));
  return `chat privata con ${agent?.name || "un agente"} (pannello)`;
}
