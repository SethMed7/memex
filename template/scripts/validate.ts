#!/usr/bin/env bun
/**
 * memex invariants gate — the guard that keeps the structure from drifting.
 * Run on demand (`bun scripts/validate.ts`) and on a schedule. Exits non-zero on any
 * ERROR; warnings (⚠) are nudges, not failures.
 *
 * Checks:
 *   (a) text-only — no binaries (they belong in the asset store via `storage:`)
 *   (b) every `storage:` reference resolves in the asset store
 *   (c) every self/ + wiki/ note appears in MAP.md
 *   (d) no dangling [[wikilinks]]; (d2) chats well-formed + bidirectional; (d3) conversations don't bleed
 *   (d4) client registry valid; (d5) config spine present; (d6) NO LLM calls in scripts; (d7) NO secrets
 *   (e) wiki/ notes carry frontmatter (summary/tags/updated)
 *   (+) orphan assets that no note references (warning)
 *
 * Asset store (the `storage:` root) resolves from: $MEMEX_ASSETS → memex.local.json "assetsPath"
 * → sibling `../<dir>-assets`. memex is text-only; binaries live there. See ASSETS.md.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { homedir } from "node:os";

const BRAIN = join(import.meta.dir, "..");
const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);
function assetsRoot(): string {
  if (process.env.MEMEX_ASSETS) return expand(process.env.MEMEX_ASSETS);
  try {
    const c = JSON.parse(readFileSync(join(BRAIN, "memex.local.json"), "utf8"));
    if (c.assetsPath) return expand(c.assetsPath);
  } catch { /* fall through */ }
  return join(BRAIN, "..", `${basename(BRAIN)}-assets`);
}
const STORAGE = assetsRoot();

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".svg", ".ico",
  ".mp3", ".m4a", ".wav", ".aac", ".mp4", ".mov", ".webm",
  ".pdf", ".zip", ".tar", ".gz", ".bundle", ".icns", ".sqlite", ".db",
]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".DS_Store") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const errors: string[] = [];
const warnings: string[] = [];
const rel = (f: string) => relative(BRAIN, f);
const read = (f: string) => readFileSync(f, "utf8");
// Strip fenced + inline code so illustrative examples in docs/templates aren't mistaken for real refs.
const prose = (t: string) => t.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
const isTemplate = (f: string) => rel(f).includes("/_templates/");

const all = walk(BRAIN);
const notes = all.filter((f) => f.endsWith(".md"));

// (a) text-only
for (const f of all) {
  if (BINARY_EXT.has(extname(f).toLowerCase())) {
    errors.push(`binary in the memex: ${rel(f)} — move it to the asset store and reference with storage:`);
  }
}

// (b) storage: refs resolve
const STORAGE_RE = /storage:([A-Za-z0-9._/-]+)/g;
const referenced = new Set<string>();
for (const f of notes) {
  for (const m of prose(read(f)).matchAll(STORAGE_RE)) {
    referenced.add(m[1]);
    if (!existsSync(join(STORAGE, m[1]))) errors.push(`broken asset ref in ${rel(f)}: storage:${m[1]}`);
  }
}

// indexable notes = self/ + wiki/ excluding templates and folder READMEs
const indexable = notes.filter((f) => {
  const r = rel(f);
  if (!(r.startsWith("self/") || r.startsWith("wiki/"))) return false;
  if (r.includes("/_templates/")) return false;
  if (basename(f).toLowerCase() === "readme.md") return false;
  return true;
});

// (c) MAP coverage
const mapPath = join(BRAIN, "MAP.md");
const MAP = existsSync(mapPath) ? read(mapPath) : "";
for (const f of indexable) {
  if (!MAP.includes(basename(f, ".md"))) warnings.push(`not in MAP.md: ${rel(f)}`);
}

// (d) dangling [[links]]
const noteBasenames = new Set(notes.map((f) => basename(f, ".md")));
const noteRelNoExt = notes.map((f) => rel(f).replace(/\.md$/, ""));
const linkResolves = (t: string) => noteBasenames.has(basename(t)) || noteRelNoExt.some((r) => r.endsWith(t));
for (const f of notes) {
  if (isTemplate(f)) continue;
  for (const m of prose(read(f)).matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = m[1].split("|")[0].split("#")[0].trim();
    if (!linkResolves(target)) warnings.push(`dangling [[${target}]] in ${rel(f)}`);
  }
}

