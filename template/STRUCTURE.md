# Structure contract (v3.3)

The **single source of truth** for how this memex is laid out and how tools read it. Any assistant
or tool **resolves the logical roots below** instead of hardcoding deep paths — so the structure can
evolve without breaking what's built on it. memex is **local-first**: there's no "push an update," so
this contract changes deliberately and is versioned (bump the version + log in `CHANGELOG.md`).

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
