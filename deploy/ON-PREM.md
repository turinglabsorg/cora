# Installing Cora on someone else's machine

An on-premise Cora runs on the customer's own hardware, under an ordinary user account, and
answers on the customer's own domain. Their conversations, memories, files and agent desktops
never leave that machine. usecora.space, when it is used at all, only says who may come in.

Nothing in this procedure needs root. That is deliberate: a customer can hand over an ordinary
account and still get an always-on install.

## What the machine needs

- Linux with systemd user services. `loginctl enable-linger <user>` keeps them running after logout.
- Node 22.13 or newer. `nvm install 22` is enough; the deploy script finds it and records it as
  `CORA_NODE`.
- Docker the user can run without `sudo` (the `docker` group), for the agents' desktops.
- `hush` for this user, with its vault and box key:
  `curl -fsSL https://raw.githubusercontent.com/turinglabsorg/hush/<version>/install.sh | sh -s -- --version <version> --path-link`
  then `hush init && hush box init`. Every secret of this install lives in that vault and in no
  other — not in ours.
- Outbound internet. No inbound port, as long as the site is published through a tunnel.

## 1. Deploy

Put the SSH details of the machine in a configuration file of its own, so the procedure is the
same for every customer:

```
Host customer
  HostName 100.95.160.100
  User dopamina
  Port 7893
  IdentityFile ~/.ssh/id_ed25519
  ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1055 %h %p   # only when it is reached through a tailnet
```

Then, from a checkout of this repository:

```
CORA_DEPLOY_HOST=customer CORA_DEPLOY_SSH_OPTS="-F ~/.ssh/customer.conf" deploy/linux.sh
```

It copies the checkout to `~/Services/cora`, generates the missing secrets in the customer's hush
vault (`CORA_ADMIN_PASSWORD`, `CORA_SESSION_KEY`, `CORA_VAPID_KEY`), builds the desktop image when
`box/` changed, installs `cora.service` as a systemd user unit and waits for `/healthz`.
Cora listens on `127.0.0.1:4370` and nothing else: the only way in is the one set up next.

Useful afterwards: `systemctl --user status cora`, `journalctl --user -u cora -f`,
`systemctl --user restart cora`.

## 2. Publish it

### A tunnel (recommended)

`cloudflared` runs as a user process, opens no port on the customer's router, hides the machine's
address and terminates TLS at the edge:

```
cloudflared tunnel login                        # once, in the customer's browser
cloudflared tunnel create cora
cloudflared tunnel route dns cora cora.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel id>
credentials-file: /home/<user>/.cloudflared/<tunnel id>.json
ingress:
  - hostname: cora.example.com
    service: http://127.0.0.1:4370
  - service: http_status:404
```

Keep it running with its own user unit (`~/.config/systemd/user/cloudflared.service`,
`ExecStart=/usr/local/bin/cloudflared tunnel run cora`, `Restart=always`), then
`systemctl --user enable --now cloudflared`.

### Or their own reverse proxy

If the customer already terminates TLS (nginx, Caddy, Traefik), point a virtual host at
`http://127.0.0.1:4370`, pass `Upgrade`/`Connection` through for live events and the desktops,
and keep the certificate theirs. This needs root on that machine, so it is their administrator's
job, not ours.

## 3. Decide how people sign in

**Standalone.** Leave `CORA_CLOUD_*` unset: the panel asks for the password in
`CORA_ADMIN_PASSWORD`, and Settings → Access decides which verified emails may come in. Nothing
depends on us.

**Through usecora.space.** The cloud becomes the identity broker and nothing else: people sign in
with Google there and are sent straight to the customer's own domain — their traffic never passes
through our servers.

On the cloud:

```
cloud/cli.js space add <slug> --upstream https://cora.example.com --public https://cora.example.com --google <owner email>
```

On the instance, in `~/.cora/env` (not secret, read by `bin/run.sh`):

```
CORA_CLOUD_URL=https://usecora.space
CORA_CLOUD_KEY=<the cloud's public key: cloud/cli.js public-key>
CORA_CLOUD_SPACE=<slug>
CORA_PUBLIC_HOST=cora.example.com
```

`CORA_PUBLIC_HOST` is what makes the passes valid for the customer's own domain. With these set,
password login is refused on purpose; `bin/login-link.mjs` still makes a one-time link on the
machine itself for the day the cloud cannot be reached.

## 4. Close the door behind you

- Settings → Access: authorise the customer's email domain, and nothing else. Membership is by
  verified email; an exact domain match only, never a subdomain.
- Settings → Channels: turn on only the channels, chats or Slack conversations the agents should
  hear.
- Agent desktops are reachable only through the panel (an authenticated noVNC proxy) and over SSH
  with the keys listed in Settings; they are published on `127.0.0.1` alone.
- Secrets: every token the customer pastes in the panel is sealed into *their* hush vault by the
  machine itself. Never carry a customer's token to another machine, and never put one in a file.

## 5. Check it, with the customer watching

1. `curl -fsS http://127.0.0.1:4370/healthz` on the machine.
2. The public address answers, with a valid certificate.
3. A real sign-in from an allowed address, and a refusal from one outside the policy.
4. One message in a real channel, answered by an agent, and the answer visible in the panel.
5. `systemctl --user restart cora`: the panel comes back and interrupted work resumes.

## Updating

Run `deploy/linux.sh` again. It rsyncs the new checkout, rebuilds the desktop image only when
`box/` changed, and restarts the service. The database (`~/.cora/cora.db`), the hush vault and the
desktops' volumes are untouched; back up `~/.cora/cora.db` before a big change.
