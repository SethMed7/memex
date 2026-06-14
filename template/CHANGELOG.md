# Changelog

Dated log of structural/contract changes to this memex (newest first).

## v2 — 2026-06-14

- **Self-improving layer (per model).** New `clients/learning/<model-slug>.md` playbooks + `scripts/learn.ts`
  (`mapFor` / `learn` / `heal`). `client.ts` now folds a model's playbook into its context pack, so each
  model gets its map plus what it has learned and heals mechanical drift it finds. New logical root
  `learningPath`; new `learning` knob in `clients/models.json`. Still no LLM calls — the model does the
  thinking; the memex stores and re-serves. Playbooks gitignored by default (like `history/`).
