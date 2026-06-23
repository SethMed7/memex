# Structure contract (v3.4)

The **single source of truth** for how this memex is laid out and how tools read it. Any assistant
or tool **resolves the logical roots below** instead of hardcoding deep paths — so the structure can
evolve without breaking what's built on it. memex is **local-first**: there's no "push an update," so
this contract changes deliberately and is versioned (bump the version + log in `CHANGELOG.md`).

## Instance identity & plug-in (v3.4)

Each memex has a committed `memex.json` identity card: a stable `id` (`mx_…`, generated at
`memex init`), the `contract` it was created against, and an **additive `apps` registry**. This is how
multiple apps share one memex **without breaking each other**:
- An app PLUGS IN — it never re-inits or clobbers. `memex connect <app> [role]` (or
  `scripts/mounts.ts` `connectApp`) generates the `id` if missing and **merges** the app's own entry,
  touching no other app's data; `memex init` refuses a non-empty dir. So Rotli can attach to a live
  Breve memex purely additively.
- An app PINS to `memexId()` (so a swapped/wrong memex is noticed) and calls `requireContract()`
  (`CONTRACT_VERSION`) before relying on the structure — fail loud on a mismatch, not silent corruption.
- Boundaries that keep apps from colliding: each app writes only its own surface (`conversations.ts`
  ownership), reads shared policy/handles/model-rules read-only, and registers its own config as its
  own file. **You never edit one app's files to make another work.**

### Durability & delete-safety

- **Self-heal** (`scripts/heal.ts` · `heal`/`ensureHealthy`): recreates ONLY what's MISSING (data dirs
  + each partition's spine, from the data-free skeleton) — **never overwrites or deletes** an existing
  file. Idempotent. An app heals on plug-in/startup ("rebuild what it needs"); `memex heal [--dry]` is
  on-demand. Gated by `memex.json` `selfHeal` (default true) — *the whole thing is configurable*. So a
  manual edit / partial loss self-repairs without touching your content.
- **No app hard-deletes.** "Delete" = `trash(path)` → moves into `trash/` (reversible). The PROTECTED
  structure (the spine dirs + contract files) is **un-trashable** — the main structure can't be
  removed by any app. The OS sandbox additionally blocks the model tier from reaching the repo root /
  other partitions. **Only the operator truly deletes**, via `memex purge --confirm` (or by hand) —
  nothing is ever lost without your hand.

## Logical roots (what tools resolve)

The knowledge roots resolve **per user** (see *Tenancy* below). Single-tenant (no `users.json`) ⇒ one
implicit default user whose root **is** the repo root, so the paths are exactly as shown.

| Root | Path | Meaning |
|------|------|---------|
| `repoRoot` | the memex dir | the distribution: shared `scripts/` + contracts + `clients/` + `users.json`. Never moves. |
| `usersRegistry` | `users.json` | (multi-tenant only) declares the knowledge partitions + the `primary`. Resolve via `scripts/mounts.ts` (`registry` / `userRoot` / `listUsers`). |
| `knowledgePath(user?)` | `userRoot(user)` — `users/<name>/` (or the repo root for the primary / single-tenant) | the knowledge base for that partition |
| `selfPath(user?)` | `userRoot(user)/self/` | the whole-person / whole-entity layer |
| `wikiPath(user?)` | `userRoot(user)/wiki/` | focused, linked notes |
| `historyPath(user?)` | `userRoot(user)/history/` | by-day conversation stream (message-platform shape) |
| `chatsPath(user?)` | `userRoot(user)/chats/` | named, attachable conversations (chat-system shape) |
| `inboxPath(user?)` | `userRoot(user)/inbox.md` | capture zone |
| `mapPath(user?)` | `userRoot(user)/MAP.md` | the index/spine |
| `clientsPath` | `clients/` (repo root, **shared**) | client layer — per-model rules (install-level, not per-user) |
| `learningPath` | `clients/learning/` | self-improving layer — one playbook per model (`<model-slug>.md`), shared across partitions |
| `assetsPath` | (configurable) | the canonical **assets** mount — where `storage:` binaries live. Inside or outside; a path choice, not a functional one. |
| `mounts` | `memex.local.json` → `mounts` | named folders pointed at any path (inside, sibling, external, or a synced Drive), each with policy (`external`/`media`/`git`). Resolve via `scripts/mounts.ts`. |

## Layout

