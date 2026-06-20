# CONFIG — the control panel

memex is **configurable**: its rules, policies, and permissions are *your* knobs, set in config — not
hardcoded. This is the index of every knob and the law for adding more. Tools that plug in register
their knobs here too.

## What memex is — and isn't

memex is a **structure** plus a thin **configuration** layer — nothing more. Outside the structure it
holds exactly **three config concerns**, each with a deterministic engine (no LLM calls — Rule #9):

1. **How each model uses the structure** — `clients/models.json` (+ `scripts/client.ts`): per-model
   context-pack sizing/shape; and `clients/capabilities.json`: what each model *can't* do natively
   (pdf/image/web/…) — the memex only declares, the connected app fulfills. Add a model = one entry.
2. **Your settings** — `memex.local.json` (+ `scripts/mounts.ts`): `assetsPath`, `mounts`, instance wiring.
3. **Self-mapping + improvement (model-aware)** — `MAP.md` (+ `scripts/organize.ts` / `links.ts`) and
   `clients/learning/<model>.md` (+ `scripts/learn.ts`). This is **core**: a connected app *inherits*
   mapping + self-improvement by pointing at the memex — it does **not** rebuild them.
4. **Tenancy — who the structure is partitioned for** — `users.json` (+ `scripts/users.ts`): the named
   knowledge partitions ("users") this memex holds and the declared access policy (admin spans all,
   members siloed). memex **declares**; the connected app **enforces** at runtime. **Single-tenant by
   default** (no `users.json` ⇒ one implicit default user at the repo root). Holds no identity/phone
   data — that binding lives in the connected app.

Everything else — feature logic, fetching, sync, UX — lives in the **connected app** (Breve, Rotli),
never here. (Example: the resources *registry* is config here; the *fetching* is Breve's.) The `scripts/`
are only the engines of those three concerns + structure validation (`validate.ts`) and the conversation
write-contract (`conversations.ts`). memex doesn't grow feature scripts.

## Speaking to the config (connected apps, e.g. Rotli's UI)

The config files **are the API** — there's no separate endpoint. An app manages memex by reading and
writing them per their schema + the Configuration Rule below, then running `scripts/validate.ts`.
The frozen, contract-versioned subset an **external app** (separate repo) may depend on is listed in
`STRUCTURE.md` → "For external apps (separate repos)"; those keys change only at a contract MAJOR bump.

- **User instance wiring** → `memex.local.json` (gitignored): `assetsPath`, `mounts`. A Rotli "manage
  mounts" screen edits this file; resolve the result via `scripts/mounts.ts` (`listMounts`/`resolveMount`).
- **Shared/committed config** → `clients/models.json` (model rules), `clients/resources.json` (sources).
- **Rules:** follow the schema; keep secrets out (Keychain only); validate after writing; resolve paths
  via the layer's resolver, never hardcode. The app owns the **UX**; memex owns the schema, the rules,
  the validation, and the mapping/learning the app **inherits** (via `client.ts` / `learn.ts`).

## The Configuration Rule

Read this before adding or changing config — the law that keeps a memex easy to manage and build on:

1. **Knob, not constant.** Anything reasonably variable is a config knob; defaults in code, override in config.
2. **Safe by default.** Defaults are conservative; the *unknown* case degrades to the most-constrained safe option.
3. **One file per concern, named clearly.** A setting lives in one named file — never scattered/duplicated.
4. **Secrets are never config.** Secrets/PII never in committed config — use your OS keychain/secret store and
   gitignored `*.local` files (with committed `*.example`). Committed config is always safe to share.
5. **Resolve, don't hardcode paths.** Tools read logical roots from `STRUCTURE.md`, never hardcoded deep paths.
6. **Index every knob here.** Add a knob → add a row below. An undocumented knob is a bug.
7. **Validate the load-bearing.** If breaking a config breaks the memex, add a check to `scripts/validate.ts`.
8. **Local-first & versioned.** Changes are commits; bump `STRUCTURE.md`'s version + log in `CHANGELOG.md` on contract changes.
9. **The memex makes no LLM calls.** It holds only the *configuration* for how an LLM talks to it (the client
   layer). Reasoning, drafting, distilling, integrations — done by whoever talks to it, never by the memex.
   `scripts/` are deterministic; `validate.ts` flags any LLM call that sneaks in.

To extend: pick the concern's file (or add one), give it a safe default in code, expose the override, add the
row below, validate if load-bearing, commit. That's the whole ritual.

## The knobs

| Concern | Where | What you control |
|---|---|---|
| **Per-model rules** | `clients/models.json` | context window, brain budget, tier, `agentic`, structured-output per model. Add a model = one JSON entry. Unknown → safe default. |
| **Model capabilities** | `clients/capabilities.json` | what each model CAN'T do natively (pdf/image/web/…); the memex only declares, the connected app fulfills (or alerts if unconfigured). Add a model = one entry; unknown → lacks-everything safe default. |
| **External resources (fetch-from)** | `clients/resources.json` | curated external sources a connected app may fetch + the per-source guards it fetches under (host, https-only, no-private-IP, same-host-redirect, timeout/byte/char caps, `cadence`, processing `tier`, `favorite`, `trust`). The memex only HOLDS the list + guards; the connected app does the fetching (Rule #9). Add a source = one entry; omitted field → most-constrained `default`. Favoriting changes ordering only, never trust/tier/reach. |
| **Self-improving layer** | `clients/models.json` → `learning` (+ `clients/learning/<model>.md`) | per-model playbooks: `enabled`, `dir`, `maxKb` (how much rides along in a pack). Off → no playbooks. Grown/healed by the model via `scripts/learn.ts`; folded into packs by `client.ts`. |
| **Findability** | `clients/models.json` → `findability` (+ `scripts/links.ts` defaults) | bidirectional backlinks rendered into `MAP.md` (`organize.ts`), orphan-note + unlinked-mention warnings (`validate.ts`), `aliases:` participation, grace days / exempt files+tags, mention min-length + stopwords + scan scope. Backlinks are GENERATED (not configured); the `aliases:` key is fixed. Off → pre-v3 behavior. |
| **Layout contract** | `STRUCTURE.md` | the logical roots + conventions every tool resolves against; versioned. |
| **Asset sync** | `ASSETS.md` | the `storage:` convention (text here, binaries elsewhere). |
| **Asset store location** | `memex.local.json` → `assetsPath` (or `$MEMEX_ASSETS`) | the canonical `assets` mount — where `storage:` binaries live: a sibling, an external/object-store/Drive path, **or a subtree inside the memex**. A pure path choice (no functional difference); binaries are allowed under this root wherever it sits. Default sibling `../<dir>-assets`. Gitignored (instance wiring); gitignore the subtree if you point it in-tree. |
| **Mounts** | `memex.local.json` → `mounts` | named folders pointed at any path (inside / sibling / external / a synced Drive), each with policy: `external` (opaque + offline-tolerant — the memex resolves the path but doesn't validate or sync it; its backend owns sync/conflicts/permissions), `media` (binaries allowed), `git` (track in-tree / ignore for external). Resolve via `scripts/mounts.ts`; `assets` is the canonical mount. A tool — or Claude Code pointed at the memex — writes a project's docs into its mount (e.g. a Drive folder a team co-manages), not a project repo. |
| **What's indexed** | `MAP.md` + each note's `summary:` | the always-loaded spine. |
| **Write permissions** | `STRUCTURE.md` → Conversations/Ownership | who writes where; enforced by `conversations.ts` + `validate.ts`. |
| **Tenancy / partitions** | `users.json` (committed) (+ `scripts/users.ts` / `scripts/mounts.ts`) | the isolated knowledge partitions ("users") this memex holds: each `name` (fs-safe slug), `role` (admin\|member), `path` (`users/<name>`, or `""` for the primary), and the single `primary`. The resolver derives the spine per partition (`userRoot`/`knowledgePath(user)`/…). **No `users.json` ⇒ single-tenant** (one implicit default user at the repo root — the safe default, Rule #2; unknown name → error, never a cross-partition read). Manage with `bun scripts/users.ts add\|list\|remove\|init-primary` (pure file ops). |
| **Access policy** | `users.json` → `role` + `primary` | memex **declares** that the admin/primary partition may span all partitions while members are siloed; it does **not** enforce it. The **connected app** (e.g. Breve) enforces this at runtime — memex's job is the registry + per-user roots + validation, never runtime authz, and it stores no identity/phone bindings. |

**Resources vs references.** A **reference** (`wiki/reference/*.md`) is durable knowledge you *keep* — trusted, read, never fetched. A **resource** (`clients/resources.json`) is a live external source you *fetch from* — config, untrusted on arrival. *A reference is what you know; a resource is where you go.* They join by the note's `source:` URL and the resource entry's `reference:` slug; one source can be both (the note describes it, the entry governs the guarded fetch). Favoriting applies only to resources, as an ordering knob.

*Tools you connect (a message platform, a chat system, …) add their own knobs as their own JSON config files
and list them here. Keep secrets out — keychain + gitignored `*.local`.*
