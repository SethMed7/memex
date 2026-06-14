# clients/learning/ — the self-improving layer (per model)

One **playbook** per model: `clients/learning/<model-slug>.md`. It's the model's own running notes on
how to navigate and maintain *this* memex — created on first use, folded back into that model's context
pack every session (so each model, when used, gets its map **plus** what it has already learned).

The loop, all driven by the model that plugs in (the memex itself makes **no LLM calls**):

1. **Map** — `client.ts` hands the model the spine (MAP + self/) and its own playbook.
2. **Improve** — as it finds useful structure ("for X, read Y first"), it records a heuristic:
   `bun scripts/learn.ts add <model> "<insight>" --heuristic`
3. **Heal** — `bun scripts/learn.ts heal <model>` lists mechanical drift the model should fix
   (notes missing a `summary:`, dangling `[[links]]`, notes not yet in MAP). It fixes them and logs the
   correction; what it can't fix yet goes under **Watch**.
4. **Optimize** — next session those heuristics are back in its pack, so navigation gets sharper over time.

Sections in each playbook: **Heuristics** (how to use this memex) · **Corrections** (drift it healed) ·
**Watch** (open issues). Playbooks are per-instance, model-generated content — **gitignored by default**
(like `history/`); delete the data lines in `.gitignore` if you want them versioned. Config knob:
`clients/models.json` → `learning` (see `CONFIG.md`).