```
<memex>/                  TEXT ONLY (markdown + small deterministic scripts). No binaries, ever.
  README.md  STRUCTURE.md  CONFIG.md  ASSETS.md  CHANGELOG.md
  users.json              (multi-tenant only) the partition registry
  clients/models.json     client layer — per-model rules (SHARED, install-level)
  clients/resources.json  client layer — external sources to fetch from + per-source fetch guards
  clients/learning/<model-slug>.md   self-improving layer — one playbook per model (shared)
  archive/  trash/        retired (kept) · soft-deleted (purgeable)
  scripts/                deterministic tooling: validate · organize · conversations · client · learn · links · users (NO LLM calls)
  scripts/user-skeleton/  the data-free spine copied when a partition is added

  # single-tenant (no users.json): the knowledge spine lives at the repo root —
  self/  wiki/  history/<YYYY>/<YYYY-MM-DD>.md  chats/<slug>.md  inbox.md  MAP.md

  # multi-tenant (users.json present): the spine lives PER PARTITION —
  users/<name>/{ self/  wiki/  history/  chats/  inbox.md  MAP.md }
  # (the primary partition may stay flat at the repo root with path "" until migrated)
```

## Conventions

- **Text-only spine.** The knowledge tree is `.md`. Binaries live under a configured **media mount**
  (the `assets` store, inside or outside) referenced with `storage:` — see `ASSETS.md`. Outside any
  media mount the tree stays text-only.
