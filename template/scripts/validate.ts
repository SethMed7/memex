#!/usr/bin/env bun
/**
 * smBrain invariants gate — the guard that keeps the structure from drifting.
 * Run on demand (`bun scripts/validate.ts`) and by a scheduled check. Exits non-zero
 * on any ERROR; warnings (⚠) are nudges, not failures.
 *
 * Checks:
 *   (a) smBrain is text-only — no binaries (they belong in smStorage via `storage:`)
 *   (b) every `storage:` reference resolves under ~/smStorage/smBrain/
 *   (c) every self/ + wiki/ note appears in MAP.md
 *   (d) no dangling [[wikilinks]]
 *   (e) wiki/ notes carry frontmatter (summary/tags/updated)
 *   (+) orphan smStorage/smBrain assets that no note references (warning)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { homedir } from "node:os";

const BRAIN = join(import.meta.dir, "..");
const STORAGE = join(homedir(), "smStorage", "smBrain");

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".svg", ".ico",
  ".mp3", ".m4a", ".wav", ".aac", ".mp4", ".mov", ".webm",
  ".pdf", ".zip", ".tar", ".gz", ".bundle", ".icns", ".key", ".sqlite", ".db",
]);

function walk(dir: string, out: string[] = []): string[] {
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
// Strip fenced + inline code so illustrative examples in docs/templates aren't
// mistaken for real refs/links.
const prose = (t: string) => t.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
const isTemplate = (f: string) => rel(f).includes("/_templates/");

const all = walk(BRAIN);
const notes = all.filter((f) => f.endsWith(".md"));

// (a) text-only
for (const f of all) {
  if (BINARY_EXT.has(extname(f).toLowerCase())) {
    errors.push(`binary in smBrain: ${rel(f)} — move to smStorage and reference with storage:`);
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
  const name = basename(f, ".md");
  if (!MAP.includes(name)) warnings.push(`not in MAP.md: ${rel(f)}`);
}

// (d) dangling [[links]]
const noteBasenames = new Set(notes.map((f) => basename(f, ".md")));
const noteRelNoExt = notes.map((f) => rel(f).replace(/\.md$/, ""));
const linkResolves = (t: string) => noteBasenames.has(basename(t)) || noteRelNoExt.some((r) => r.endsWith(t));
for (const f of notes) {
  if (isTemplate(f)) continue; // templates contain placeholder links by design
  for (const m of prose(read(f)).matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = m[1].split("|")[0].split("#")[0].trim();
    if (!linkResolves(target)) warnings.push(`dangling [[${target}]] in ${rel(f)}`);
  }
}

// (d2) chats/ — named conversations: frontmatter (title + source), attachedTo resolves, in MAP
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
      // reach is bidirectional: the attached note must link back to the chat
      const slug = basename(f, ".md");
      const noteFile = notes.find((n) => basename(n, ".md") === basename(targetName) || rel(n).replace(/\.md$/, "").endsWith(targetName));
      if (noteFile && !read(noteFile).includes(`[[${slug}]]`)) {
        warnings.push(`chat ${rel(f)} → [[${targetName}]] but that note doesn't link back ([[${slug}]]) — not bidirectional`);
      }
    }
  }
  if (!MAP.includes(basename(f, ".md"))) warnings.push(`not in MAP.md: ${rel(f)}`);
}

// (d3) non-bleed: each surface stays in its lane (conversations don't co-mingle)
for (const f of notes) {
  const r = rel(f);
  if (r.startsWith("history/") && basename(f).toLowerCase() !== "readme.md" && !/\d{4}-\d{2}-\d{2}\.md$/.test(f)) {
    warnings.push(`non-bleed: ${r} isn't a daily — history/ is the message-platform stream (YYYY-MM-DD.md); named chats go in chats/`);
  }
}

// (d4) client layer registry is well-formed (load-bearing — a break = error)
const reg = join(BRAIN, "clients", "models.json");
if (existsSync(reg)) {
  try {
    const r = JSON.parse(read(reg));
    if (!Array.isArray(r.models) || !r.default) errors.push("clients/models.json missing models[] or default");
  } catch (e) {
    errors.push(`clients/models.json invalid JSON: ${String(e).slice(0, 80)}`);
  }
}

// (d5) config governance (the Configuration Rule's spine is load-bearing)
if (!existsSync(join(BRAIN, "STRUCTURE.md"))) errors.push("STRUCTURE.md missing — the layout contract tools resolve against");
const configDoc = join(BRAIN, "CONFIG.md");
if (!existsSync(configDoc)) {
  errors.push("CONFIG.md missing — the Configuration Rule + knob index");
} else {
  const c = read(configDoc);
  // rule #6: every knob is indexed. (smBrain-local check; tool knobs live in their own repos.)
  if (existsSync(reg) && !c.includes("models.json")) warnings.push("CONFIG.md doesn't index clients/models.json (Configuration Rule #6: index every knob)");
}

// (d6) the brain makes NO LLM calls — only config for how an LLM talks to it (Configuration Rule #9)
const LLM_CALL = /localhost:11434|api\.(anthropic|openai)\.com|generativelanguage\.googleapis|["']\s*-p\s*["']/;
for (const f of all.filter((f) => f.endsWith(".ts") && rel(f).startsWith("scripts/") && basename(f) !== "validate.ts")) {
  if (LLM_CALL.test(read(f))) {
    errors.push(`LLM/model call in a brain script (${rel(f)}) — the brain holds NO LLM calls, only config for how a model talks to it (CONFIG.md Rule #9)`);
  }
}

// (e) frontmatter on wiki/ notes
for (const f of indexable.filter((f) => rel(f).startsWith("wiki/"))) {
  const head = read(f).slice(0, 400);
  if (!head.startsWith("---") || !/\nsummary:/.test(head)) {
    warnings.push(`missing frontmatter summary: ${rel(f)}`);
  }
}

// (+) orphan assets
if (existsSync(STORAGE)) {
  for (const a of walk(STORAGE)) {
    const r = relative(STORAGE, a);
    if (!referenced.has(r)) warnings.push(`orphan asset (no note references it): smStorage/smBrain/${r}`);
  }
}

console.log(`smBrain validate — ${notes.length} notes / ${all.length} files`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`\n✓ invariants pass${warnings.length ? ` (${warnings.length} warning(s) — non-blocking)` : ""}`);
