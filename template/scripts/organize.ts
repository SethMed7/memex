#!/usr/bin/env bun
/**
 * Keep MAP.md — the llmWiki spine — in sync with the tree. Purely DETERMINISTIC:
 * it reads each note's `summary:` frontmatter (preserving any summary already in
 * MAP.md when a note lacks one) and rewrites the index. The brain makes NO LLM
 * calls — drafting summaries, suggesting links, and triaging the inbox is done by
 * whoever is talking to the brain (a tool, or a working Claude session via /brain),
 * never by the brain itself. See CONFIG.md → The Configuration Rule.
 *
 *   bun scripts/organize.ts            regenerate MAP.md from the notes.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const BRAIN = join(import.meta.dir, "..");

const mdFiles = (dir: string): string[] =>
  !existsSync(dir) ? [] :
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name.toLowerCase() !== "readme.md")
    .map((e) => join(dir, e.name)).sort();

const subDirs = (dir: string): string[] =>
  !existsSync(dir) ? [] :
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_templates").map((e) => e.name).sort();

function frontmatterSummary(file: string): string {
  const t = readFileSync(file, "utf8");
  if (!t.startsWith("---")) return "";
  const end = t.indexOf("\n---", 3);
  const fm = end > 0 ? t.slice(0, end) : t.slice(0, 400);
  return fm.match(/\nsummary:\s*(.+)/)?.[1]?.trim() ?? "";
}

// Preserve hand-written summaries already in MAP.md when a note lacks frontmatter.
const prevMap = existsSync(join(BRAIN, "MAP.md")) ? readFileSync(join(BRAIN, "MAP.md"), "utf8") : "";
const prev: Record<string, string> = {};
for (const m of prevMap.matchAll(/\[\[([^\]\]|#]+)[^\]]*\]\]\s*—\s*(.+)/g)) prev[basename(m[1].trim())] = m[2].trim();

const summaryOf = (file: string): string => frontmatterSummary(file) || prev[basename(file, ".md")] || "—";
const line = (file: string, indent = "") => `${indent}- [[${basename(file, ".md")}]] — ${summaryOf(file)}`;

const out: string[] = [
  "# MAP — the index",
  "",
  "The spine of the knowledge base: every note with a one-line summary so an LLM can decide what to",
  "open without reading everything. Regenerated deterministically by `scripts/organize.ts` (no LLM).",
  "Edit summaries in each note's `summary:` frontmatter — they flow here.",
];

function section(title: string, dir: string) {
  out.push("", `## ${title}`);
  for (const f of mdFiles(dir)) out.push(line(f));
  for (const sub of subDirs(dir)) {
    out.push(`- ${sub}/`);
    for (const f of mdFiles(join(dir, sub))) out.push(line(f, "  "));
    for (const ss of subDirs(join(dir, sub))) {
      out.push(`  - ${ss}/`);
      for (const f of mdFiles(join(dir, sub, ss))) out.push(line(f, "    "));
    }
  }
}

section("self/ — the whole person", join(BRAIN, "self"));
section("wiki/projects/", join(BRAIN, "wiki", "projects"));
section("wiki/research/", join(BRAIN, "wiki", "research"));
section("wiki/theology/", join(BRAIN, "wiki", "theology"));
section("wiki/reference/", join(BRAIN, "wiki", "reference"));
section("wiki/people/", join(BRAIN, "wiki", "people"));

// chats — named conversations
out.push("", "## chats/ — named conversations");
const chatFiles = mdFiles(join(BRAIN, "chats"));
if (chatFiles.length) {
  for (const f of chatFiles) {
    const head = readFileSync(f, "utf8").slice(0, 600);
    const title = head.match(/\ntitle:\s*(.+)/)?.[1]?.trim() || basename(f, ".md");
    const src = head.match(/\nsource:\s*(.+)/)?.[1]?.trim();
    const at = head.match(/\nattachedTo:\s*\[\[([^\]]+)\]\]/)?.[1]?.trim();
    out.push(`- [[${basename(f, ".md")}]] — ${title}${src ? ` · ${src}` : ""}${at ? ` → [[${at}]]` : ""}`);
  }
} else out.push("- _(none yet — see chats/README.md)_");

// recent dailies
const histYears = subDirs(join(BRAIN, "history"));
const dailies: string[] = [];
for (const y of histYears) for (const f of mdFiles(join(BRAIN, "history", y))) dailies.push(f);
out.push("", "## history/ — recent dailies");
if (dailies.length) for (const f of dailies.sort().slice(-10).reverse()) out.push(line(f));
else out.push("- _(none yet — written by the owning tool via the conversation contract)_");

writeFileSync(join(BRAIN, "MAP.md"), out.join("\n") + "\n");
const noteCount = out.filter((l) => l.includes("[[")).length;
console.log(`✓ MAP.md regenerated — ${noteCount} notes indexed`);
