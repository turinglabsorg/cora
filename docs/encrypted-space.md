# Encrypted space

Encrypted space is an opt-in, per-folder encrypted archive and a separate private document-session runner. It defaults **off**. An agent's independent **Settings > Security > Encrypted space** option defaults off and does not change its Sealed setting.

## Scope and trust boundary

The normal transport conversation receives only an access-request link and opaque scope identifiers. It never receives the unlocked document, private instruction, result or reasoning. The panel owner chooses the document/version and unlocks the folder manually. The private runner has no Brain, desktop, shell, connectors, messaging, attachments, routines, tool bridge or normal trace context. It makes one tool-free model request and persists only encrypted instruction/result/reasoning.

During authorised access, the server worker and selected model receive the selected document and instruction in plaintext. Revocation prevents subsequent access and discards in-flight output; it cannot withdraw content already received by the worker or provider. Provider-side retention policies still apply. This is encrypted storage with deliberate, temporary disclosure to an authorised processor, not computation on ciphertext.

Only the direct Ollama and OrcaRouter paths are supported for private sessions. CLI subscription harnesses are rejected before disclosure because they may persist prompts or session data on disk. There is no automatic fallback to a different provider or to a normal chat session. A provider error or an attempted tool call fails closed without exposing its raw error body.

The server that delivers the application and the browser/device remain trusted while unlocking. Compromised application JavaScript or a compromised host can observe authorised plaintext. JavaScript strings cannot be reliably zeroed; locks remove application references and visible content, while the runtime manages memory reclamation.

## Cryptography and storage

Each folder has an independently generated RSA-OAEP-3072/SHA-256 encryption pair and a P-256 signing pair. Only public keys and encrypted private-key bundles are stored on the server. A fresh random AES-256-GCM key and 96-bit nonce encrypt every document version. RSA-OAEP wraps that document key for its folder. Associated data binds folder, document id and version. Private-session results use a separate associated-data domain bound to the session id.

Each password or passkey independently wraps the same folder-private bundle with AES-256-GCM:

- Password: PBKDF2-HMAC-SHA-256, 600,000 iterations, independent 256-bit salt, fourteen-character enrollment minimum.
- Passkey: required user verification and WebAuthn PRF, followed by HKDF-SHA-256 with a Cora/folder domain. A normal passkey without PRF is refused. No PRF output or derived key is persisted.

Browser WebCrypto imports operational private and wrapping keys as non-extractable. Plain bundle references exist only within the mounted unlocked view to allow additional unlock methods; they are never written to local/session storage. Locking, leaving the folder, or five minutes of inactivity clears the view and its bundle reference.

The archive uses indexed SQLite tables `encrypted_folders`, `encrypted_documents`, `encrypted_requests`, `encrypted_inbox` and `encrypted_audit`. Titles and content belong inside ciphertext. Visible metadata includes resource ids, ownership, method labels/types, public keys, versions, sizes implicit in ciphertext, timestamps, operation and outcome. Each version is immutable. A compare-and-swap base version prevents silently replacing another update. Document payloads are limited to 2 MiB and a folder to 128 MiB of encrypted records; writes also preserve the existing 5 GiB free-disk reserve.

## Approval and revocation

An access request is bound to the authenticated person, agent, isolated session, folder revision, document/version, operation, model, model host and a ten-minute expiry. Only the folder owner may approve it, and that person must also own/manage the selected agent. Space administration grants no implicit folder access. Reading/analysis and an edit proposal are distinct operations; proposals do not overwrite a source document automatically. Export and sharing are separate, explicitly signed panel operations rather than model tools.

Unlock proof signs a server-issued sixty-second challenge with the decrypted folder signing key. The challenge binds the current person, folder revision, chosen wrapper metadata and exact operation. It is consumed once, including failed attempts. Eight failed proofs throttle new challenges for a minute. An audit method identifies the wrapper selected by the client; it is not an independent server-side WebAuthn authentication ceremony. Panel login establishes the person's identity.

Changing unlock methods invalidates pending and running grants. Removing the final method is refused. Turning the feature off cancels work and leaves encrypted archives readable by their owners. Ownership/admission and current configuration are rechecked before committing output. Interrupted runs are marked interrupted on startup and never resumed from persisted plaintext. A failed, expired or revoked request needs a fresh request and manual approval.

Removing a wrapper does not rotate the folder's underlying key or invalidate private material a person already obtained. Replacing a password therefore requires no document re-encryption. There is no recovery backdoor: losing every usable method loses the documents.

## Sharing

