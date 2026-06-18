#!/usr/bin/env bun
/**
 * memex — scaffold a local-first knowledge + memory structure any AI assistant can plug into.
 *
 *   memex init [dir]     create a new memex (default: ./memex)
 *   memex --version
 *
 * Copies the template skeleton (structure + contracts + deterministic tooling + example config),
 * renaming the shipped `gitignore` to `.gitignore`. Zero dependencies — the instance runs on Bun's
 * node built-ins, so there's nothing to install. Tools (a message platform, a chat system, …) can
 * invoke this same init to build a memex for a user, with permission.
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PKG_ROOT = join(import.meta.dir, "..");
const TEMPLATE = join(PKG_ROOT, "template");

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const from = join(src, e.name);
    const name = e.name === "gitignore" ? ".gitignore" : e.name; // ship as `gitignore`, write as `.gitignore`
    const to = join(dst, name);
    if (e.isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

const cmd = process.argv[2];

if (cmd === "--version" || cmd === "-v") {
  const v = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
  console.log(`memex ${v}`);
  process.exit(0);
}

// `memex user …` — manage partitions inside the current instance (cwd or $MEMEX_ROOT) by delegating
// to that instance's own scripts/users.ts (the canonical engine; v3.3 multi-tenancy).
if (cmd === "user") {
  const root = process.env.MEMEX_ROOT ?? process.cwd();
  const script = join(root, "scripts", "users.ts");
  if (!existsSync(script)) {
    console.error(`✗ no memex here (${script} missing) — run inside an instance, or set MEMEX_ROOT`);
    process.exit(1);
  }
  const r = Bun.spawnSync(["bun", script, ...process.argv.slice(3)], { stdout: "inherit", stderr: "inherit" });
  process.exit(r.exitCode ?? 0);
}

if (cmd !== "init") {
  console.log("usage:\n  memex init [dir]   scaffold a new memex (default ./memex)\n  memex --version");
  process.exit(cmd ? 1 : 0);
}

const target = resolve(process.argv[3] ?? "memex"); // handles relative + absolute paths
if (existsSync(target) && readdirSync(target).filter((f) => f !== ".DS_Store").length) {
  console.error(`✗ ${target} already exists and isn't empty — choose another path.`);
  process.exit(1);
}

copyDir(TEMPLATE, target);
console.log(`✓ memex scaffolded at ${target}`);
console.log("  next:");
console.log(`    cd ${target}`);
console.log("    open STRUCTURE.md  · fill self/00-identity.md  · edit clients/models.json");
console.log("    bun scripts/validate.ts   # confirm the structure is sound");
console.log("    git init && git add -A && git commit -m \"my memex\"   # your data is gitignored by default");
