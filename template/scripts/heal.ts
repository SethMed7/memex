#!/usr/bin/env bun
/**
 * memex self-heal + delete-safety. Pure file ops (no LLM/network).
 *
 * SELF-HEAL — recreate ONLY what's MISSING (data dirs + each partition's spine), from the data-free
 * skeleton, NEVER overwriting or deleting an existing file. Idempotent. An app calls ensureHealthy()
 * on plug-in/startup to rebuild what it needs. Gated by memex.json `selfHeal` (default true).
 *
 * DELETE-SAFETY — no app ever hard-deletes. trash() MOVES a path into trash/ (reversible) and REFUSES
 * the protected structure (the contract dirs + spine files). Only the operator truly deletes, via
 * `purge --confirm` (or by hand). So nothing is ever lost without your hand, and the spine is never
 * removable by an app.
 *
 *   bun scripts/heal.ts [--dry]        recreate missing structure (all partitions)
 *   bun scripts/heal.ts trash <path>   move a path into trash/ (refuses protected structure)
 *   bun scripts/heal.ts purge --confirm [name]   HARD-delete trash contents (operator only)
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { REPO_ROOT, registry, userRoot, RESERVED, memexInfo } from "./mounts.ts";

const SKELETON = join(import.meta.dir, "user-skeleton");
const SPINE = ["self", "wiki", "history", "chats", "inbox.md", "MAP.md"];
const REPO_DATA_DIRS = ["archive", "trash"]; // recoverable data dirs (engine dirs scripts/clients come from the package)
const TRASH = () => join(REPO_ROOT, "trash");

/** Protected structural names — never trashable/deletable by an app. The spine + the contract files. */
const PROTECTED = new Set<string>([
  ...RESERVED, // users scripts clients archive trash self wiki history chats
  "STRUCTURE.md", "CONFIG.md", "CHANGELOG.md", "ASSETS.md", "README.md",
  "MAP.md", "inbox.md", "users.json", "memex.json", "identities.local.json", "memex.local.json",
]);

/** Self-heal on by default; turn off with memex.json {"selfHeal": false}. */
export const selfHealEnabled = (): boolean => (memexInfo() as any)?.selfHeal !== false;

/** Recursively copy ONLY files that don't already exist in dst (heal-only — never clobber). */
function copyMissing(src: string, dst: string, dry: boolean, created: string[], relBase: string): void {
  if (!existsSync(dst)) { if (!dry) mkdirSync(dst, { recursive: true }); created.push(relBase + "/"); }
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const s = join(src, e.name), d = join(dst, e.name), r = `${relBase}/${e.name}`;
    if (e.isDirectory()) copyMissing(s, d, dry, created, r);
    else if (!existsSync(d)) { if (!dry) copyFileSync(s, d); created.push(r); }
  }
}

/** Ensure one partition's spine exists (from the skeleton), non-destructively. */
function healPartition(root: string, label: string, dry: boolean, created: string[]): void {
  if (!existsSync(SKELETON)) return;
  for (const item of SPINE) {
    const src = join(SKELETON, item), dst = join(root, item);
    if (existsSync(dst)) continue;
    const isDir = readdirSync(SKELETON, { withFileTypes: true }).find((e) => e.name === item)?.isDirectory();
    if (isDir) copyMissing(src, dst, dry, created, `${label}/${item}`);
    else if (existsSync(src)) { if (!dry) { mkdirSync(root, { recursive: true }); copyFileSync(src, dst); } created.push(`${label}/${item}`); }
  }
}

/** Recreate ONLY missing structure across the repo + every partition. Never overwrites/deletes. */
export function heal(opts: { dry?: boolean } = {}): string[] {
  const created: string[] = [];
  const dry = !!opts.dry;
  for (const d of REPO_DATA_DIRS) { const p = join(REPO_ROOT, d); if (!existsSync(p)) { if (!dry) mkdirSync(p, { recursive: true }); created.push(`${d}/`); } }
  const reg = registry();
  if (reg) for (const u of reg.users) healPartition(userRoot(u.name), u.path || u.name, dry, created);
  else healPartition(REPO_ROOT, ".", dry, created); // single-tenant: the root IS the spine
  return created;
}

/** What an app calls on plug-in/startup: heal if enabled (silent), returning what it recreated. */
export function ensureHealthy(): string[] {
  return selfHealEnabled() ? heal() : [];
}

const isProtected = (abs: string): boolean => {
  const rel = relative(REPO_ROOT, abs);
  if (rel === "" || rel.startsWith("..")) return true;          // the repo root itself
  if (PROTECTED.has(basename(abs))) return true;                // a contract file / structural dir name
  if (rel.split("/").length <= 1 && PROTECTED.has(rel)) return true;
  return false;
};

/** DELETE-SAFE: move a path into trash/<rel>-<stamp>/ (reversible). Refuses protected structure; never
 *  hard-deletes. `now` passed in (no Date in engines). Returns the trash destination, or an error. */
export function trash(absPath: string, opts: { now: string }): { ok: boolean; reason?: string; dest?: string } {
  if (!existsSync(absPath)) return { ok: false, reason: "no such path" };
  if (isProtected(absPath)) return { ok: false, reason: "protected structure — apps can't delete the spine/contract" };
  const rel = relative(REPO_ROOT, absPath).replace(/\//g, "__");
  mkdirSync(TRASH(), { recursive: true });
  const dest = join(TRASH(), `${rel}-${opts.now.replace(/[:.]/g, "")}`);
  renameSync(absPath, dest);
  return { ok: true, dest };
}

/** HARD-delete trash contents — the ONLY true delete, operator-gated (--confirm). */
export function purge(opts: { confirm: boolean; name?: string }): { ok: boolean; removed: string[]; reason?: string } {
  if (!opts.confirm) return { ok: false, removed: [], reason: "purge needs --confirm (this is the only real delete)" };
  if (!existsSync(TRASH())) return { ok: true, removed: [] };
  const items = opts.name ? [opts.name] : readdirSync(TRASH()).filter((n) => n.toLowerCase() !== "readme.md");
  const removed: string[] = [];
  for (const n of items) { const p = join(TRASH(), n); if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(n); } }
  return { ok: true, removed };
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const now = new Date().toISOString();
  if (cmd === "trash") {
    const target = rest[0];
    if (!target) { console.error("usage: heal.ts trash <path>"); process.exit(1); }
    const abs = target.startsWith("/") ? target : join(REPO_ROOT, target);
    const r = trash(abs, { now });
    console.log(r.ok ? `✓ moved to ${relative(REPO_ROOT, r.dest!)}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "purge") {
    const r = purge({ confirm: rest.includes("--confirm"), name: rest.find((a) => !a.startsWith("--")) });
    console.log(r.ok ? `✓ purged: ${r.removed.join(", ") || "(nothing)"}` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  } else {
    const dry = rest.includes("--dry") || cmd === "--dry";
    const created = heal({ dry });
    console.log(created.length ? `${dry ? "would recreate" : "recreated"} ${created.length} missing:\n  ${created.join("\n  ")}` : "✓ structure intact — nothing missing");
  }
}
