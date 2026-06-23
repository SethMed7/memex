# memex template format

A template is a JSON file in `templates/<name>.json` that pre-configures a memex
for a specific product or use case. Pass it to `memex init` with `--template <name>`.

## Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Template identifier (matches filename, no spaces) |
| `description` | string | Short human-readable description shown after scaffold |
| `mode` | `"local"` \| `"open"` \| `"secure"` | Access mode. `local` = single user, no auth. `open` = multi-user, isolated, no auth. `secure` = RBAC + step-up auth. Omit to prompt. |
| `auth.stepUp` | string[] | Secure-mode factors, e.g. `["phone-code", "email-code"]`. Only used when `mode = "secure"`. Omit to prompt. Valid values: `phone-code`, `email-code`, `totp`, `webauthn`. |
| `primaryName` | string | Slug for the primary partition. Omit to prompt. Default: `"you"`. Only used when `mode` is `open` or `secure`. |
| `tier` | `"compact"` \| `"standard"` \| `"full"` | Recommended model tier for this use case. **Informational / reserved — not currently read** by `init` or `scan` (scan derives the tier from your hardware). Document-only for now. |
| `skipScanQuiz` | boolean | If `true`, skip the hardware scan prompt during `memex init`. **Consumed.** |
| `skipScanTier` | boolean | Intended to stop the scan from overriding the template's declared `tier`. **Reserved — not yet consumed**, and only relevant when `skipScanQuiz` is `false` (otherwise scan never runs). |
| `recommendedModels` | string[] | Cloud model slugs recommended for this template. **Printed in the post-init next-steps.** |
| `localModel.recommended` | string | Preferred local model slug (e.g. `"qwen2.5:14b"`). **Printed in the post-init next-steps.** |
| `localModel.minTier` | string | Minimum tier required for the local model to work well. **Printed** alongside `recommended`. |
| `apps` | (string \| {name, role})[] | Apps pre-registered in `memex.json` at init time — **this IS the registration; no separate `memex connect` is needed afterward.** Each entry is either a bare slug (`"breve"`) or `{ "name": "breve", "role": "message-platform" }`. The `role` is free text (e.g. `message-platform`, `chat-system`) stored on the app's `memex.json` entry. Names must be valid slugs (`[a-z0-9][a-z0-9-]{0,30}`); invalid names are skipped. Max 20 entries. |
| `postInit` | string[] | Lines printed as next steps after scaffold. Each becomes a `· <line>` bullet. Replaces the default next-steps block. |

## Example — breve.json

```json
{
  "name": "breve",
  "description": "Breve morning brief engine — message platform + Signal routing",
  "mode": "secure",
  "auth": { "stepUp": ["phone-code"] },
  "primaryName": "you",
  "tier": "full",
  "skipScanQuiz": true,
  "skipScanTier": true,
  "recommendedModels": ["claude-sonnet", "gemini"],
  "localModel": { "recommended": "qwen2.5:14b", "minTier": "standard" },
  "apps": [{ "name": "breve", "role": "message-platform" }],
  "postInit": [
    "Edit ~/breve/config.local.json → set knowledgePath to this directory",
    "Fill identities.local.json (gitignored) with phone/uuid for Signal auth — see the example",
    "memex status — confirm the handshake (id · contract · mode · apps)"
  ]
}
```

## Templates init a NEW memex — joining an existing one is `connect`

A template is for `memex init` (greenfield): it scaffolds a fresh memex and pre-configures `mode`,
the primary partition, and the `apps` registry. **`memex init` refuses a non-empty directory**, so a
template can't be applied to a memex that already exists.

To plug a **second app into an existing memex** — e.g. Rotli joining the brain Breve already uses —
don't init; **connect**:

```sh
cd ~/smBrain                       # the existing memex (or use --root <dir>)
memex connect rotli chat-system    # additive: stamps Rotli into memex.json, touches no other app
memex status                       # verify: id · contract · mode · apps now include rotli
```

`connect` is idempotent and strictly additive — it never re-inits, never changes the existing
`mode`/`users.json`, and never touches another app's data. The joining app then honors whatever
`mode` the memex is in (a `secure` brain still requires the app's step-up gate). This is why the
product templates declare a `role` but the **join** path sets it via `connect <app> <role>`.

## Notes

- Templates skip any prompt for fields they declare.
- `mode`, `auth.stepUp`, and `primaryName` are the three interactive prompts a template can suppress.
- `primaryName` is only used (and only prompted for) when `mode` is `open` or `secure`.
- `skipScanQuiz: true` is recommended for product templates so users aren't asked about hardware during automated setup.
- All fields are optional. A minimal template can supply only `name`, `description`, and `postInit`.
- Template names must not contain `/`, `\`, or `.` characters. The CLI enforces this to prevent path traversal.
