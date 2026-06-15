<div align="center">

![memex — your knowledge, structured](assets/banner.png)

[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-text%20only-0c0e1a)](#principles)
[![Runtime](https://img.shields.io/badge/Bun-zero%20deps-0c0e1a)](https://bun.sh)
[![Security](https://img.shields.io/badge/security-no%20LLM%20calls%20%C2%B7%20no%20secrets-6366f1)](SECURITY.md)

</div>

## The name

In 1945, Vannevar Bush imagined the **memex** — a "memory extender": a desk where a person keeps all
their books, records, and notes and links them by *associative trails*, so anything can be found later
by following connections. It's the idea every "second brain" descends from. This is that idea, rebuilt
for the age of AI assistants: **a personal memory your models can actually read.**

## What it is

> **memex is a local-first, text-only knowledge + memory structure that any AI assistant can plug into.**

Plain markdown on your disk — no cloud, no database, no lock-in. memex isn't an app and isn't tied to
any one model; it's the **structure** and the **rules** for how a model talks to your knowledge. Bring
your own assistant.

What makes it more than a folder of notes:

- **A model-readable index.** Every note carries a one-line summary; `MAP.md` is the always-loaded
  spine an assistant reads first to decide what to open — so a 1M-context model and an 8k local model
  each get a right-sized view.
- **A conversation record.** Two surfaces — a by-day stream and named, attachable chats — let a message
  platform and a chat system both write history without bleeding into each other.
- **A configuration layer.** Every rule, policy, and permission is a knob you own (`CONFIG.md`), and a
  per-model client layer (`clients/models.json`) adapts the whole thing to whatever model is reading it.
- **A self-improving layer.** Each model keeps a playbook that's folded back into its context every
  session — so it gets its map *plus what it has already learned*, and heals drift it finds as it works.
- **Two-way trails.** Bush's idea was *associative trails* you could walk in either direction — so here
  `[[links]]` run both ways. Every note shows what it links *to* and what links *back*, aliases let a note
  be found under more than one name, and the validator surfaces orphans and unlinked mentions — the
  knowledge you wrote but can no longer reach.

## Quickstart

```sh
bunx github:SethMed7/memex init mybrain     # scaffold a memex (zero dependencies)
cd mybrain
bun scripts/validate.ts                      # confirm the structure is sound
```

Then fill `self/00-identity.md`, point your assistant at the folder, and go. Your data is **gitignored
by default**, so the folder is safe to share as a structure.

---

## The structure

A memex is just a folder of plain files. Here's the whole thing — then what each part is for.

```
mybrain/
  STRUCTURE.md  CONFIG.md  ASSETS.md          the contracts: layout · config rule · asset sync
  MAP.md                                      the always-loaded index (summaries + links)
  inbox.md                                    capture zone

  self/                                       slow-changing facts about the subject (person · system · team)
  wiki/                                       focused [[linked]] notes: projects · research · reference · people

  history/<YYYY>/<date>.md                    conversation stream, by day (message-platform shape)
  chats/<slug>.md                             named, attachable conversations (chat-system shape)

  clients/models.json                         per-model rules (window · tier · agentic · …)
  clients/learning/<model>.md                 per-model playbooks (the self-improving layer)

  scripts/                                    deterministic tooling — no LLM calls, no deps
```

### The contracts

Three files define how everything works, so tools never have to guess:

- **`STRUCTURE.md`** — the single source of truth for the layout. Tools resolve *logical roots*
  (`selfPath`, `wikiPath`, `learningPath`, …) from it instead of hardcoding deep paths, so the structure
  can evolve without breaking what's built on it. It's versioned.
- **`CONFIG.md`** — the control panel. Every rule, policy, and permission is a knob, governed by the
  **Configuration Rule** (knob-not-constant · safe defaults · secrets never in config · index every knob).
- **`ASSETS.md`** — the `storage:` convention that keeps the memex strictly text. Binaries live in a
  separate asset store and are referenced by link, never committed here.

### Your knowledge — `self/` and `wiki/`

- **`self/`** is the slow-changing layer about the subject — identity, values, relationships, timeline.
  Prose-first, but each file carries a one-line summary so it can be indexed.
- **`wiki/`** is focused, `[[linked]]` notes grouped into `projects/ · research/ · reference/ · people/`.
  Every note opens with frontmatter (`summary` · `tags` · `aliases` · `updated`) and closes with
  `## Related` links. `aliases:` lets a note be linked and found under more than one name — the project's
  codename as well as its full title — which also keeps duplicates from quietly piling up.

### The conversation record — `history/` and `chats/`

Two surfaces, so a *message platform* and a *chat system* can both write without stepping on each other:

- **`history/`** — a continuous stream bucketed by day (`history/<YYYY>/<date>.md`).
- **`chats/`** — discrete, titled conversations, each with a stable `id` and an optional
  `attachedTo: [[note]]` so any object can carry a chat.

Each tool **writes only its own surface** but **reads across both** plus the shared notes — enforced by
`scripts/conversations.ts`, not just documented.

### The model layers — `MAP.md` and `clients/`

This is what makes the memex *adapt to whoever is reading it*:

- **`MAP.md`** — the always-loaded spine: every note with its one-line summary, so a model can decide
  what to open without reading everything. Regenerated deterministically from the notes — including the
  **backlinks** that make every `[[link]]` two-way, so a model arriving at a note sees not just where it
  points but everything that points *back* at it.
- **`clients/models.json`** — per-model rules. Each model gets a context window, a `tier`, and an
  `agentic` flag; from those, the client layer sizes a pack. Unknown model → the most-constrained safe
  default. Adding a model is one JSON entry.
- **`clients/learning/<model>.md`** — the **self-improving layer**: one playbook per model, folded back
  into that model's context pack every session (see below).

### The tooling — `scripts/`

Deterministic and dependency-free — they read and write files, and **never call an LLM**:

| Script | What it does |
|---|---|
| `validate.ts` | the invariants gate — text-only, links resolve, no secrets, no LLM calls, plus orphans + unlinked mentions |
| `organize.ts` | rebuild `MAP.md` from each note's `summary:` |
| `links.ts` | the findability cluster — resolve `[[links]]` + `aliases:`, compute backlinks, flag orphans and unlinked mentions |
| `conversations.ts` | record + read conversations across both surfaces (`appendDaily` · `writeChat` · `capture`) |
| `client.ts` | assemble a context pack sized to a given model (`contextPack`) |
| `learn.ts` | a model's self-improving layer: `mapFor` · `learn` · `heal` |

---

## How a model plugs in — and improves itself

A tool resolves the **logical roots** from `STRUCTURE.md` (never hardcodes paths), records conversations
via `scripts/conversations.ts`, and asks `scripts/client.ts` for a context pack sized to its model. A
tool can even **build a memex for a user** by running `memex init` with their permission — so they never
set anything up.

The **self-improving layer** then closes a loop, all driven by the model that plugs in (the memex itself
makes no LLM calls — it only stores and re-serves):

1. **Map** — `client.ts` hands the model the spine (`MAP.md` + `self/`) *plus its own playbook*.
2. **Improve** — as it finds useful structure, it records a heuristic:
   `bun scripts/learn.ts add <model> "for payments, read projects/gateway first" --heuristic`
3. **Heal** — `bun scripts/learn.ts heal <model>` lists mechanical drift it should fix (notes missing a
   `summary:`, dangling `[[links]]`, notes not yet in `MAP.md`). It fixes them and logs the correction.
4. **Optimize** — next session those learnings are back in its pack, so navigation gets sharper over time.

Each model family gets its **own** playbook, so a 1M-context agent and a tiny local model accumulate
separate, right-sized knowledge of the same memex.

## Principles

- **Text-only, yours.** Knowledge is markdown on your disk. Binaries live in a separate asset store,
  referenced with `storage:` links (`ASSETS.md`). No proprietary format to migrate out of.
- **Model-aware.** The client layer sizes a context pack to each model — agentic models get a lean spine
  and roam; small local models get a pre-assembled pack trimmed to their window; an unknown model falls
  to the safest, smallest default.
- **Self-improving, not self-modifying.** Models accumulate playbooks and heal drift, but the *structure*
  is a stable contract — learnings are additive and per-model, never a rewrite of the rules.
- **Trails run both ways.** A link you can only walk forward is half a memory. `[[links]]` resolve to
  backlinks, `aliases:` give a note more than one true name, and the validator names the orphans and
  unlinked mentions — so what you wrote stays reachable instead of becoming write-only.
- **Config-driven.** Every rule/policy/permission is a knob, governed by the Configuration Rule in
  `CONFIG.md`.
- **The memex makes no LLM calls.** It holds only the configuration for *how* a model talks to it; the
  reasoning, drafting, and distilling are done by whoever plugs in. `scripts/` are deterministic, and the
  validator flags any model call — or committed secret — that sneaks in.
- **Local-first & versioned.** A git repo of plain files. No "push an update" — the structure is a
  versioned contract that won't break what's built on it.

## Security

Offline, text-only, zero-dependency. Secrets live in your OS keychain, never in files; your data is
gitignored by default; the structure makes no network or LLM calls — all enforced by `validate.ts` and
CI on every push. See [`SECURITY.md`](SECURITY.md).

## License

MIT — use it, fork it, build products on it.
