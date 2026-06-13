# Security

memex is **local-first and offline by design** — it's plain text on your disk plus small deterministic
scripts. Its threat model is small on purpose.

## The security model

- **The structure makes no network or LLM calls.** The scripts (`validate`, `organize`, `conversations`,
  `client`) only read and write local files. `validate.ts` fails the build if any script gains a model/API
  call. So running a memex doesn't phone home.
- **Secrets never live in a memex.** Keep API keys, tokens, and passwords in your OS keychain (or a
  gitignored `*.local` file) — never in tracked files. `validate.ts` scans for committed secrets
  (API-key/token/private-key patterns) and fails if it finds one.
- **Your data is gitignored by default.** A scaffolded memex ignores `self/`, `wiki/` notes, `history/`,
  `chats/`, `inbox.md`, and `MAP.md`, so the folder is safe to publish or share as a *structure* without
  leaking content. Opt in to versioning your data only in a private repo.
- **Text-only.** Binaries live in a separate asset store (`ASSETS.md`); the structure holds no
  executables it runs and no opaque blobs.
- **Zero dependencies.** The tooling uses only the runtime's built-ins — no third-party packages, so no
  supply-chain surface.

## Verifying

Run `bun scripts/validate.ts` anytime — it enforces text-only, no committed secrets, no LLM calls, and
the structural invariants. CI runs the same checks on every push.

## Reporting a vulnerability

Please open a **private security advisory** on the GitHub repo (Security → Report a vulnerability)
rather than a public issue. We'll respond as quickly as we can.
