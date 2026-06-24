<div align="center">

![memex — your knowledge, structured](assets/banner.png)

**A local-first, text-only memory your AI assistants can actually read.**
Plain markdown you own — no cloud, no database, no lock-in.

[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-text%20only-0c0e1a)](#principles)
[![Runtime](https://img.shields.io/badge/Bun-zero%20deps-0c0e1a)](https://bun.sh)
[![Security](https://img.shields.io/badge/security-no%20LLM%20calls%20%C2%B7%20no%20secrets-6366f1)](SECURITY.md)

</div>

## What it is

memex is a **structure for your knowledge** — a folder of plain markdown files on your disk, plus
the rules for how an AI assistant reads and writes them. It isn't an app, and it isn't tied to any
one model. Point your assistant at the folder and it has a memory that **persists between sessions,
stays on your machine, and is yours to keep.**

It fixes two things at once:

- **Assistants forget.** Every new chat starts from zero. memex gives a model a durable, structured
  memory it reads at the start of every session — and writes back to as you talk.
- **Your knowledge is trapped.** Notes scattered across apps and clouds. memex is plain files you
  own, in a format with no migration path — because there's nothing to migrate *out* of.

**Bring your own assistant.** Claude, a local model, an agent you wrote — memex is the part that
stays put while models come and go.

## Why it's more than a folder of notes

- **A model-readable index.** Every note carries a one-line `summary:`; `MAP.md` is an always-loaded
  spine the assistant reads *first* to decide what to open — so a 1M-context model and an 8k local
  model each get a right-sized view instead of dumping the whole brain into context.
- **A conversation record.** Two surfaces — a by-day stream (`history/`) and named, attachable chats
  (`chats/`) — let a message platform and a chat app both write history without bleeding into each other.
- **A configuration layer.** Every rule, policy, and permission is a knob you own (`CONFIG.md`), and a
  per-model client layer adapts the whole thing to whatever model is reading it.
- **A self-improving layer.** Each model keeps a playbook that's folded back into its context every
  session — so it gets its map *plus what it has already learned*, and heals drift as it works.
- **Two-way trails.** `[[links]]` run both ways: every note shows what it links *to* and what links
  *back*, `aliases:` let a note be found under more than one name, and the validator surfaces orphans —
  the knowledge you wrote but can no longer reach.

## Quickstart

```sh
bunx github:SethMed7/memex init mybrain     # scaffold a memex (zero dependencies)
cd mybrain
bun scripts/validate.ts                      # confirm the structure is sound

memex scan mybrain/                          # get a local-AI recommendation for your hardware

# Start from a product template (pre-configures the mode + apps registry)
memex init breve-brain --template breve
memex init rotli-notes --template rotli

# One brain, many apps: a SECOND app plugs into an EXISTING memex (additive — never re-inits)
cd breve-brain
memex connect rotli chat-system              # Rotli now shares Breve's brain
memex status                                  # the handshake: id · contract · mode · apps · partitions

memex join path/to/memex-a path/to/memex-b merged-brain/   # merge two memexes into one
```

Then fill in `self/00-identity.md`, point your assistant at the folder, and go. Your *data* is
**gitignored by default**, so the folder is safe to share as a structure.

> **One memex, many apps.** A template inits a *new* brain; to add another app to a brain that already
> exists you **`connect`**, not init (`memex init` refuses a non-empty dir). The `apps` registry in
> `memex.json` is additive, so Breve and Rotli can share one memex without breaking each other.
> `memex status` shows the handshake an app gates on at startup.

## The structure

A memex is just a folder of plain files. Here's the whole thing:

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

**The contracts** — three files define how everything works, so tools never guess:

- **`STRUCTURE.md`** — the single source of truth for the layout. Tools resolve *logical roots*
  (`selfPath`, `wikiPath`, …) from it instead of hardcoding paths, so the structure can evolve
  without breaking what's built on it. It's versioned.
- **`CONFIG.md`** — the control panel. Every rule, policy, and permission is a knob, governed by the
  **Configuration Rule** (knob-not-constant · safe defaults · secrets never in config · index every knob).
- **`ASSETS.md`** — the `storage:` convention that keeps the memex strictly text. Binaries live in a
  separate asset store and are referenced by link, never committed here.

**Your knowledge** — `self/` is the slow-changing layer (identity, values, relationships, timeline),
prose-first but indexed; `wiki/` is focused `[[linked]]` notes (`projects/ · research/ · reference/ ·
people/`), each opening with frontmatter (`summary · tags · aliases · updated`) and closing with
`## Related` links.

**The conversation record** — `history/` is a continuous by-day stream; `chats/` are discrete, titled
conversations, each with a stable `id` and an optional `attachedTo: [[note]]` so any object can carry a
chat. Each tool **writes only its own surface** but **reads across both** — enforced by code, not docs.

**The model layers** — `MAP.md` is the always-loaded spine (every note + its summary + two-way
backlinks), regenerated deterministically. `clients/models.json` gives each model a window, a `tier`,
and an `agentic` flag; an unknown model falls to the most-constrained safe default.
`clients/learning/<model>.md` is the per-model self-improving playbook.

**The tooling** — `scripts/` read and write files and **never call an LLM**:

| Script | What it does |
|---|---|
| `validate.ts` | the invariants gate — text-only, links resolve, no secrets, no LLM calls, orphans + unlinked mentions |
| `organize.ts` | rebuild `MAP.md` from each note's `summary:` |
| `links.ts` | resolve `[[links]]` + `aliases:`, compute backlinks, flag orphans and unlinked mentions |
| `conversations.ts` | record + read conversations across both surfaces (`appendDaily` · `writeChat` · `capture`) |
| `client.ts` | assemble a context pack sized to a given model (`contextPack`) |
| `learn.ts` | a model's self-improving layer: `mapFor` · `learn` · `heal` |

## How a model plugs in — and improves itself

A tool resolves the **logical roots** from `STRUCTURE.md`, records conversations via
`scripts/conversations.ts`, and asks `scripts/client.ts` for a context pack sized to its model. A tool
can even **build a memex for a user** by running `memex init` with their permission — so they never set
anything up. The memex itself makes no LLM calls; it only stores and re-serves. The model closes the loop:

1. **Map** — `client.ts` hands the model the spine (`MAP.md` + `self/`) *plus its own playbook*.
2. **Improve** — when it finds useful structure, it records a heuristic:
   `bun scripts/learn.ts add <model> "for payments, read projects/gateway first" --heuristic`
3. **Heal** — `bun scripts/learn.ts heal <model>` lists mechanical drift (missing `summary:`, dangling
   `[[links]]`, notes not yet in `MAP.md`); it fixes them and logs the correction.
4. **Optimize** — next session those learnings are back in its pack, so navigation gets sharper over time.

Each model family gets its **own** playbook, so a 1M-context agent and a tiny local model accumulate
separate, right-sized knowledge of the same memex.

## Principles

- **Text-only, yours.** Markdown on your disk; binaries live in a separate asset store via `storage:`
  links. No proprietary format to migrate out of.
- **Model-aware.** The client layer sizes a context pack to each model — agentic models get a lean spine
  and roam; small models get a pre-assembled pack trimmed to their window.
- **Self-improving, not self-modifying.** Models accumulate playbooks and heal drift, but the *structure*
  is a stable contract — learnings are additive and per-model, never a rewrite of the rules.
- **Trails run both ways.** A link you can only walk forward is half a memory — so `[[links]]` resolve to
  backlinks and the validator names what's become unreachable.
- **The memex makes no LLM calls.** It holds only the configuration for *how* a model talks to it; the
  reasoning is done by whoever plugs in. `validate.ts` flags any model call — or committed secret — that sneaks in.
- **Local-first & versioned.** A git repo of plain files. The structure is a versioned contract that
  won't break what's built on it.

## The name

In 1945, Vannevar Bush imagined the **memex** — a "memory extender": a desk where you keep all your
books, records, and notes and link them by *associative trails*, so anything can be found later by
following connections. It's the idea every "second brain" descends from. This is that idea, rebuilt for
the age of AI assistants: **a personal memory your models can actually read.**

## Security

Offline, text-only, zero-dependency. Secrets live in your OS keychain, never in files; your data is
gitignored by default; the structure makes no network or LLM calls — all enforced by `validate.ts` and
CI on every push. See [`SECURITY.md`](SECURITY.md).

## License

MIT — use it, fork it, build products on it.
