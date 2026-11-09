# Agent email and domains

The Settings → Domains page connects multiple Resend accounts to a Cora instance. Each managed domain is bound to one account and the instance namespace. The existing configured Cora domain continues to use the relay’s default account.

## Setup

1. Open Settings → Domains (`#/settings/domini`, in the Agents group) and connect a named Resend account with a full-access API key. Cora checks access, saves the key in hush, and registers an account-specific receiving webhook.
2. Add a domain or dedicated mail subdomain under that account. Cora enables sending and receiving in Resend and shows its current DNS records. Use a dedicated subdomain when the main domain already receives mail elsewhere: changing its MX records changes its email destination.
3. Copy the required DKIM, SPF and receiving MX records into the domain’s DNS provider. Press Verify DNS, then refresh after propagation if necessary. Sending, receiving and relay activation are checked separately.
4. In an agent’s Email tab, choose a name (3–32 lowercase letters, digits or hyphens) and a ready domain. The agent must be enabled and have its computer enabled. The address changes only after the desktop successfully provisions and validates the new mailbox.

Account and domain changes require the space owner. Replacing an account key checks that it still controls every bound Resend domain id before changing stored credentials; a key from a different account is refused. Authorized panel members retain the existing operational ability to manage agents and their addresses, but cannot connect keys or add domains.

## Identity and mail preservation

The agent desktop creates and retains its RSA private key and mailbox API credential. Cora stores only public address/status metadata. Previous mailbox directories and their mail remain intact after an address change. The new address becomes the ambox default; older addresses are available through `ambox --agent old@domain inbox`. Rename and restart retain the selected primary address. An address collision, unsupported domain or failed provisioning leaves the current default untouched.

## Routing and credentials

Cora stores each Resend key in hush as `CORA_MAIL_ACCOUNT_MA_<id>`, injects it only into the Cora service, and removes these variables from model CLI environments. Account metadata and DNS records in SQLite contain no provider keys or webhook signing secrets.

The ambox relay stores account credentials encrypted with AES-GCM, bound to the namespace, account id and credential purpose. The encryption key is derived from its existing domain registration credential with a separate application context. Resynchronizing an account from Cora replaces its encrypted credentials; after rotating the registration credential on the service and instances, use the account’s Verify action to resynchronize.

Each account has its own signed inbound webhook. Mail is fetched through that account and delivered only to domains assigned to it. The legacy webhook excludes managed-domain mail to avoid duplicate delivery. Outbound mail resolves the sender’s stored domain to its account; failed key decryption or routing fails closed, without falling back to the shared provider. ambox independently retrieves domain status from Resend before activating a route. Custom mailbox registration also checks the namespace.

The instance requires its existing `CORA_MAIL_ENDPOINT`, `CORA_MAIL_NAMESPACE` and hush `CORA_MAIL_REGISTRATION_TOKEN` configuration. `CORA_MAIL_DOMAIN` keeps the shared default domain. Resend API base overrides are intended for integration tests. New ambox `mail_accounts` and `mail_routes` records use only direct `_id` lookups and conditional replacements, preserving cross-namespace uniqueness without collection scans. Verify explicit `_id` indexes for both collections are READY on Firestore Enterprise before routing traffic; unlike MongoDB, this database does not create them automatically.

## Email channel and external senders

Settings → Channels → E-mail controls automatic mailbox notifications and handling. Each agent's Email page adds inherited or personal rules, the report channel, an inbox/sent/draft recap, and an image signature. Cora registers signed mailbox notifications automatically and reconciles arrivals periodically, falling back to one-minute checks when push is unavailable; no webhook fields appear in the product. Work begins only for new matching mail after activation. Reports are passive channel messages; an authorized person can ask an agent to persist another accessible report destination with `email_settings`.

Settings → Connectors connects Google through the existing Fluxkit OAuth application. The owner assigns each connected account to specific agents; those agents can select it as their outgoing identity. The connection requests `openid`, `email` and `gmail.send`, without combining other Fluxkit tools' grants. It sends from the verified connected account; Google inbox synchronization and unverified sender aliases are not part of this connector. Its refresh credential and signed relay grant are stored together in hush as `CORA_GOOGLE_GC_<id>` and excluded from every model CLI environment. The shared OAuth client secret stays on the Fluxkit connector service. Disconnecting in Cora removes that connection's agent assignments without revoking another Fluxkit application's Google access.

Email HTML composition, tracking image insertion and the signature renderer are adapted from Milo (`src/mail/LICENSE.milo`). The renderer uses the agent's avatar and the bundled OFL Geist fonts. It runs on the desktop with Python Pillow, provisioned on demand without rebuilding its image. Complete HTML templates retain their own signature. An authenticated preview does not count as an open; external image requests record the first observation and count, which do not prove that a human read the message.
