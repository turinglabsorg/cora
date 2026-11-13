# Artifact publication by level

Open an artifact path level such as `crm`, then choose **Settings** in its section rail. **Agent publication** offers **Inherit**, **With review** and **Publish immediately**. Changes save immediately.

The rule applies to the owner's existing and future descendant folders. A nearer level rule takes precedence. A folder can explicitly choose review or direct publication in its Settings, or return to inheritance. With no inherited rule, the folder retains its original policy; resetting a folder override falls back to review. Existing proposals still require review.

Publication policy does not grant upload access. Select allowed agent writers in the folder's Permissions. Other owners' folders, sibling paths, sealed folders and encrypted-folder workflows are unaffected. Only the owner can set publication policy; reviewers and read/write recipients cannot.

Existing folders previously set to Publish immediately retain that explicit owner choice when this feature is installed. New folder creation offers Inherit by default, With review or Publish immediately; either explicit choice overrides the parent rule.

`PUT /api/artifacts/level/settings?path=<level>` accepts `{ "policy": "direct" }`, `{ "policy": "review" }` or `{ "policy": null }`. The level GET returns the saved rule and its effective source. Folder views expose the effective `policy`, `localPolicy`, `policyOverride` and `policyLevel`.