// (d2) chats/ — frontmatter (title + source), attachedTo resolves + is bidirectional, in MAP
const chats = notes.filter((f) => rel(f).startsWith("chats/") && basename(f).toLowerCase() !== "readme.md");
for (const f of chats) {
  const head = read(f).slice(0, 600);
  if (!head.startsWith("---") || !/\ntitle:/.test(head) || !/\nsource:/.test(head)) {
    warnings.push(`chat missing title/source frontmatter: ${rel(f)}`);
  }
  const at = head.match(/\nattachedTo:\s*\[\[([^\]]+)\]\]/);
  if (at) {
    const targetName = at[1].split("|")[0].trim();
    if (!linkResolves(targetName)) warnings.push(`chat attachedTo dangling [[${targetName}]]: ${rel(f)}`);
    else {
      const slug = basename(f, ".md");
      const noteFile = notes.find((n) => basename(n, ".md") === basename(targetName) || rel(n).replace(/\.md$/, "").endsWith(targetName));
      if (noteFile && !read(noteFile).includes(`[[${slug}]]`)) {
        warnings.push(`chat ${rel(f)} → [[${targetName}]] but that note doesn't link back ([[${slug}]]) — not bidirectional`);
      }
    }
  }
  if (!MAP.includes(basename(f, ".md"))) warnings.push(`not in MAP.md: ${rel(f)}`);
}

// (d3) non-bleed: each conversation surface stays in its lane
for (const f of notes) {
  const r = rel(f);
  if (r.startsWith("history/") && basename(f).toLowerCase() !== "readme.md" && !/\d{4}-\d{2}-\d{2}\.md$/.test(f)) {
    warnings.push(`non-bleed: ${r} isn't a daily — history/ is the by-day stream (YYYY-MM-DD.md); named chats go in chats/`);
  }
}

// (d4) client registry well-formed (load-bearing)
const reg = join(BRAIN, "clients", "models.json");
if (existsSync(reg)) {
  try {
    const r = JSON.parse(read(reg));
    if (!Array.isArray(r.models) || !r.default) errors.push("clients/models.json missing models[] or default");
  } catch (e) {
    errors.push(`clients/models.json invalid JSON: ${String(e).slice(0, 80)}`);
  }
}

// (d5) config spine present (the Configuration Rule)
if (!existsSync(join(BRAIN, "STRUCTURE.md"))) errors.push("STRUCTURE.md missing — the layout contract");
const configDoc = join(BRAIN, "CONFIG.md");
if (!existsSync(configDoc)) errors.push("CONFIG.md missing — the Configuration Rule + knob index");
else if (existsSync(reg) && !read(configDoc).includes("models.json")) {
  warnings.push("CONFIG.md doesn't index clients/models.json (Configuration Rule #6: index every knob)");
}

// (d6) the memex makes NO LLM calls — only config for how a model talks to it (Rule #9)
const LLM_CALL = /localhost:11434|api\.(anthropic|openai)\.com|generativelanguage\.googleapis|["']\s*-p\s*["']/;
for (const f of all.filter((f) => f.endsWith(".ts") && rel(f).startsWith("scripts/") && basename(f) !== "validate.ts")) {
  if (LLM_CALL.test(read(f))) {
    errors.push(`LLM/model call in a memex script (${rel(f)}) — the memex makes NO LLM calls (CONFIG.md Rule #9)`);
  }
}

// (d7) NO secrets in the memex — they belong in your OS keychain, never in files (security)
const SECRET = /sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{40,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[a-zA-Z0-9-]{10,}|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/;
for (const f of all.filter((f) => /\.(md|ts|json|sh|txt|ya?ml|env)$/.test(f) && basename(f) !== "validate.ts")) {
  if (SECRET.test(read(f))) {
    errors.push(`possible secret committed in ${rel(f)} — secrets belong in your OS keychain / a gitignored *.local file, NEVER in the memex`);
  }
}

// (e) frontmatter on wiki/ notes
for (const f of indexable.filter((f) => rel(f).startsWith("wiki/"))) {
  const head = read(f).slice(0, 400);
  if (!head.startsWith("---") || !/\nsummary:/.test(head)) warnings.push(`missing frontmatter summary: ${rel(f)}`);
}

// (+) orphan assets
if (existsSync(STORAGE)) {
  for (const a of walk(STORAGE)) {
    const r = relative(STORAGE, a);
    if (!referenced.has(r)) warnings.push(`orphan asset (no note references it): ${r}`);
  }
}

console.log(`memex validate — ${notes.length} notes / ${all.length} files · assets: ${STORAGE.replace(homedir(), "~")}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`\n✓ invariants pass${warnings.length ? ` (${warnings.length} warning(s) — non-blocking)` : ""}`);
