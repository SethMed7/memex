# Structure contract (v2)

The **single source of truth** for how this memex is laid out and how tools read it. Any assistant
or tool **resolves the logical roots below** instead of hardcoding deep paths — so the structure can
evolve without breaking what's built on it. memex is **local-first**: there's no "push an update," so
this contract changes deliberately and is versioned (bump the version + log in `CHANGELOG.md`).

## Logical roots (what tools resolve)

| Root | Path | Meaning |
|------|------|---------|
| `knowledgePath` | the memex dir | the knowledge base (this folder) |
| `selfPath` | `self/` | the whole-person / whole-entity layer |
| `wikiPath` | `wiki/` | focused, linked notes |
| `historyPath` | `history/` | by-day conversation stream (message-platform shape) |
| `chatsPath` | `chats/` | named, attachable conversations (chat-system shape) |
| `inboxPath` | `inbox.md` | capture zone |
| `mapPath` | `MAP.md` | the index/spine |
| `clientsPath` | `clients/` | client layer — per-model rules |
| `learningPath` | `clients/learning/` | self-improving layer — one playbook per model (`<model-slug>.md`) |
| `assetsPath` | (configurable) | where binaries live — the `storage:` root. **Text-only here; binaries go there.** |

## Layout

```
<memex>/                  TEXT ONLY (markdown + small deterministic scripts). No binaries, ever.
  README.md  STRUCTURE.md  CONFIG.md  ASSETS.md  CHANGELOG.md  MAP.md  inbox.md
  self/                   00-identity … 11-timeline (slow-changing whole-person layer)
  wiki/                   projects/ research/ reference/ people/ _templates/  (focused [[linked]] notes)
  history/<YYYY>/<YYYY-MM-DD>.md   conversation stream by day (message-platform shape)
  chats/<slug>.md         named, attachable conversations (chat-system shape)
  clients/models.json     client layer — per-model rules
  clients/learning/<model-slug>.md   self-improving layer — one playbook per model
  archive/  trash/        retired (kept) · soft-deleted (purgeable)
  scripts/                deterministic tooling: validate · organize · conversations · client · learn (NO LLM calls)
```

## Conventions

- **Text-only.** Knowledge is `.md`. Binaries (png/jpg/mp3/mp4/pdf…) NEVER live here — see `ASSETS.md`.
- **Note shape** — every `wiki/` note opens with frontmatter and closes with links:
  ```
  ---
  summary: one line an LLM reads to decide relevance without opening the file
  tags: [topic]
  updated: YYYY-MM-DD
  ---
  # Title
  …body…
  ## Related
  [[other-note]]
  ```
  `self/` files stay prose-first but carry a one-line summary near the top so MAP can index them.
- **`[[wikilinks]]`** link notes by filename (no extension). Dangling links are flagged by `validate.ts`.
- **Conversations, two shapes** (so a *message platform* and a *chat system* both fit):
  - **Timeline** — `history/<YYYY>/<YYYY-MM-DD>.md`: a continuous stream bucketed by day.
  - **Named chats** — `chats/<slug>.md`: titled conversations with a stable `id`, a `source`, and an
    optional `attachedTo: [[note]]` so any object can carry a chat. They cross-link.
  - **Ownership / no bleed:** a tool writes ONLY its own surface (message platform → `history/`, chat
    system → `chats/`); both READ across both + the shared notes. Enforced by `scripts/conversations.ts`.
- **Lifecycle:** `inbox.md` (capture) → filed into `self/`/`wiki/`/`history/` → `archive/` → `trash/`.

## Memory model (model-aware)

- **Always-loaded spine:** `self/` + `MAP.md` (summaries + links). A large-context model reads the map
  each session and decides what to deep-read.
- **On-demand depth:** full `wiki/` notes + `history/` dailies, reached by following `[[links]]`/MAP.
- **Client layer** (`clients/models.json` + `scripts/client.ts`) sizes a context pack to each model:
  agentic models get the spine and roam; non-agentic local models get a pre-assembled pack trimmed to
  their window. Unknown model → most-constrained safe default. See `CONFIG.md`.
- **Self-improving layer** (`clients/learning/` + `scripts/learn.ts`) — on top of the client layer.
  Each model keeps a **playbook** that `client.ts` folds back into its pack, so a model gets its map
  **plus what it has already learned**. As the model works it records heuristics (`learn add`) and heals
  mechanical drift it finds (`learn heal` → write missing summaries, fix dangling links). All
  model-driven; the memex itself makes no LLM calls — it only stores and re-serves the learnings.

## For tool authors

Resolve the logical roots; never hardcode deep paths. Record conversations via `scripts/conversations.ts`
(`appendDaily` / `writeChat` / `capture`); read across with its helpers. Size context with
`scripts/client.ts` (`contextPack`) — which already folds in the model's playbook. Let a model improve
itself with `scripts/learn.ts` (`mapFor` / `learn` / `heal`). Run `scripts/validate.ts` to confirm
invariants. **Adding config?
Follow the Configuration Rule in `CONFIG.md`** — and note: **the brain itself makes no LLM calls**; it
only holds the configuration for how a model talks to it.
