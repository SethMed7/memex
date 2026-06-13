# Your memex

A local-first, text-only knowledge + memory base that any AI assistant can plug into. Built from
[memex](https://github.com/SethMed7/memex). Start here:

1. **Read** [`STRUCTURE.md`](STRUCTURE.md) (the layout + the contract tools resolve against) and
   [`CONFIG.md`](CONFIG.md) (the knobs + the Configuration Rule).
2. **Make it yours** — fill `self/00-identity.md`, adjust `clients/models.json` for the models you use,
   and (optional) point `assetsPath` at where binaries live (`ASSETS.md`).
3. **Check it** — `bun scripts/validate.ts` (invariants), `bun scripts/organize.ts` (rebuild `MAP.md`).

Everything here is **text** (`.md` + small deterministic scripts). Binaries live elsewhere and are
referenced with `storage:` links. The memex itself **makes no LLM calls** — it's the structure and the
rules for how a model talks to it; your assistant does the thinking.

Your data is **gitignored by default**, so this folder is safe to share as a structure. Keep secrets in
your OS keychain, never in files here.
