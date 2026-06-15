#!/usr/bin/env bun
/**
 * Keep MAP.md — the llmWiki spine — in sync with the tree. Purely DETERMINISTIC:
 * it reads each note's `summary:` frontmatter (preserving any summary already in
 * MAP.md when a note lacks one) and rewrites the index. The brain makes NO LLM
 * calls — drafting summaries, suggesting links, and triaging the inbox is done by
 * whoever is talking to the brain (a tool, or a working Claude session via /brain),
 * never by the brain itself. See CONFIG.md → The Configuration Rule.
 *
 * Findability (v3): MAP becomes the trail dashboard. Each note line carries an inbound
 * backlink trail suffix (`… ← [[srcA]] · [[srcB]]`) so Vannevar Bush's two-way trails run
 * both directions, and two awareness sections — Orphans (nothing links to them) + Unlinked
 * mentions (a title in plain prose) — are appended from the shared scripts/links.ts passes.
 * Backlinks are GENERATED into MAP.md only (never into note files); MAP is regenerated
 * wholesale + gitignored, so there's zero idempotency risk. Gated by the `findability` config.
 *
 *   bun scripts/organize.ts            regenerate MAP.md from the notes.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";
import {
  prose, buildNoteRecords, buildBacklinkIndex,
  findOrphans, findUnlinkedMentions, duplicateBasenames, displayTarget, loadFindabilityConfig,
  type NoteRecord,
} from "./links.ts";

const BRAIN = join(import.meta.dir, "..");
// Local day (no Date.now leak beyond this Intl helper) — for the orphan grace check.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

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

// Preserve hand-written summaries already in MAP.md when a note lacks frontmatter. Harvested
// line-by-line (NOT a whole-file regex) so we can: (1) skip the generated awareness sections, whose
// `- [[x]] mentions [[y]] — …` lines also match the def shape and would poison prev; (2) strip the
// generated backlink-trail suffix (cut at the first `  ←  `) so a re-read summary never captures the
// trail and compounds it on the next run (idempotent round-trip). Only strict definition lines
// (`- [[base]] — <summary>`) before any `←`/`mentions` are harvested.
const prevMap = existsSync(join(BRAIN, "MAP.md")) ? readFileSync(join(BRAIN, "MAP.md"), "utf8") : "";
const prev: Record<string, string> = {};
let inAwareness = false;
for (const raw of prose(prevMap).split("\n")) {
  if (/^##\s+(Orphans|Unlinked mentions)\b/.test(raw)) { inAwareness = true; continue; }
  if (/^##\s/.test(raw)) { inAwareness = false; continue; }
  if (inAwareness) continue;
  const m = raw.match(/^\s*- \[\[([^\]\]|#]+)[^\]]*\]\]\s*—\s*(.+)$/);
  if (!m) continue;
  const summary = m[2].split("  ←  ")[0].trim(); // drop the generated trail suffix
  if (summary) prev[basename(m[1].trim())] = summary;
}

const summaryOf = (file: string): string => frontmatterSummary(file) || prev[basename(file, ".md")] || "—";

// ── findability index (shared scripts/links.ts) — backlink trails + Orphans + Unlinked mentions ──────
let registry: any = {};
try { registry = JSON.parse(readFileSync(join(BRAIN, "clients", "models.json"), "utf8")); } catch { /* defaults */ }
const findCfg = loadFindabilityConfig(registry);

// Walk ACTUAL note dirs (not the fixed section list) so the index spans every link target.
const walkMd = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".DS_Store" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "_templates") walkMd(p, out); }
    else if (e.name.endsWith(".md") && e.name.toLowerCase() !== "readme.md") out.push(p);
  }
  return out;
};
const allNotes = ["self", "wiki", "chats", "history"].flatMap((d) => walkMd(join(BRAIN, d)));
const records: NoteRecord[] = findCfg.enabled ? buildNoteRecords(allNotes, BRAIN) : [];
const recById = new Map(records.map((r) => [r.canonicalId, r]));
const backlinkIndex = findCfg.enabled
  ? buildBacklinkIndex(records, (f) => readFileSync(f, "utf8")).backlinks
  : new Map<string, string[]>();
// Basenames shared by >1 note — render those as the disambiguating canonicalId so a trail never shows
// `[[api]] · [[api]]` (ambiguous + duplicated). Used by trail()/orphan/mention output.
const dupes = duplicateBasenames(records);
const show = (id: string): string => { const r = recById.get(id); return r ? displayTarget(r, dupes) : basename(id); };

// inbound trail suffix for a note's MAP line: `  ←  [[srcA]] · [[srcB]]` (sources sorted by canonicalId,
// rendered disambiguation-safe). Empty when there are no inbound links (clean) or findability is off.
const trail = (file: string): string => {
  if (!findCfg.enabled) return "";
  const id = relative(BRAIN, file).replace(/\.md$/, "");
  const sources = backlinkIndex.get(id);
  if (!sources?.length) return "";
  return "  ←  " + sources.map((s) => `[[${show(s)}]]`).join(" · ");
};

const line = (file: string, indent = "") => `${indent}- [[${basename(file, ".md")}]] — ${summaryOf(file)}${trail(file)}`;

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

// ── findability awareness sections (the spine becomes the trail dashboard) ──────────────────────────
// Built from the SAME index + the orphan/mention passes in scripts/links.ts, so MAP surfaces the work
// validate.ts warns about — the model SEES findability gaps without running validate. Off → skipped.
if (findCfg.enabled) {
  // indexable = self/ + wiki/ (the orphan/mention scope), already README/templates-filtered by walkMd
  const indexable = records.filter((r) => r.canonicalId === "self" || r.canonicalId.startsWith("self/") || r.canonicalId.startsWith("wiki/"));
  const isIndexable = (r: NoteRecord) => r.canonicalId === "self" || r.canonicalId.startsWith("self/") || r.canonicalId.startsWith("wiki/");
  const todayStr = today();
  const readFile = (f: string) => readFileSync(f, "utf8");

  // Orphans — shared findOrphans (links.ts), the SAME definition the gate uses, so MAP can never say
  // "Orphans: none" while validate warns orphan on the same note. A note that links OUT but has nothing
  // linking to IT is an orphan even though it appears as a SOURCE in its targets' trails (no escape
  // hatch for trail-sources). Sorted by canonicalId; rendered disambiguation-safe.
  out.push("", "## Orphans — notes nothing links to");
  const orphans = findOrphans(records, backlinkIndex, findCfg, readFile, todayStr, isIndexable);
  if (orphans.length) for (const r of orphans) out.push(`- [[${displayTarget(r, dupes)}]]`);
  else out.push("_(none)_");

  // Unlinked mentions — a title/alias in another note's plain prose, never [[linked]]. Shared
  // findUnlinkedMentions (links.ts) — same scan as validate (g). dict = indexable targets; sources =
  // indexable, plus history/chats only when scanConversations. Rendered disambiguation-safe.
  out.push("", "## Unlinked mentions");
  const sources = findCfg.mention.scanConversations ? records : indexable;
  const findings = findUnlinkedMentions(sources, indexable, findCfg, readFile, backlinkIndex);
  if (findings.length) for (const f of findings) out.push(`- [[${show(f.source)}]] mentions [[${show(f.target)}]] — consider linking`);
  else out.push("_(none)_");
}

writeFileSync(join(BRAIN, "MAP.md"), out.join("\n") + "\n");
const noteCount = out.filter((l) => l.includes("[[")).length;
console.log(`✓ MAP.md regenerated — ${noteCount} notes indexed`);