- **Mounts.** Any logical folder can be pointed at any path via `memex.local.json` → `mounts` — inside,
  a sibling, or an external/synced location (a Drive a team co-manages). Per-mount policy: `external`
  (opaque + offline-tolerant — the memex resolves the path but doesn't validate or sync it; its backend
  owns sync/conflicts/permissions), `media` (binaries allowed), `git` (track in-tree / ignore for
  external). Resolve via `scripts/mounts.ts`, never a hardcoded path (Rule #5). `assets` is the canonical mount.
- **Note shape** — every `wiki/` note opens with frontmatter and closes with links:
  ```
  ---
  summary: one line an LLM reads to decide relevance without opening the file
  aliases: [Other Name, ABBR]   # optional — extra names this note is findable/linkable by
  tags: [topic]
  updated: YYYY-MM-DD
  ---
  # Title
  …body…
  ## Related
  [[other-note]]
  ```
  `self/` files stay prose-first but carry a one-line summary near the top so MAP can index them.
- **`aliases:`** *(optional, key name fixed)* — extra names a note answers to, so `[[Other Name]]`
  resolves to it and it's caught when mentioned in plain prose. Inline bracket-list form ONLY
  (`aliases: [A, B]`, like `tags:`); the multi-line YAML list form is not supported. Two notes
  declaring the same alias → a `validate.ts` warning (the duplicate-concept smell).
- **`[[wikilinks]]`** link notes by filename (no extension), and now run **two ways**: `organize.ts`
  renders inbound **backlink trails** into `MAP.md` (`… ← [[src]]`) so a trail is followable from both
  ends (Vannevar Bush's associative trails). `validate.ts` flags dangling links (alias-aware), **orphan
  notes** (nothing links to them) and **unlinked mentions** (a title in plain prose, never `[[linked]]`).
  All deterministic — the memex only FLAGS; the model decides what to link. See `scripts/links.ts`.
- **Conversations, two shapes** (so a *message platform* and a *chat system* both fit):
  - **Timeline** — `history/<YYYY>/<YYYY-MM-DD>.md`: a continuous stream bucketed by day.
  - **Named chats** — `chats/<slug>.md`: titled conversations with a stable `id`, a `source`, and an
    optional `attachedTo: [[note]]` so any object can carry a chat. They cross-link.
  - **Ownership / no bleed:** a tool writes ONLY its own surface (message platform → `history/`, chat
    system → `chats/`); both READ across both + the shared notes. Enforced by `scripts/conversations.ts`.
- **Lifecycle:** `inbox.md` (capture) → filed into `self/`/`wiki/`/`history/` → `archive/` → `trash/`.
- **Tenancy (multi-user).** A memex is single-subject **by default** (no `users.json` ⇒ one implicit
  default user at the repo root — the safe default). It can hold several **isolated knowledge
  partitions** ("users") under `users/<name>/`, each a full spine of its own — a *person* OR a
  *topic-persona* of the same human (e.g. `seth-marketing`). Declared in the committed `users.json`
  registry (`name`, `role` admin|member, `path`, the single `primary`). Manage with
  `bun scripts/users.ts add|list|remove|init-primary` (pure file ops). Resolve a partition with
  `userRoot(name)` / `knowledgePath(name)`; **never** hardcode `users/<name>/…`. memex only
  **declares** partitions and the access policy (admin spans all, members siloed) — a **connected app
  enforces** who may reach which at runtime (memex makes no LLM calls and holds no identity/phone
  data). `clients/` and the contracts stay shared at the repo root; only the knowledge spine is
  per-partition, and each partition validates/indexes/packs in isolation (no cross-partition bleed).

## Memory model (model-aware)

- **Always-loaded spine:** `self/` + `MAP.md` (summaries + links). A large-context model reads the map
  each session and decides what to deep-read. `MAP.md` also carries **two-way trails** (inbound
  backlinks per note) and the **Orphans** + **Unlinked mentions** dashboards, so the spine surfaces
  findability gaps without running a tool (`scripts/links.ts` via `organize.ts`).
- **On-demand depth:** full `wiki/` notes + `history/` dailies, reached by following `[[links]]`/MAP
  (in either direction — trails run both ways now).
- **Client layer** (`clients/models.json` + `scripts/client.ts`) sizes a context pack to each model:
  agentic models get the spine and roam; non-agentic local models get a pre-assembled pack trimmed to
  their window. Unknown model → most-constrained safe default. See `CONFIG.md`. The client layer also
  carries `clients/resources.json` — the external sources a connected app may fetch from and the guards
  it must fetch under. The memex holds the list + rules; it never fetches (Rule #9). A **resource** (a
  source you fetch from) is config; a **reference** (`wiki/reference/`) is knowledge you keep — they join
  by the note's `source:` and the entry's `reference:` slug.
- **Self-improving layer** (`clients/learning/` + `scripts/learn.ts`) — on top of the client layer.
  Each model keeps a **playbook** that `client.ts` folds back into its pack, so a model gets its map
  **plus what it has already learned**. As the model works it records heuristics (`learn add`) and heals
  mechanical drift it finds (`learn heal` → write missing summaries, fix dangling links). All
  model-driven; the memex itself makes no LLM calls — it only stores and re-serves the learnings.

## For tool authors

Resolve the logical roots; never hardcode deep paths. Resolve named **mounts** (storage roots, external/
Drive folders) via `scripts/mounts.ts` (`resolveMount` / `listMounts`) — a tool, or Claude Code pointed
at the memex, writes docs into a declared mount (e.g. a Drive folder a team co-manages), never a hardcoded
path or a project repo. Record conversations via `scripts/conversations.ts`
(`appendDaily` / `writeChat` / `capture`); read across with its helpers. Size context with
`scripts/client.ts` (`contextPack`) — which already folds in the model's playbook. Let a model improve
itself with `scripts/learn.ts` (`mapFor` / `learn` / `heal`). For links/aliases use the shared
**`scripts/links.ts`** — the single canonical wikilink regex + `prose()` strip + alias-aware
`resolveTarget` + the backlink/orphan/mention passes (`buildNoteRecords` / `buildBacklinkIndex` /
`mentionTermsFor` …); never re-declare a wikilink regex. Run `scripts/validate.ts` to confirm
invariants. **Adding config?
Follow the Configuration Rule in `CONFIG.md`** — and note: **the brain itself makes no LLM calls**; it
only holds the configuration for how a model talks to it.

## For external apps (separate repos)

A tool author *imports* these engines. An **external app in its own repo** (Breve, Rotli, …) usually
*cannot* — the memex is a sibling repo resolved by path at runtime and may be absent or a drifted copy,
so coupling the app's boot to `import`ing this engine is forbidden (it would crash the app when the
memex is missing). For those apps the stable cross-app contract is the **FILE FORMAT**, frozen here and
versioned by the contract version (`memex.json.contract` / `CONTRACT_VERSION`). These names change ONLY
with a contract **MAJOR** bump (the one thing an external app's startup handshake must gate on);
everything else — function signatures, internal script names, the `organize` / `links` / `learn`
internals — is **internal and may change at a minor bump**.

- **`users.json`** — keys `primary`, `mode` (`local` | `open` | `secure`), `auth.stepUp`, and
  `users[].{name, role, path, powers}`.
- **`identities.local.json`** (optional, gitignored, PII) — shape `name → { phone, uuid, email }`.
- **`memex.json`** — keys `{ id, contract, apps }`.
- **Spine directory + file names** (frozen — MAJOR-only) an app may path-join under a partition root: the
  dirs `self/`, `wiki/`, `history/`, `chats/` and the files `inbox.md`, `MAP.md`; plus `clients/` at the
  repo root. Tools resolve these via `scripts/mounts.ts` (`selfPath`/`wikiPath`/…); the *names* are a stable
  part of the contract, so a rename like `wiki/`→`notes/` is a MAJOR-bump event, never a silent minor drift.
- **`scripts/users.ts` CLI verbs** — `add` | `list` | `remove` | `init-primary` | `mode`. An app that
  shells out to the engine (`bun <base>/scripts/<name>.ts`) may also rely on `heal.ts`, `validate.ts`,
  and `client.ts` (`contextPack`) existing under `scripts/` with that invocation form.

(See `CONFIG.md` — "The config files ARE the API". An external app must NOT `import` these engine
scripts; it reads/writes the files above, and pins the contract MAJOR.)
