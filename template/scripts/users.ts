#!/usr/bin/env bun
/**
 * memex users — manage the knowledge partitions ("users") this memex holds. Pure file operations:
 * NO LLM calls, NO network (Configuration Rule #9). The connected app (Breve, …) wraps these as its
 * own commands; memex is the authority for scaffolding a partition and editing the registry.
 *
 *   bun scripts/users.ts list
 *   bun scripts/users.ts add <name>                 scaffold users/<name>/ + register as a member
 *   bun scripts/users.ts remove <name> [--purge]    deregister (data kept); --purge moves it to trash/
 *   bun scripts/users.ts init-primary <name> [--migrate]
 *                                                   establish the registry with <name> as primary;
 *                                                   --migrate moves the root spine into users/<name>/
 *
 * A partition is `self/ wiki/ history/ chats/ inbox.md MAP.md` under users/<name>/ (or the repo root
 * for an unmigrated primary). The registry users.json is committed (names/roles/paths are not
 * secrets). memex DECLARES partitions + roles; the connected app ENFORCES access at runtime.
 */
import {
  readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync,
} from "node:fs";
import { join } from "node:path";
import { RESERVED, type Registry, type UserEntry } from "./mounts.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const REGISTRY = join(REPO_ROOT, "users.json");
const SKELETON = join(import.meta.dir, "user-skeleton");
const SPINE = ["self", "wiki", "history", "chats", "inbox.md", "MAP.md"];
const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

const today = () => new Date().toISOString().slice(0, 10);
const die = (msg: string): never => { console.error(`✗ ${msg}`); process.exit(1); };

function readRegistry(): Registry | null {
  if (!existsSync(REGISTRY)) return null;
  try {
    const raw = JSON.parse(readFileSync(REGISTRY, "utf8"));
    if (!Array.isArray(raw?.users) || typeof raw?.primary !== "string") die("users.json is malformed (need {version, primary, users[]})");
    return raw as Registry;
  } catch (e) { return die(`users.json is invalid JSON — refusing to overwrite: ${String(e).slice(0, 80)}`); }
}

