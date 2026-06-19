# Changelog

Dated log of structural/contract changes to this memex (newest first).

## v3.4 — 2026-06-19

- **Instance identity + additive plug-in.** New committed `memex.json` per instance: a stable `id`
  (`mx_<uuid>`, stamped at `memex init`), the `contract` version, and an additive `apps` registry.
  `mounts.ts` gains `memexId()`/`memexInfo()`/`connectedApps()`/`connectApp()` and a CLI
  (`memex id` · `memex connect <app> [role]` · `memex apps`). An app PLUGS IN additively — `connectApp`
  creates the id if absent and merges only its own entry, never clobbering another app's data or
  re-initing. Apps PIN to `memexId()` + call `requireContract()` before writing. So a second app (e.g.
  Rotli) attaches to a live memex purely additively — proper boundaries, no app breaks another, no
  manual edits to make one work.
- **Access mode fails closed.** `accessMode()` now normalizes + validates: any malformed/typo/
  non-string `mode` collapses to the most-restrictive `secure` (was returned verbatim, which could
  silently disable a connected app's step-up auth).

## v3.3 — 2026-06-18

- **Native multi-tenancy.** One memex repo can now hold several isolated knowledge partitions
  ("users") under `users/<name>/`, each with its own `self/ wiki/ history/ chats/ inbox.md MAP.md`.
  A "user" is a named partition — a person OR a topic-persona of the same human. New committed
  `users.json` registry declares the partitions (`name`, `role` admin|member, `path`, `createdAt`)
  and the single `primary` (default) partition. memex **declares** partitions + access policy; the
  connected app (e.g. Breve) **enforces** who may reach which at runtime — memex makes no LLM/network
  calls and holds no identity/phone data.
- **Resolver is user-aware.** `scripts/mounts.ts` gains `REPO_ROOT`, `registry()`, `userRoot(name?)`,
  `currentUser()`, and per-user logical roots (`knowledgePath(user)`, `selfPath(user)`, …).
  `clients/` stays shared/install-level at the repo root; only the knowledge spine is per partition.
- **Backward compatible (safe default, Rule #2).** No `users.json` ⇒ single-tenant: one implicit
  default user whose root **is** the repo root — byte-identical to pre-v3.3. The primary may keep
  `path: ""` (flat at the root, unmigrated). An unknown user name is an error, never a cross-partition
  read.
- **Management engine.** New `scripts/users.ts` + `scripts/user-skeleton/` (the data-free spine) +
  `memex user …` passthrough: `add` / `list` / `remove [--purge]` / `init-primary [--migrate]`. Pure
  file ops — scaffold a partition, edit `users.json` atomically (temp+rename), refuse
  duplicate/reserved/unsafe names, never hard-delete (`--purge` moves to `trash/`).
- **Per-partition engines.** `validate.ts` gains `--user`/`--all` and an `(h)` registry-invariants
  cluster (well-formed registry, primary exists, slug/reserved/role/path checks, no path escapes the
  repo, partitions have required roots); install-level checks (client registry, config spine, script
  +secret scans) run once on the primary pass. `organize.ts` (per-partition `MAP.md`), `client.ts`
  (`contextPack(model, { root })` packs any partition), and `conversations.ts` (`forUser(name)`
  factory) all operate per partition — partitions never bleed into one another's graph.
- Still **NO LLM calls** and **NO network** in the memex (Rule #9).

## v3.2 — 2026-06-15

- **Storage is a pure path knob (inside or outside).** The text-only invariant relaxed from "no binaries
  anywhere" to "no binaries OUTSIDE a configured media mount" — `assetsPath` may now point at a sibling,
  an external/Drive path, or a subtree inside the memex, a location choice with no functional difference.
- **Named mounts.** New `scripts/mounts.ts` + a `mounts` block in `memex.local.json`: any logical folder
  → any path (inside / sibling / external / a synced Drive a team co-manages), each with per-mount policy
  — `external` (opaque + offline-tolerant; the memex resolves the path but doesn't validate or sync it —
  its backend owns sync/conflicts), `media` (binaries allowed), `git` (track / ignore). `assets` is the
  canonical mount. `validate.ts` is mount-aware (binaries allowed under media mounts; external mounts'
  contents are skipped). The memex still makes no LLM calls and never syncs (Rule #9) — it only resolves paths.

## v3.1 — 2026-06-15

- **External resources registry.** New `clients/resources.json` in the client layer: the external
  sources a connected app may fetch from + the per-source guards it must fetch under (https-only,
  host allowlist, no-private-IP/SSRF, same-host bounded redirects, timeout/byte/char caps, `cadence`,
  processing `tier`, `favorite`, `trust`). Distinguishes a **resource** (a live source you fetch from —
  config) from a **reference** (`wiki/reference/` knowledge you keep) — *what you know vs where you go*;
  they cross-link via the note's `source:` and the entry's `reference:` slug. New `validate.ts` check
  (d8) makes the safety invariants machine-enforced (https-only, no private-host, processing tier stays
  local-class, `trust:untrusted`, favoriting cannot escalate). Still **NO LLM calls / NO fetching** in
  the memex — it holds the list + rules; the connected app does the fetching (Rule #9). The
  `reference.md` template gains an optional `resource:` join marker.

## v3 — 2026-06-14

- **Findability cluster — trails run both ways.** memex is named for Vannevar Bush's two-way
  associative *trails*, but `[[links]]` ran one direction. Now:
  - **Bidirectional backlinks.** `organize.ts` renders inbound-link **trails** into `MAP.md`
    (`- [[note]] — summary ← [[src]] · [[src]]`), so a trail is followable from both ends. Generated
    into `MAP.md` only (regenerated wholesale + gitignored — zero idempotency risk); note files are
    never mutated.
  - **Orphan + unlinked-mention warnings** in `validate.ts`: notes nothing links to, and a note's
    title/alias appearing in another note's plain prose but never `[[linked]]`. Both also surfaced as
    `## Orphans` / `## Unlinked mentions` sections in `MAP.md`. Fully deterministic string scans — the
    memex FLAGS the gap; the model decides what to link.
  - **Optional `aliases:` frontmatter** (inline bracket-list, fixed key): extra names a note is
    findable/linkable by — `[[Other Name]]` resolves, alias-only links rescue a note from orphan
    status, every alias is a mention search term, and duplicate aliases are flagged (duplicate-concept
    smell).
  - **New shared `scripts/links.ts`** — the single canonical wikilink regex + `prose()` strip +
    alias-aware `resolveTarget` + backlink/orphan/mention passes, ending the three divergent wikilink
    regexes. `organize.ts` / `validate.ts` / `learn.ts` import it (alias-aware dangling check now agrees
    across all three).
  - New `findability` knob in `clients/models.json` (orphan grace/exemptions, mention
    minlen/stopwords/scan-scope, alias uniqueness; defaults in code, `enabled:false` → pre-v3 behavior).
  - Still **NO LLM calls** — the memex flags findability gaps; the model links them.

## v2 — 2026-06-14

- **Self-improving layer (per model).** New `clients/learning/<model-slug>.md` playbooks + `scripts/learn.ts`
  (`mapFor` / `learn` / `heal`). `client.ts` now folds a model's playbook into its context pack, so each
  model gets its map plus what it has learned and heals mechanical drift it finds. New logical root
  `learningPath`; new `learning` knob in `clients/models.json`. Still no LLM calls — the model does the
  thinking; the memex stores and re-serves. Playbooks gitignored by default (like `history/`).
