# Assets — how memex (text) stays in sync with your asset store (binaries)

**The memex text corpus holds only text.** Every binary a note needs — images, audio, video, PDFs —
lives under a configured **assets root**, referenced by `storage:`. *Where that root sits is a pure
path choice* — a sibling, an absolute/external path, an object-store or Drive mount, **or a subtree
inside the memex** — same convention and tooling either way; only the path differs. Text and binaries
are kept paired by a simple convention + the validator.

## The `storage:` convention

Reference a binary with a logical `storage:` path:

```markdown
![Diagram](storage:wiki/projects/my-project/diagram.png)
[The deck](storage:exports/deck.pdf)
```

Tools resolve `storage:` → your asset store root. Set it in `memex.local.json` (`"assetsPath": …`)
or the `MEMEX_ASSETS` env var; if neither is set, tools default to a sibling `../<dir>-assets`. It can
be any directory — a sibling folder, an absolute path, an object-store mount, **or a subtree inside the
memex** (e.g. `./assets`). So `storage:wiki/projects/my-project/diagram.png` is the file at
`<assetsPath>/wiki/projects/my-project/diagram.png`.

**Mirror the note's location** — a binary attached to `wiki/projects/my-project.md` belongs under
`storage:wiki/projects/my-project/…`, so things stay findable and orphans are detectable.

## Rules

- Binaries live **under the configured assets root**, wherever you point it. Outside that root the tree
  stays text-only — a stray binary in `wiki/` is still an error. Reference every binary with `storage:`.
- If you point the assets root **inside** the memex, gitignore that subtree (or use Git LFS) so binaries
  don't bloat the text repo — that's the one tradeoff of keeping them in-tree.
- The asset store is working storage — treat assets as replaceable, the note as the record.

## Enforcement — `scripts/validate.ts`

- **No binaries outside the assets root** — a non-text file anywhere except under the configured assets
  root is an error (the root itself may live inside or outside the memex).
- **Every `storage:` reference resolves** — the target must exist in the asset store.
- **Orphans flagged** — assets no note references are reported (warning).

## Caveat

`storage:` is a logical scheme memex tools understand. A plain Markdown/Obsidian preview won't render
`storage:` images inline — by design: memex is an **LLM knowledge base first**. Open the asset from the
store directly when you need to view it.
