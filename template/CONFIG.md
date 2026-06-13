# CONFIG — the control panel

memex is **configurable**: its rules, policies, and permissions are *your* knobs, set in config — not
hardcoded. This is the index of every knob and the law for adding more. Tools that plug in register
their knobs here too.

## The Configuration Rule

Read this before adding or changing config — the law that keeps a memex easy to manage and build on:

1. **Knob, not constant.** Anything reasonably variable is a config knob; defaults in code, override in config.
2. **Safe by default.** Defaults are conservative; the *unknown* case degrades to the most-constrained safe option.
3. **One file per concern, named clearly.** A setting lives in one named file — never scattered/duplicated.
4. **Secrets are never config.** Secrets/PII never in committed config — use your OS keychain/secret store and
   gitignored `*.local` files (with committed `*.example`). Committed config is always safe to share.
5. **Resolve, don't hardcode paths.** Tools read logical roots from `STRUCTURE.md`, never hardcoded deep paths.
6. **Index every knob here.** Add a knob → add a row below. An undocumented knob is a bug.
7. **Validate the load-bearing.** If breaking a config breaks the memex, add a check to `scripts/validate.ts`.
8. **Local-first & versioned.** Changes are commits; bump `STRUCTURE.md`'s version + log in `CHANGELOG.md` on contract changes.
9. **The memex makes no LLM calls.** It holds only the *configuration* for how an LLM talks to it (the client
   layer). Reasoning, drafting, distilling, integrations — done by whoever talks to it, never by the memex.
   `scripts/` are deterministic; `validate.ts` flags any LLM call that sneaks in.

To extend: pick the concern's file (or add one), give it a safe default in code, expose the override, add the
row below, validate if load-bearing, commit. That's the whole ritual.

## The knobs

| Concern | Where | What you control |
|---|---|---|
| **Per-model rules** | `clients/models.json` | context window, brain budget, tier, `agentic`, structured-output per model. Add a model = one JSON entry. Unknown → safe default. |
| **Layout contract** | `STRUCTURE.md` | the logical roots + conventions every tool resolves against; versioned. |
| **Asset sync** | `ASSETS.md` | the `storage:` convention (text here, binaries elsewhere). |
| **Asset store location** | `memex.local.json` → `assetsPath` (or `$MEMEX_ASSETS`) | where binaries live; default is a sibling `../<dir>-assets`. Gitignored (instance wiring). |
| **What's indexed** | `MAP.md` + each note's `summary:` | the always-loaded spine. |
| **Write permissions** | `STRUCTURE.md` → Conversations/Ownership | who writes where; enforced by `conversations.ts` + `validate.ts`. |

*Tools you connect (a message platform, a chat system, …) add their own knobs as their own JSON config files
and list them here. Keep secrets out — keychain + gitignored `*.local`.*