/** Atomic registry write: temp file + rename (no torn registry on crash). */
function writeRegistry(reg: Registry): void {
  const tmp = `${REGISTRY}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
  renameSync(tmp, REGISTRY);
}

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const from = join(src, e.name), to = join(dst, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

/** Lay down a partition's spine from the data-free skeleton (idempotent: never clobbers existing files). */
function scaffold(dir: string): void {
  if (!existsSync(SKELETON)) die(`missing scaffold source ${SKELETON} (re-run from a memex with scripts/user-skeleton/)`);
  mkdirSync(dir, { recursive: true });
  for (const item of SPINE) {
    const src = join(SKELETON, item), dst = join(dir, item);
    if (existsSync(dst)) continue; // heal-only: leave existing partition content untouched
    if (!existsSync(src)) continue;
    const isDir = readdirSync(SKELETON, { withFileTypes: true }).find((e) => e.name === item)?.isDirectory();
    if (isDir) copyDir(src, dst); else copyFileSync(src, dst);
  }
}

function validateName(name: string, reg: Registry | null): void {
  if (!name) die("a partition name is required");
  if (!SLUG.test(name)) die(`"${name}" must be a lowercase slug (a-z 0-9 -, 2–40 chars, no leading/trailing dash)`);
  if (RESERVED.has(name)) die(`"${name}" is a reserved name`);
  if (existsSync(join(REPO_ROOT, name))) die(`"${name}" collides with an existing top-level dir/file`);
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────
const [cmd, name, ...flags] = process.argv.slice(2);
const has = (f: string) => flags.includes(f);

if (cmd === "list") {
  const reg = readRegistry();
  if (!reg) { console.log("single-tenant: one implicit default user at the repo root (no users.json)"); process.exit(0); }
  console.log(`registry v${reg.version} · primary: ${reg.primary}`);
  for (const u of reg.users) {
    console.log(`  ${u.name === reg.primary ? "★" : "·"} ${u.name.padEnd(20)} ${u.role.padEnd(7)} ${u.path || "(repo root)"}`);
  }
  process.exit(0);
}

if (cmd === "add") {
  const reg = readRegistry();
  if (!reg) die("no registry yet — run `bun scripts/users.ts init-primary <you>` first to establish the primary partition");
  validateName(name, reg);
  const dir = join(REPO_ROOT, "users", name);
  const existing = reg!.users.find((u) => u.name === name);
  if (existing) {
    scaffold(dir); // heal a missing/partial partition dir without touching the registry
    console.log(`✓ "${name}" already registered (${existing.role}) — partition healed at users/${name}/`);
    process.exit(0);
  }
  scaffold(dir);
  reg!.users.push({ name, role: "member", path: `users/${name}`, createdAt: today() });
  writeRegistry(reg!);
  console.log(`✓ added member "${name}" → users/${name}/`);
  console.log(`  next: bun scripts/validate.ts --all`);
  process.exit(0);
}

if (cmd === "remove") {
  const reg = readRegistry();
  if (!reg) die("single-tenant: nothing to remove");
  const idx = reg!.users.findIndex((u) => u.name === name);
  if (idx < 0) { console.log(`"${name}" is not registered — nothing to do`); process.exit(0); }
  if (reg!.primary === name) die(`"${name}" is the primary — set a different primary before removing it`);
  const entry = reg!.users[idx];
  reg!.users.splice(idx, 1);
  writeRegistry(reg!);
  const dir = entry.path ? join(REPO_ROOT, entry.path) : null;
  if (has("--purge") && dir && existsSync(dir)) {
    const dest = join(REPO_ROOT, "trash", `${name}-${today()}`);
    mkdirSync(join(REPO_ROOT, "trash"), { recursive: true });
    renameSync(dir, dest);
    console.log(`✓ deregistered "${name}" and moved its data to trash/${name}-${today()}/ (reversible)`);
  } else {
    console.log(`✓ deregistered "${name}"${dir && existsSync(dir) ? ` — data left at ${entry.path}/ (remove it deliberately, or re-add to restore)` : ""}`);
  }
  process.exit(0);
}

if (cmd === "init-primary") {
  if (readRegistry()) die("a registry already exists — init-primary only establishes the first one");
  validateName(name, null);
  const migrate = has("--migrate");
  const path = migrate ? `users/${name}` : "";
  if (migrate) {
    const dir = join(REPO_ROOT, "users", name);
    if (existsSync(dir)) die(`users/${name}/ already exists`);
    mkdirSync(dir, { recursive: true });
    const moved: Array<[string, string]> = [];
    try {
      for (const item of SPINE) {
        const from = join(REPO_ROOT, item);
        if (!existsSync(from)) continue;
        const to = join(dir, item);
        renameSync(from, to);
        moved.push([from, to]);
      }
    } catch (e) {
      for (const [from, to] of moved.reverse()) try { renameSync(to, from); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      die(`migration failed, rolled back: ${String(e).slice(0, 100)}`);
    }
  }
  const reg: Registry = { version: 1, primary: name, users: [{ name, role: "admin", path, createdAt: today() }] };
  writeRegistry(reg);
  console.log(`✓ registry established · primary "${name}" (admin) at ${path || "the repo root"}`);
  if (migrate) console.log(`  moved the root spine into users/${name}/ — run \`bun scripts/validate.ts --all\` then commit`);
  else console.log(`  the primary stays flat at the repo root; add members with \`bun scripts/users.ts add <name>\``);
  process.exit(0);
}

console.log("usage: bun scripts/users.ts list | add <name> | remove <name> [--purge] | init-primary <name> [--migrate]");
process.exit(cmd ? 1 : 0);

export {}; // module marker (CLI-only)
