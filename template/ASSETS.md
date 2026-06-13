# Assets — how memex (text) stays in sync with your asset store (binaries)

**memex holds only text.** Every binary a note needs — images, audio, video, PDFs — lives in a
separate asset store, never here. The two are kept paired by a simple convention + the validator.

## The `storage:` convention

Reference a binary with a logical `storage:` path:

```markdown
![Diagram](storage:wiki/projects/my-project/diagram.png)
[The deck](storage:exports/deck.pdf)
```

Tools resolve `storage:` → your asset store root (configure it as `assetsPath`; e.g. a sibling
`…-assets/` folder, an object bucket, or any directory). So `storage:wiki/projects/my-project/diagram.png`
is the file at `<assetsPath>/wiki/projects/my-project/diagram.png`.

**Mirror the note's location** — a binary attached to `wiki/projects/my-project.md` belongs under
`storage:wiki/projects/my-project/…`, so things stay findable and orphans are detectable.

## Rules

- **Never** put a binary in the memex (it's text-only). Put it in the asset store and reference with `storage:`.
- The asset store is working storage — treat assets as replaceable, the note as the record.

## Enforcement — `scripts/validate.ts`

- **No binaries in the memex** — any non-text file is an error.
- **Every `storage:` reference resolves** — the target must exist in the asset store.
- **Orphans flagged** — assets no note references are reported (warning).

## Caveat

`storage:` is a logical scheme memex tools understand. A plain Markdown/Obsidian preview won't render
`storage:` images inline — by design: memex is an **LLM knowledge base first**. Open the asset from the
store directly when you need to view it.
