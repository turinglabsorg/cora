export class ThreadState extends Map {
  set(channelId, agentId, value = agentId) {
    let agents = super.get(channelId);
    if (!agents) super.set(channelId, agents = new Map());
    agents.set(agentId, value);
    return this;
  }

  get(channelId, agentId) {
    const agents = super.get(channelId);
    return agentId === undefined ? agents?.values().next().value : agents?.get(agentId);
  }

  has(channelId, agentId) {
    return agentId === undefined ? super.has(channelId) : Boolean(super.get(channelId)?.has(agentId));
  }

  delete(channelId, agentId) {
    if (agentId === undefined) return super.delete(channelId);
    const agents = super.get(channelId);
    const removed = agents?.delete(agentId) || false;
    if (!agents?.size) super.delete(channelId);
    return removed;
  }

  valuesFor(channelId) {
    return [...(super.get(channelId)?.values() || [])];
  }
}
