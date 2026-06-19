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
import { readdirSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

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

// `memex user|id|connect|apps|heal|trash|purge …` — operate on the current instance (cwd or
// $MEMEX_ROOT) by delegating to its own engine scripts (the canonical, in-instance tooling).
if (["user", "id", "connect", "apps", "heal", "trash", "purge"].includes(cmd ?? "")) {
  const root = process.env.MEMEX_ROOT ?? process.cwd();
  const exec = (scriptName: string, args: string[]): number => {
    const s = join(root, "scripts", scriptName);
    if (!existsSync(s)) { console.error(`✗ no memex here (${s} missing) — run inside an instance, or set MEMEX_ROOT`); process.exit(1); }
    return Bun.spawnSync(["bun", s, ...args], { stdout: "inherit", stderr: "inherit" }).exitCode ?? 0;
  };
  const tail = process.argv.slice(3);
  let code = 0;
  if (cmd === "user") code = exec("users.ts", tail);
  else if (cmd === "heal") code = exec("heal.ts", tail);
  else if (cmd === "trash") code = exec("heal.ts", ["trash", ...tail]);
  else if (cmd === "purge") code = exec("heal.ts", ["purge", ...tail]);
  else if (cmd === "connect") { code = exec("mounts.ts", ["connect", ...tail]); if (code === 0) exec("heal.ts", []); } // auto-heal on plug-in
  else code = exec("mounts.ts", [cmd!, ...tail]); // id, apps
  process.exit(code);
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
// Stamp a unique instance identity (committed, non-secret) so apps can pin to THIS memex + plug in
// additively. Generated per-instance (never shipped in the template — that'd give every memex the same id).
const contract = (readFileSync(join(TEMPLATE, "STRUCTURE.md"), "utf8").match(/v(\d+\.\d+)/) ?? [, "3.3"])[1];
writeFileSync(join(target, "memex.json"), JSON.stringify({ id: `mx_${randomUUID()}`, contract, createdAt: new Date().toISOString(), selfHeal: true, apps: {} }, null, 2) + "\n");
console.log(`✓ memex scaffolded at ${target}`);
console.log("  next:");
console.log(`    cd ${target}`);
console.log("    open STRUCTURE.md  · fill self/00-identity.md  · edit clients/models.json");
console.log("    bun scripts/validate.ts   # confirm the structure is sound");
console.log("    git init && git add -A && git commit -m \"my memex\"   # your data is gitignored by default");
