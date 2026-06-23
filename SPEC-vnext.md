# memex v-next — structure spec (DRAFT, pending Seth's review/redline)

> Not built. Spec for evolving the structure to carry all 7 use cases as one navigable memory (the
> llmWiki). Read, redline the **DECISION** points, then I build it. Respects the enshrined boundary:
> memex = structure + 3 configs (model-use · user · self-mapping/learning) + their engines — no feature
> scripts, no UX (those are the connected app's).
>
> **Resolved (Seth, this pass):** "wiki" is not a content type — it's the *concept*. A wiki is just
> **notes + structure**. So there is **no raw-notes-vs-distilled-wiki split** (old DECISION A is gone).

## Purpose

A local-first, git-versioned, **text-navigable** corpus an LLM walks as **proper memory** (Karpathy's
llmWiki): the structure holds *records + links + an index*; the model-use config + self-mapping guide the
AI through it responsibly (load the right slice per model, follow associative trails). It must carry:
**chats · notes · docs · storage · relationships · links · config/rules.**

## The core idea: one unified record model

**Every content object is a text *record*** — a `.md` file with frontmatter + `[[links]]`/`## Related` +
a **body**. The body is either:
- **inline markdown** (a normal note, a doc, chat messages), or
- a **`storage:` pointer** to a binary/rich body (a handdrawn note, a rich/non-md doc, an attachment).

```yaml
---
type: note            # note | doc | chat | reference | …  (drives template + handling)
title: …              # the record's human name (also the heading)
id: 2026-06-15-xyz
category: projects     # the hierarchy bucket (the folder is the category)
tags: [topic]
created: 2026-06-15
updated: 2026-06-15
summary: one line an LLM reads to decide relevance without opening the file
rel: [[other-record]] # relationships (any → any), bidirectional via links.ts
body: inline          # inline  |  storage:drawings/2026/06/sketch.png  (+ mime: image/png)
---
# Title
…inline md body (may contain mermaid + code fences + tables)…
## Related
[[a]] · [[b]]
```

**Why this absorbs everything:** a note is a record with an md body *or* a `storage:` drawing; a doc is a
record with a long md body *or* a `storage:` rich file; a chat is a record whose body is messages; an
attachment is a stored file with a thin record. The structure stays **100% text** (records + links +
MAP); heavy/binary/rich bodies live in the **storage library**; relationships + the link-log are graph
layers over the records. That's what lets the AI navigate all of it as memory.

## What makes it a "wiki" — structure, not a content type

A wiki isn't a thing you store; it's what notes **become** when the structure is applied. The content is
**managed by the individual**; the system **provides the structure that makes it work**:

- **Hierarchy** — categories/types (the folders: `reference/ research/ projects/ people/ theology/`, and
  type-homes like `docs/`, `chats/`). The `category:` field mirrors the folder.
- **Templates** — one per record type (`note`, `doc`, `reference`, `chat`, …) so every record opens with
  the same metadata spine and shape. This is the main lever for "breaking things up" consistently.
- **Metadata spine** — `title · tags · category · created · updated · summary` on every record, so the
  index and the AI can sort, filter, and decide relevance without opening files.
- **Links** — `[[wikilinks]]` + `rel:` weave records into the navigable graph.

So there is **no `notes/` vs `wiki/` split**. There are **records** (notes, docs, chats…), the structure
above organizes them, and the organized whole *is* the wiki. The only "raw" zone is **`inbox.md`** —
filing a capture (apply a template + metadata) turns it into a structured record, i.e. part of the wiki.

> Folder name (cosmetic): the notes corpus is `wiki/` today. Since "wiki" is just the concept, we can
> rename it `notes/` if you prefer the label — identical model either way. `DECISION A`: keep `wiki/`, or
> rename → `notes/`?

## Proposed layout

```
smBrain/
  self/                   whole-person layer                         (unchanged)
  wiki/  (the notes corpus = the wiki: records organized by category/template/metadata)
    reference/ research/ projects/ people/ theology/ _templates/
  docs/                   long-form documents — md body, or a record → storage: rich file               [NEW]
  chats/<slug>.md         named threads (chat system, Rotli)         (exists)
  history/<YYYY>/<date>   by-day stream (message platform, Signal/Breve) (exists)
  links/                  the complete link log (every URL ever) + promotion status                     [NEW]
  inbox.md  MAP.md        the only raw zone · the spine (now spans all of the above)
  clients/                config: models.json · resources.json · learning/        (model-use + learning configs)
  memex.local.json        user wiring: assetsPath, mounts
  scripts/                engines only: validate · organize · links · client · learn · conversations · mounts
  archive/  trash/        lifecycle

storage  (assetsPath / a mount — smStorage/smBrain today, empty = greenfield):
  images/<YYYY>/<MM>/…  audio/…  video/…  pdf/…  sheets/…  docs/…  drawings/…    [type → year/month]
```

## The gap closures

**1. docs/ (new).** Long-form, detailed documents — a record with `type: doc`. Default body = **markdown**
(scales: headings, mermaid, code, tables, footnotes). A truly rich/collaborative doc (google-doc/word) =
a `docs/` record whose `body:` points at the file in `storage:docs/…`. `DECISION B`: md-default +
storage-ref escape (simple), or invest in a rich block format (an editor/format — much bigger).

**2. notes.** A note is a record with `type: note`. **md notes** with mermaid/code already work (text).
**Handdrawn / non-md** → the record pattern (`body: storage:drawings/…`, `mime`), so a drawing is still a
linkable, indexed record. No raw/distilled split (resolved above) — templates + metadata are what give a
note its structure; `inbox.md` is the only pre-structure zone.

**3. storage library.** *(NOT ADOPTED — DECISION C resolved 2026-06-23 to keep the v3.4 mirror-the-note-path
rule; retained here for the record.)* Organize by **type → year/month** (`images/2026/06/…`), a real media library;
records connect to files via relationships, not the old "mirror the note's path" rule (retire it).
`DECISION C`: the type taxonomy + whether dates are by created or by added.

**4. relationships (any → any).** One convention: `[[links]]` everywhere + an optional typed frontmatter
relation (`rel:` / `attached:` / `about:`). `links.ts` extends its backlink/orphan/mention passes from
`wiki/` to **all** record types, so a stored mp4's record can declare `attached: [[chat-x]] [[doc-y]]`
and the trail is followable both ways. Bush's associative trails, spanning everything.

**5. link log (every URL ever).** `links/` holds the complete index — each external URL with first-seen
date, the record(s) it appeared in, title, and status (`raw` → can graduate to a **resource** [curated
fetch-from] or a **reference** [knowledge note]). `organize.ts` **harvests** URLs from all records into it
(deterministic, no LLM — like backlinks). Links still live inline in their record (context). `DECISION D`:
`links/log.jsonl` (machine, scales) vs `links.md` (human-readable); harvest scope (all records vs opt-in).

**6. self-mapping coverage.** `organize.ts` indexes **all** record types into `MAP.md` (sections per type
+ storage pointers); `client.ts` sizes per-model packs over the whole graph (spine + trails, never a
blind dump); `learn.ts` records what the AI learns navigating it. This is the config that "guides the AI
through the data responsibly" — now spanning every record type.

## How it becomes *proper memory* (the llmWiki contract)

- **Spine + trails, per model.** A large-context model reads `MAP.md` (spanning all types) and roams via
  `[[links]]`/relationships; a small local model gets a pre-assembled, trimmed pack. (`client.ts`.)
- **Refinement is structure, not a separate folder.** `inbox.md` (raw) → a structured record (apply a
  template + the metadata spine) → archived. The organized records *are* the wiki the AI trusts.
- **Self-improvement.** `learn.ts` playbooks per model fold back into packs (the AI gets its map *plus*
  what it has learned). Still **no LLM calls in the brain** — the model reasons; the brain stores + serves.

## Impact / migration

- **Storage is greenfield** (`smStorage/smBrain` empty) → adopt the type/date layout with zero migration.
- **Existing `wiki/` records** stay as-is — they're already structured notes; the metadata spine just gets
  standardized (add `type`/`title`/`category`/`created` where missing) and templates updated.
- **`validate.ts`** gains: record `type` + the metadata spine per type; storage-bodied records' `body:`/
  `storage:` resolves; relationships resolve; the new dirs. **`conversations.ts`** unchanged (chats/
  history); notes/docs are plain md records (no new helper). **Contract version bump + CHANGELOG.**
- **Connected apps:** Rotli writes notes/docs/chats per the contract (and the templates) and manages config
  per "Speaking to the config"; Breve largely unaffected; Claude Code can author docs into a mount.
- **Boundary:** every piece is structure + an engine extension (organize/links/validate/client/learn) —
  no feature scripts, no UX. Consistent with what we enshrined.

## Suggested build order (each a reviewable step)

1. **Unified record model + metadata spine + templates** — the frontmatter `type`/`title`/`category`/
   `created` convention, a template per type, `validate.ts` shape checks. (Folds in `docs/`.)
2. **Storage library** — type/date layout + retire path-mirror (ASSETS.md) + validate resolves.
3. **Relationships** — generalize `links.ts` to all record types + typed relations + MAP trails.
4. **Link log** — `links/` + the `organize.ts` harvest + promotion to resource/reference.
5. **Self-mapping coverage** — MAP sections per type + client packs spanning the graph.

## DECISIONS to redline
- **A** *(naming only)* — keep the notes corpus as `wiki/`, or rename → `notes/`? (Identical model.)
- **B** — docs: md-default + storage-ref escape, or a rich block format?
- **C** — storage taxonomy + date basis (created vs added)? **RESOLVED 2026-06-23: keep the v3.4
  mirror-the-note-path convention (ASSETS.md); the type/year/month media-library layout (proposal #3) is NOT
  adopted.** Storage was empty when locked, so zero migration; revisit only if asset volume outgrows mirroring.
- **D** — link log: `.jsonl` vs `.md`; harvest all records or opt-in?
- **E** — anything here that's the *app's* job, not the structure's? (boundary check)
