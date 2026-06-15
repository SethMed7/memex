# Changelog

Dated log of structural/contract changes to this memex (newest first).

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