A recipient explicitly enables encrypted proposals on their own folder. The sender can see only that consenting folder's public encryption key and minimal recipient metadata. The browser decrypts the selected source, generates a new AES document key and encrypts a separate copy for the recipient's folder and allocated document id. The recipient must accept it before it enters their archive. Source credentials do not unlock the recipient's copy. Declining removes the encrypted inbox proposal. Public artifact links and plaintext artifact upload/download paths cannot serve these encrypted documents.

## Migration and disabling

Only a new empty artifact folder with no commits or share links can be enabled. There is no automatic import, bulk conversion or decryption of existing artifacts, messages or reasoning. Existing normal chats remain normal chats; instruction, answer and reasoning belonging to the isolated private session are stored encrypted together. There is no agent-content export to transport chat or file attachments.

The encrypted-only agent option removes shell, connectors, memory tools and file delivery from its regular tool list and rejects forced calls at execution. Global plaintext context documents are excluded from that agent's system prompt. The ordinary chat remains a place to request a private session, not an encrypted editor: users should enter confidential content only through the unlocked folder panel.

## API

All endpoints require the actual authenticated panel browser and the normal same-origin/X-Cora checks. External panel MCP calls cannot unlock or approve.

- `GET|PUT /api/encrypted/settings`: space feature state; only the space owner changes it.
- `GET|PUT /api/encrypted/agents/:id`: independent encrypted-only option, checked against agent ownership.
- `GET /api/encrypted/folders/:id`: own wrappers, public keys, ciphertext versions, request/inbox metadata and own audit.
- `POST .../configure`: initialise a new empty folder.
- `POST .../challenge`, `PUT .../methods`: scoped proof and wrapper management.
- `GET|POST .../documents`: exact ciphertext version / compare-and-swap encrypted save.
- `POST .../read`, `POST .../export`: signed explicit owner operations.
- `POST .../requests`, `GET|DELETE /api/encrypted/requests/:id`, `POST .../approve`: request, inspect/revoke, manually approve and run.
- `GET /api/encrypted/recipients`, `POST .../share`, `POST .../receive`: opt-in recipient discovery, separately encrypted proposal, accept/decline.

Audit rows contain person, method, folder/document/version, agent/session, operation and outcome. They do not contain passwords, private keys, derived keys, plaintext instructions, content or results.

## Verification and release gate

Integration tests use the real HTTP server, isolated owner accounts, WebCrypto and a synthetic HTTP model provider. They exercise owner/admin separation, ciphertext storage, wrong-password and tamper rejection, old versions, replay/scoping, separate-recipient encryption, revocation during processing, expiration, provider/tool refusal and process restart. Browser evidence must cover password and multiple PRF wrappers, reload, private processing, desktop/phone layouts and refusal followed by recovery.

Chromium's virtual CTAP2.1 authenticator proves the PRF protocol path. It does **not** establish physical-device or Hush-provider compatibility.

On 2026-11-11, Hush 0.8.1 was released and installed with its operating guide and explicit Playwright adapter on the Linux agent desktop, Mac Pro and Omarchy. Its encrypted persistent software authenticator supports RS256 and PRF. Independent Node verification accepts the actual assertion signatures and COSE registration public key; after a fresh broker process, the same PRF input decrypts previously saved ciphertext and the signature counter increases on all three installations. Foreign origins/RP IDs, unknown credentials, short challenges and invalid PRF credential mappings are refused.

The encrypted-space panel was exercised with the installed Hush release and adapter: password enrollment, encrypted document save, Hush passkey enrollment, reload, fresh PRF unlock, private synthetic-provider processing, complete browser/broker restart, decryption of the original document, passkey-wrapper revocation and password recovery. Desktop, 390px and 360px journeys pass without unexpected browser exceptions or failed requests. All eighteen screenshots were visually inspected. The synthetic provider verifies integration and storage boundaries; it is not a live external-model quality or retention test.

This establishes **Hush software-provider compatibility through the explicit adapter**, not native Chromium credential-manager, hardware, biometric, Bitwarden or synchronized-passkey compatibility. The adapter is opt-in and does not alter normal browser authenticators. Hush's UP/UV flags describe the authorized PIN-verified software session; they do not prove physical human presence. A release using hardware/native authenticators still needs that provider's actual PRF enrollment/restart/unlock evidence. The Hush PIN and credential share the local encrypted vault and do not create an independent security boundary against compromise of that vault or the OS account.

Hush is released; Cora's encrypted-space implementation remains on its separate review branch. No Cora production rollout is part of these test fixtures.
