# Sealed agents

A sealed agent uses its own core card, diary and personal memories. It receives no shared facts, company Brain pages or instance context documents. It retains the owner's operating instructions and explicitly assigned resources.

## Configuration and lifecycle

Set `sealed: true` in `POST /api/agents`, or update it through `PUT /api/agents/:id/knowledge`. Generic profile updates cannot change the seal. The agent's owners manage this configuration; sharing a sealed agent does not grant its co-owners access to the original owner's Brain.

The panel provides a Sealed switch in New agent and Memory → Source, and a lock badge in the roster and agent header. Changing isolation refuses active work, invalidates old tool contexts and waits for the desktop transition. A failed transition can be retried without treating a stored flag as proof that the firewall started.

Named vault, artifact and connector grants are preserved. Wildcard grants do not apply to a sealed agent. Brain tools refuse access; `remember`, `recall` and nightly consolidation use only the agent's own memory namespace and admitted channels. A shared flag on a memory write cannot promote it into shared memory. Foreign memory ids cannot be edited or deleted.

## Conversations

A sealed agent listens only in its assigned channels and their threads, its own bot's Telegram chats and its private panel room. It does not join the lounge. Shared channels remain shared: their messages are available to every explicitly assigned participant. The agent roster in prompts includes only colleagues sharing a channel with the sealed agent.

Channels explicitly assigned only to sealed agents do not admit ordinary agents that listen everywhere by default. Their messages and messages authored by sealed agents are excluded from company Brain ingestion. Private panel APIs remain owner-restricted even when owner-scoped memory is disabled.

## Artifact storage

A sealed push retains content-addressed payloads under `/home/agent/.local/share/cora/artifact-objects` inside that desktop's home volume. Cora stores tree descriptors and commit metadata on its server, including the storage agent id, but does not copy these payloads into its object store or temporary files.

Review, previews, range downloads, ZIP downloads and checkout read through the source desktop. Hash verification fails closed for missing or changed content; there is no fallback to a server object of the same hash. The source desktop must remain available. Deleting its home volume removes these payloads. This does not migrate or erase objects previously published before sealing.

New sealed folders start private, with their creator named as writer, and do not inherit broad team-level grants. Other folders are usable only through a named assignment. Folder links requested by sealed agents require owner approval before activation. A level containing unassigned folders cannot be shared through a partial grant. Existing recipient authentication and revocation still apply. Direct `share_file` transfers to or from sealed agents are refused; approved artifact links retain sharing capability.

## Desktop network

All ordinary desktops use the `cora-desktops` bridge with inter-container communication disabled. Each sealed desktop uses a separate bridge and a trusted network-namespace keeper. Only the keeper receives `NET_ADMIN`; it has no persistent mounts, a read-only root filesystem and a small temporary `/run`. The desktop has neither `NET_ADMIN` nor `NET_RAW`, and has only its home and system-state volumes, with no host paths or Docker socket.

The keeper installs default-deny filtering before the desktop starts. It allows loopback, reply traffic, the owner's SSH/noVNC ingress and public IPv4 egress; it rejects private, link-local, tailnet, reserved and multicast IPv4 destinations. Non-loopback IPv6 egress is denied. DNS uses Docker's embedded resolver. Published SSH/noVNC ports bind only to `127.0.0.1`. Sealed desktops are logged out of Tailscale and cannot use the panel's Tailscale connect action.

Desktop recreation preserves named volumes. Removing the seal removes the keeper before rebinding the owner's ports. This is container and network isolation, not encryption or protection against the host administrator or a kernel escape. Previously stored credentials and working files in the agent's own volumes are not erased automatically.

## Dedicated verification

Run only the feature tests:

```sh
node --test test/sealed.test.js test/sealed-artifacts.test.js test/sealed-box.test.js
```

The disposable real-Docker check additionally verifies root-level firewall refusal, a known live peer, private destinations, public HTTPS, the owner's desktop port, restart and unsealing with volume preservation:

```sh
CORA_TEST_DOCKER=1 node --test test/sealed-network.test.js
```

It requires a built desktop image containing `iptables`; `CORA_TEST_BOX_IMAGE` and `CORA_TEST_DOCKER_BIN` can select the image and executable. It creates only disposable containers and volumes, never production Cora agents. Desktop and phone browser verification follows create, seal, save, reload, unseal and reload, with console and network error checks.
