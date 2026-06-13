<div align="center">

![memex — your knowledge, structured](assets/banner.png)

# memex

**A local-first, text-only knowledge + memory structure that any AI assistant can plug into.**
Plain markdown you own — no cloud, no database, no lock-in. Bring your own model; memex is the
structure and the rules for how a model talks to it.

[![License: MIT](https://img.shields.io/badge/license-MIT-cd7f5a)](LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-text%20only-161616)](#principles)
[![Runtime](https://img.shields.io/badge/Bun-zero%20deps-161616)](https://bun.sh)

</div>

Assistants are only as good as the memory they can reach. memex gives one a durable, navigable place to
**store and recall** what matters — organized as focused markdown notes with a model-readable index, a
by-day conversation record, and a configuration layer that adapts the whole thing to *whatever model*
is reading it (a 1M-context frontier model and an 8k local model each get a right-sized view).

Named for Vannevar Bush's 1945 **memex** — the original idea of a personal device that stores all your
knowledge and lets you find it by association. This is that, for the age of AI assistants.

## Quickstart

```sh
bunx github:SethMed7/memex init mybrain     # scaffold a memex (zero dependencies)
cd mybrain
bun scripts/validate.ts                      # confirm the structure is sound
```

Then fill `self/00-identity.md`, point your assistant at the folder, and go. Your data is **gitignored
by default**, so the folder is safe to share as a structure.

## What you get

```
mybrain/
  STRUCTURE.md  CONFIG.md  ASSETS.md   contracts (layout · config rule · asset sync)
  self/                                slow-changing facts about the subject (person/system/team)
  wiki/                                focused [[linked]] notes: projects · research · reference · people
  history/<YYYY>/<date>.md             conversation stream, by day (message-platform shape)
  chats/<slug>.md                      named, attachable conversations (chat-system shape)
  clients/models.json                  per-model rules (window, tier, agentic, …)
  MAP.md                               the always-loaded index (summaries + links)
  scripts/                             deterministic tooling — no LLM calls, no deps
```

## Principles

- **Text-only, yours.** Knowledge is markdown on your disk. Binaries live in a separate asset store,
  referenced with `storage:` links (`ASSETS.md`). No proprietary format to migrate out of.
- **Model-aware.** The client layer (`clients/models.json` + `scripts/client.ts`) sizes a context pack
  to each model — agentic models get a lean spine and roam; small local models get a pre-assembled pack
  trimmed to their window; an unknown model falls to the safest, smallest default.
- **Config-driven.** Every rule, policy, and permission is a knob you own — governed by the
  Configuration Rule in `CONFIG.md` ("knob, not constant · safe defaults · secrets never in config · …").
- **The memex makes no LLM calls.** It holds only the configuration for how a model talks to it; the
  reasoning, drafting, and distilling are done by whoever plugs in. `scripts/` are deterministic; the
  validator flags any model call that sneaks in.
- **Local-first & versioned.** It's a git repo of plain files. There's no "push an update" — the
  structure is a versioned contract that won't break what's built on it.

## How assistants plug in

A tool resolves the **logical roots** from `STRUCTURE.md` (never hardcodes paths), records conversations
via `scripts/conversations.ts` (`appendDaily` / `writeChat` / `capture`), reads across them with its
helpers, and sizes context with `scripts/client.ts`. Two conversation surfaces — a by-day stream and
named chats — let a message platform and a chat system share one memex without bleeding into each other.

A tool can also **build a memex for a user** by running `memex init` with their permission — so they
never have to set anything up.

## License

MIT — use it, fork it, build products on it.
