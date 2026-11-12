# Encrypted artifacts and conversations

Folder decryption and signing keys stay in the unlocked browser. Password/passkey wrappers and explicit recipient grants contain encrypted bundles only. The server persists public keys, ciphertext, ids, operational attribution and size/timing metadata. This protects storage; the server application, browser, device and explicitly authorized model remain trusted during processing.

## Files

The encrypted Files rail supports ordinary file and directory selection, Unicode relative paths, exact binary bytes, empty files, immutable versions and ZIP export. Empty directories are omitted. The limit is 64 MiB per file, 128 MiB of serialized ciphertext per folder including retained versions and pending uploads, and 500 documents/conversations per folder. Double base64 framing adds overhead, so raw capacity is lower than ciphertext capacity. Previews support text and PNG/JPEG/WebP/GIF up to 1 MiB; other files download without executing their contents.

The browser encrypts 512 KiB chunks under fresh envelope keys, with folder/upload/chunk-bound AAD. Encrypted metadata holds path, MIME, modification time, length and SHA-256. Publication is atomic after all chunks arrive and the current base version is proven. Completion can be replayed idempotently; conflicting chunks and stale versions are refused. Cancellation and 15-minute pending-upload expiry remove only unpublished chunks. Finished files remain immutable. Exact-byte recovery verifies size, AAD and SHA-256. An explicit folder deletion removes its ciphertext; independently delivered copies remain with their recipient.

## Team permissions and encrypted delivery

Native member and inherited level permissions remain authoritative. Permission alone does not expose a key or enable encrypted reads. The owner must separately deliver an encrypted bundle to the recipient's opted-in personal encrypted folder; the recipient unlocks that folder and explicitly accepts. Source password/passkey wrappers are never returned to recipients. Read access disables new document/conversation saves, uploads and further sharing. Write access allows those operations. Only the folder owner changes unlock methods or grants. Ordinary public-link routes and plaintext agent uploads remain refused.

Every read, chunk fetch, proof, upload and completion checks the acting account and current grant/permission. Revocation blocks future server access and rejects interrupted output. It cannot retrieve a previously obtained key, ciphertext or exported plaintext; removing a grant is not cryptographic key rotation. Separately encrypted file copies include all chunks and require recipient acceptance; rejection cleans their unpublished storage.

## Conversations and reasoning

Agent Chat offers an encrypted-folder selector. The folder's Conversations rail supports multiple independent histories, title/agent selection, multi-turn messages, encrypted reasoning and reload recovery. This is an explicit private panel path; existing ordinary threads and Discord/Slack/Telegram messages are not migrated or secretly converted.

Each send first persists the user turn encrypted, then explicitly authorizes a bounded model request. The worker receives selected plaintext temporarily, has no tools, desktop, memory or messaging access, and encrypts the response/reasoning to the folder's public key. Only direct Ollama and OrcaRouter models are supported. CLI subscriptions and provider fallback remain refused. The conversation limit is 1 MiB/200 messages. Reasoning is stored encrypted but is not replayed as model conversation content.

Lock, navigation and inactivity clear local drafts/previews and revoke pending browser-owned work. Revocation/expiry and process interruption discard incomplete model output. A completed encrypted response survives a browser interruption; the recovery action can attach it to the unchanged conversation version. Version conflicts preserve the encrypted response in Access rather than overwriting a newer conversation. No response is sent into ordinary channel history or traces.

## Agent file access and policy

Temporary file analysis currently accepts editor documents and UTF-8 text files up to 1 MiB, bound to the exact selected version. Arbitrary binary storage does not imply arbitrary binary model analysis. Every approval discloses the worker/provider boundary and expires after ten minutes. The model provider's retention remains its own responsibility.

The existing global requirement is forward-only: new plaintext writers are refused, historical plaintext remains available under its permissions with a warning, and no historical conversion/deletion is automatic. The actual policy switch is not changed by deployment. Native Chrome Password Manager coverage must be reported independently from real Bitwarden and synthetic authenticator tests.

## Password managers and trusted browsers

Enrollment and unlock forms supply an explicit folder-specific username to password managers. Passkey enrollment supplies a readable folder/method name with a unique suffix; existing credentials keep their original identity and derivation. Passwords are tried against the folder's current password wrappers locally. Passkeys remain explicit actions without a method dropdown.

Remember access is optional and off by default. In secure contexts with IndexedDB, the browser stores the password, or the passkey-unlocked personal key bundle, encrypted with a non-extractable AES-GCM key in its own origin storage. Records are bound to the signed-in account, personal folder and the exact current wrapper. No remembered password, private bundle or local key is sent to Cora. Reload can refill the password or offer Open folder for remembered passkey access; unlocking still requires an explicit action and fresh server permission/proof checks. Lock clears active document/key state; Forget access deletes the saved browser record, and Sign out clears that account's records, including saves already in flight in another tab. Missing/changed methods and tampered records are discarded. Storage denial leaves normal password/passkey unlock usable.

The local key and ciphertext live on the same trusted device. This is convenience against repeat typing, not protection against a compromised browser, same-origin script or device user. Private/incognito browser retention is controlled by the browser. It is not cloud synchronization, and clearing browser storage removes it.
