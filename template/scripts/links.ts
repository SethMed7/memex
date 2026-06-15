#!/usr/bin/env bun
/**
 * FINDABILITY LAYER — the shared link/alias/resolution core. A leaf module (imports nothing from
 * the other scripts, like learn.ts), so organize.ts + validate.ts + learn.ts can all import it
 * without cycles. It ends the three divergent wikilink regexes / duplicated prose() helpers: this
 * file owns THE canonical wikilink regex and the one prose-strip, plus the alias-aware resolver, the
 * backlink index, and the orphan + unlinked-mention passes.
 *
 * memex is named for Vannevar Bush's two-way associative *trails*, but [[links]] ran one direction.
 * This makes them bidirectional (backlinks), flags notes nothing links to (orphans) and titles
 * mentioned in plain prose but never [[linked]] (unlinked mentions), and lets a note answer to more
 * than one name (aliases). All DETERMINISTIC: pure file I/O, matchAll only (never .test/.exec so
 * lastIndex can't leak), sorted output, no Date.now beyond the today() string a caller passes in.
 * The memex makes NO LLM calls (CONFIG.md Rule #9) — it FLAGS findability gaps; the model decides
 * what to link.
 *
 *   import { buildNoteRecords, buildAliasTable, buildBacklinkIndex, resolveTarget } from "./links.ts"
 *   const records = buildNoteRecords(notes, BRAIN);
 *   const { table } = buildAliasTable(records);
 *   const { backlinks } = buildBacklinkIndex(records, (f) => readFileSync(f, "utf8"));
 *   backlinks.get("wiki/projects/gateway")   // → sorted source canonicalIds that link to it
 *
 *   bun scripts/links.ts [backlinks|orphans|mentions]   # preview the findability passes on the CLI
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";

// ── canonical primitives (the single source for what was duplicated across scripts) ──────────────

/** THE canonical wikilink regex (the permissive validate.ts/learn.ts variant — captures the full
 *  inner, incl |alias and #anchor). ALWAYS consume via String.prototype.matchAll (stateless) so the
 *  global lastIndex never leaks between calls — never .test()/.exec() on this shared instance. */
export const WIKILINK: RegExp = /\[\[([^\]]+)\]\]/g;

/** Strip fenced ```…``` then inline `code` so doc/template examples aren't read as real refs. The
 *  single shared copy (identical to the old validate.ts:58 / learn.ts:104). Run BEFORE any link /
 *  alias / mention scan. */
export const prose = (t: string): string => t.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");

/** Split a captured wikilink inner (m[1]) into its target + optional display alias. Mirrors the
 *  existing m[1].split('|')[0].split('#')[0].trim() parse. */
export function parseLink(inner: string): { target: string; alias?: string } {
  return { target: inner.split("|")[0].split("#")[0].trim(), alias: inner.split("|")[1]?.trim() || undefined };
}

/** Deterministic frontmatter alias parse — no YAML lib. ONLY the inline bracket-list form
 *  `aliases: [A, B]` is supported (mirrors `tags: [topic]` / `participants: [you]`); the multi-line
 *  YAML list form is intentionally NOT supported, to keep parsing single-pathed. Absent/empty → []. */
export function parseAliases(fileText: string): string[] {
  const end = fileText.startsWith("---") ? fileText.indexOf("\n---", 3) : -1;
  const fm = end > 0 ? fileText.slice(0, end) : ""; // no opening/closing --- ⇒ no frontmatter (don't scan body)
  const m = fm.match(/\naliases:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

/** Resolution/comparison key: lowercase, collapse internal whitespace, trim. Keys the alias table +
 *  mention terms. Surface/display forms are kept separately — never lowercase what the user sees. */
export const normKey = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── note records ─────────────────────────────────────────────────────────────────────────────────

/** One record per .md note. canonicalId = rel(BRAIN,file) without .md (the unique key — basenames
 *  collide across folders); the note's name-set for resolution/mentions is basename + aliases (there
 *  is no `title:` in the note shape). updated drives the orphan grace check. */
export type NoteRecord = { file: string; canonicalId: string; basename: string; aliases: string[]; updated: string };

const frontmatterDate = (fileText: string): string => {
  const end = fileText.startsWith("---") ? fileText.indexOf("\n---", 3) : -1;
  const fm = end > 0 ? fileText.slice(0, end) : ""; // no opening/closing --- ⇒ no frontmatter (don't scan body)
  return (fm.match(/\nupdated:\s*(\S+)/)?.[1] ?? fm.match(/\ncreated:\s*(\S+)/)?.[1] ?? "").trim();
};

/** Map an already-walked .md file list to NoteRecords (the caller passes its own walk result, so each
 *  tool keeps its own scope). Pure, sorted by canonicalId. */
export function buildNoteRecords(notes: string[], brain: string): NoteRecord[] {
  return notes.map((file) => {
    const text = readFileSync(file, "utf8");
    return {
      file,
      canonicalId: relative(brain, file).replace(/\.md$/, ""),
      basename: basename(file, ".md"),
      aliases: parseAliases(text),
      updated: frontmatterDate(text),
    };
  }).sort((a, b) => (a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0));
}

// ── alias table ────────────────────────────────────────────────────────────────────────────────

/** Deterministic alias index. Insert order is FIXED so collisions resolve identically every run:
 *  (1) every basename, (2) every rel-no-ext canonicalId, (3) declared aliases — records iterated in
 *  canonicalId order, aliases in declared order. Key = normKey(name) → canonicalId; first registrant
 *  wins. A later DIFFERENT-canonicalId insert on an existing key → collisions[]. An alias whose
 *  normKey equals the note's OWN basename → redundant[] (not a collision). Self-alias is a no-op. */
export function buildAliasTable(records: NoteRecord[]): {
  table: Map<string, string>;
  collisions: Array<{ key: string; surface: string; kept: string; dropped: string }>;
  redundant: Array<{ canonicalId: string; alias: string }>;
} {
  const table = new Map<string, string>();
  // `collisions` records ONLY declared-alias collisions — the duplicate-concept smell (d9) warns on.
  // Basename↔basename clashes (e.g. many README.md across folders) are an inherent fact of the tree,
  // resolved by the path-suffix/basename tiebreaks in resolveTarget — NOT a user error, so not here.
  const collisions: Array<{ key: string; surface: string; kept: string; dropped: string }> = [];
  const redundant: Array<{ canonicalId: string; alias: string }> = [];
  // surface keeps the form a name was first written as, for collision reporting. isAlias gates (d9).
  const insert = (surface: string, canonicalId: string, isAlias: boolean) => {
    const key = normKey(surface);
    if (!key) return;
    const existing = table.get(key);
    if (existing === undefined) { table.set(key, canonicalId); return; }
    if (existing === canonicalId) return; // self-alias / same note: silent no-op
    if (isAlias) collisions.push({ key, surface, kept: existing, dropped: canonicalId });
  };
  for (const r of records) insert(r.basename, r.canonicalId, false);     // (1) basenames
  for (const r of records) insert(r.canonicalId, r.canonicalId, false);  // (2) full canonicalIds
  for (const r of records) for (const a of r.aliases) {                  // (3) declared aliases
    if (normKey(a) === normKey(r.basename)) { redundant.push({ canonicalId: r.canonicalId, alias: a }); continue; }
    insert(a, r.canonicalId, true);
  }
  return { table, collisions, redundant };
}

// ── target resolution ────────────────────────────────────────────────────────────────────────────

const tiebreak = (cands: string[]): string =>
  cands.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];

/** Resolve a wikilink target string to a canonicalId or null (dangling). Order, first match wins,
 *  deterministic: (a) exact canonicalId; (b) path-suffix (===target or endsWith('/'+target),
 *  shortest-then-lexicographic tiebreak); (c) basename match (same tiebreak); (d) alias table. The
 *  alias-aware superset of the old validate.ts linkResolves, so alias-only links no longer dangle. */
export function resolveTarget(rawTarget: string, records: NoteRecord[], aliasTable: Map<string, string>): string | null {
  const t = rawTarget.trim();
  if (!t) return null;
  // (a) exact canonicalId
  if (records.some((r) => r.canonicalId === t)) return t;
  // (b) path-suffix
  const suffix = records.filter((r) => r.canonicalId === t || r.canonicalId.endsWith("/" + t)).map((r) => r.canonicalId);
  if (suffix.length) return tiebreak(suffix);
  // (c) basename
  const wantBase = basename(t);
  const byBase = records.filter((r) => r.basename === wantBase).map((r) => r.canonicalId);
  if (byBase.length) return tiebreak(byBase);
  // (d) alias
  return aliasTable.get(normKey(t)) ?? null;
}

/** How many candidates resolveTarget weighed before the tiebreak (>1 ⇒ ambiguous). Internal. */
function resolveCandidateCount(rawTarget: string, records: NoteRecord[], aliasTable: Map<string, string>): number {
  const t = rawTarget.trim();
  if (!t) return 0;
  if (records.some((r) => r.canonicalId === t)) return 1;
  const suffix = records.filter((r) => r.canonicalId === t || r.canonicalId.endsWith("/" + t));
  if (suffix.length) return suffix.length;
  const wantBase = basename(t);
  const byBase = records.filter((r) => r.basename === wantBase);
  if (byBase.length) return byBase.length;
  return aliasTable.has(normKey(t)) ? 1 : 0;
}

// ── backlink index ────────────────────────────────────────────────────────────────────────────────

/** Single pass: for each source record S, prose-strip read(S.file), matchAll(WIKILINK), parseLink,
 *  resolveTarget; de-dupe targets per source; skip self-edges + dangling (those are validate's job).
 *  Invert into Map<targetCanonicalId, sortedSourceCanonicalId[]>. `ambiguous` collects any target
 *  whose resolution weighed >1 candidate. readFile is injected so the caller owns I/O. Byte-stable. */
export function buildBacklinkIndex(records: NoteRecord[], readFile: (f: string) => string): {
  backlinks: Map<string, string[]>;
  ambiguous: Array<{ source: string; target: string }>;
} {
  const aliasTable = buildAliasTable(records).table;
  const edges = new Map<string, Set<string>>(); // target → sources
  const ambiguous: Array<{ source: string; target: string }> = [];
  for (const s of records) {
    const seen = new Set<string>(); // de-dupe resolved targets per source
    for (const m of prose(readFile(s.file)).matchAll(WIKILINK)) {
      const { target } = parseLink(m[1]);
      const resolved = resolveTarget(target, records, aliasTable);
      if (!resolved || resolved === s.canonicalId || seen.has(resolved)) continue; // dangling / self / dup
      seen.add(resolved);
      if (resolveCandidateCount(target, records, aliasTable) > 1) ambiguous.push({ source: s.canonicalId, target: resolved });
      (edges.get(resolved) ?? edges.set(resolved, new Set()).get(resolved)!).add(s.canonicalId);
    }
  }
  const backlinks = new Map<string, string[]>();
  for (const [target, sources] of edges) {
    backlinks.set(target, [...sources].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  ambiguous.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return { backlinks, ambiguous };
}

// ── orphan exemptions ────────────────────────────────────────────────────────────────────────────

const daysBetween = (fromYmd: string, toYmd: string): number => {
  // Plain YYYY-MM-DD math via UTC midnight — NO Date.now/randomness. Non-parseable → Infinity (old).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return Infinity;
  const a = Date.parse(fromYmd + "T00:00:00Z"), b = Date.parse(toYmd + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
};

/** True if rec must NOT be flagged as an orphan: a structural/identity file (basename in
 *  cfg.orphan.exemptFiles), a self/ note when !includeSelf, frontmatter `standalone: true` or any tag
 *  in cfg.orphan.exemptTags, or updated within graceDays of todayStr (string/Date math on the
 *  YYYY-MM-DD strings — todayStr is passed in; NO Date.now here). */
export function isExemptFromOrphan(rec: NoteRecord, cfg: FindabilityConfig, fileText: string, todayStr: string): boolean {
  if (cfg.orphan.exemptFiles.includes(rec.basename + ".md")) return true;
  if (!cfg.orphan.includeSelf && (rec.canonicalId === "self" || rec.canonicalId.startsWith("self/"))) return true;
  const end = fileText.startsWith("---") ? fileText.indexOf("\n---", 3) : -1;
  const fm = end > 0 ? fileText.slice(0, end) : ""; // no opening/closing --- ⇒ no frontmatter (don't scan body)
  if (/\nstandalone:\s*true\b/.test(fm)) return true;
  const tags = fm.match(/\ntags:\s*\[([^\]]*)\]/)?.[1] ?? "";
  const tagSet = new Set(tags.split(",").map((s) => normKey(s.replace(/^["']|["']$/g, ""))).filter(Boolean));
  if (cfg.orphan.exemptTags.some((t) => tagSet.has(normKey(t)))) return true;
  if (rec.updated && daysBetween(rec.updated, todayStr) <= cfg.orphan.graceDays) return true;
  return false;
}

// ── unlinked-mention helpers ─────────────────────────────────────────────────────────────────────

/** The search terms a note contributes to unlinked-mention detection: its basename (ONLY if
 *  word-like — reject /^[0-9]/, /^\d{4}-\d{2}-\d{2}$/, and basenames containing no letters) plus
 *  every alias; each then filtered by length ≥ minTermLength AND normKey not in stopwords. Returns
 *  surface forms (callers key matching on normKey). */
export function mentionTermsFor(rec: NoteRecord, cfg: FindabilityConfig): string[] {
  const out: string[] = [];
  const wordLike = (s: string) => !/^[0-9]/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s) && /\p{L}/u.test(s);
  const ok = (s: string) => s.length >= cfg.mention.minTermLength && !cfg.mention.stopwords.some((w) => normKey(w) === normKey(s));
  if (wordLike(rec.basename) && ok(rec.basename)) out.push(rec.basename);
  for (const a of rec.aliases) if (ok(a)) out.push(a);
  return out;
}

/** Offset-preserving immunity blanking for the unlinked-mention scan: replace (with same-length
 *  spaces) the YAML frontmatter block, fenced+inline code, every existing [[…]] span (incl
 *  |display+#anchor), markdown link targets `](…)` and bare http(s) URLs, and — when !scanHeadings —
 *  ATX/setext heading lines. Apostrophes are normalized curly→straight for the possessive tail. The
 *  returned string is the SAME length as input so term-regex offsets stay meaningful. This is the
 *  load-bearing false-positive guard: a term inside a real [[link]] or code fence must never report. */
export function mentionScanProjection(fileText: string, scanHeadings: boolean): string {
  // straighten curly apostrophes (same length) so the possessive tail ’s matches as 's
  let s = fileText.replace(/[‘’]/g, "'");
  const blank = (m: string) => " ".repeat(m.length);
  const blankLines = (m: string) => m.replace(/[^\n]/g, " "); // keep newlines so line structure holds
  // frontmatter block (leading --- … \n---) — blank but keep newlines
  if (s.startsWith("---")) {
    const end = s.indexOf("\n---", 3);
    if (end > 0) { const close = s.indexOf("\n", end + 1); const stop = close < 0 ? s.length : close; s = blankLines(s.slice(0, stop)) + s.slice(stop); }
  }
  s = s.replace(/```[\s\S]*?```/g, blankLines);   // fenced code
  s = s.replace(/`[^`\n]*`/g, blank);             // inline code
  s = s.replace(/\[\[[^\]]+\]\]/g, blank);        // existing wikilinks (incl |display + #anchor)
  s = s.replace(/\]\([^)]*\)/g, blank);           // markdown link/image targets ](…)
  s = s.replace(/https?:\/\/[^\s)]+/g, blank);    // bare URLs
  if (!scanHeadings) {
    s = s.replace(/^#{1,6}[ \t].*$/gm, blankLines);          // ATX headings
    s = s.replace(/^.+\n(?:=+|-+)[ \t]*$/gm, blankLines);    // setext headings (line + ===/---)
  }
  return s;
}

/** Per-term word-boundary matcher: Unicode lookarounds on BOTH sides kill substring-in-larger-word
 *  matches; the optional 's|s|es tail + trailing boundary tolerates Gateways / Gateway's but rejects
 *  Gatewaying. caseSensitive → 'gu' else 'giu'. */
export function mentionRegexFor(term: string, cfg: FindabilityConfig): RegExp {
  const tail = cfg.mention.matchPluralPossessive ? "(?:'s|s|es)?" : "";
  const body = escapeRegex(term).replace(/ /g, "\\s+"); // tolerate double-space / line-wrap in multi-word terms
  return new RegExp("(?<![\\p{L}\\p{N}_])" + body + tail + "(?![\\p{L}\\p{N}_])", cfg.mention.caseSensitive ? "gu" : "giu");
}

// ── orphan + unlinked-mention passes (THE single copy — all three sites call these) ────────────────

/** Notes nothing links to: indexable records whose resolved inbound backlink set is empty and which
 *  aren't exempt (isExemptFromOrphan). ONE orphan definition, shared by validate.ts + organize.ts +
 *  the CLI, so the MAP and the gate can never disagree. `indexable` is the caller's scope filter (a
 *  record is only an orphan within the scope it's indexed in); readFile is injected. Sorted by
 *  canonicalId, byte-stable. A note that links OUT but has nothing linking to IT is, by definition,
 *  an orphan — appearing as a SOURCE in its targets' trails does NOT rescue it. */
export function findOrphans(
  records: NoteRecord[],
  backlinks: Map<string, string[]>,
  cfg: FindabilityConfig,
  readFile: (f: string) => string,
  todayStr: string,
  indexable: (rec: NoteRecord) => boolean = () => true,
): NoteRecord[] {
  if (!cfg.orphan.enabled) return [];
  return records
    .filter((r) => indexable(r))
    .filter((r) => (backlinks.get(r.canonicalId)?.length ?? 0) === 0)
    .filter((r) => !isExemptFromOrphan(r, cfg, readFile(r.file), todayStr))
    .sort((a, b) => (a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0));
}

/** A note's title/alias appearing as plain prose in ANOTHER note but never [[linked]]. THE single
 *  scan (was reimplemented 3×, with the sort + escape-hatch drift this dedup removes). dictRecords =
 *  the link-TARGET scope (terms come from these); sources = where to look for the mentions. Both are
 *  the caller's already-scoped record lists. The dictionary is longest-term-first with the
 *  ANTISYMMETRIC lexicographic tiebreak (matches resolveTarget/tiebreak — equal length AND equal key
 *  → 0, so ordering is stable across engines, fixing the nondeterministic finding-SET bug), and each
 *  term's RegExp is compiled ONCE here (not per source × term) — the constant-factor fix for the
 *  O(N²×T) blowup. Per source we projection-blank immune spans, then first-dict-entry wins an
 *  overlapping span (consumed-overlap), one finding per (source,target). Sorted, byte-stable. */
export function findUnlinkedMentions(
  sources: NoteRecord[],
  dictRecords: NoteRecord[],
  cfg: FindabilityConfig,
  readFile: (f: string) => string,
  backlinks?: Map<string, string[]>,
): Array<{ source: string; target: string }> {
  if (!cfg.mention.enabled) return [];
  // dictionary: each term once, with its precompiled regex; longest-first so a long alias is consumed
  // before a contained short one. Tiebreak is antisymmetric (… : 0) so the SET is engine-stable.
  const dict: Array<{ key: string; term: string; rec: NoteRecord; re: RegExp }> = [];
  for (const r of dictRecords) for (const term of mentionTermsFor(r, cfg)) {
    dict.push({ key: normKey(term), term, rec: r, re: mentionRegexFor(term, cfg) });
  }
  dict.sort((a, b) => b.term.length - a.term.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const findings: Array<{ source: string; target: string }> = [];
  for (const s of sources) {
    const projection = mentionScanProjection(readFile(s.file), cfg.mention.scanHeadings);
    const consumed: Array<[number, number]> = [];
    const pairSeen = new Set<string>(); // one finding per (source,target)
    for (const d of dict) {
      if (d.rec.canonicalId === s.canonicalId) continue;       // self-skip
      if (pairSeen.has(d.rec.canonicalId)) continue;
      if (backlinks?.get(d.rec.canonicalId)?.includes(s.canonicalId)) continue; // source already [[links]] it
      for (const m of projection.matchAll(d.re)) {
        const start = m.index!, end = start + m[0].length;
        if (consumed.some(([cs, ce]) => start < ce && end > cs)) continue; // inside a longer match
        consumed.push([start, end]);
        pairSeen.add(d.rec.canonicalId);
        findings.push({ source: s.canonicalId, target: d.rec.canonicalId });
        break;
      }
    }
  }
  return findings.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

/** Set of basenames shared by >1 record. A wikilink to such a basename is ambiguous, so display code
 *  (trails/orphan/mention lines) must render the disambiguating canonicalId instead of the basename
 *  for those — `[[basename]]` would be both duplicated and point at whichever wins the tiebreak. */
export function duplicateBasenames(records: NoteRecord[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of records) seen.set(r.basename, (seen.get(r.basename) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([b]) => b));
}

/** The disambiguation-safe wikilink display target for a record: its basename when unique, else its
 *  full canonicalId (the path-suffix resolver accepts it). Use everywhere a source/target is rendered
 *  into a [[link]] so basename collisions don't produce ambiguous or duplicated trail entries. */
export const displayTarget = (rec: NoteRecord, dupes: Set<string>): string =>
  dupes.has(rec.basename) ? rec.canonicalId : rec.basename;

// ── config ───────────────────────────────────────────────────────────────────────────────────────

export type FindabilityConfig = {
  enabled: boolean;
  orphan: { enabled: boolean; includeSelf: boolean; graceDays: number; exemptTags: string[]; exemptFiles: string[] };
  mention: { enabled: boolean; caseSensitive: boolean; minTermLength: number; stopwords: string[]; matchPluralPossessive: boolean; scanHeadings: boolean; scanConversations: boolean };
  aliases: { requireUnique: boolean; warnRedundantBasename: boolean };
  links: { warnAmbiguous: boolean };
};

// Safe defaults live in code (CONFIG.md Rule #2); clients/models.json `findability` only overrides.
const DEFAULTS: FindabilityConfig = {
  enabled: true,
  orphan: {
    enabled: true, includeSelf: false, graceDays: 14,
    exemptTags: ["orphan-ok", "standalone"],
    exemptFiles: ["README.md", "MAP.md", "STRUCTURE.md", "CONFIG.md", "ASSETS.md", "CHANGELOG.md", "inbox.md"],
  },
  mention: {
    enabled: true, caseSensitive: false, minTermLength: 4, matchPluralPossessive: true, scanHeadings: false, scanConversations: false,
    stopwords: [
      "notes", "home", "index", "today", "people", "work", "todo", "readme", "map", "inbox", "title", "summary",
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
      "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    ],
  },
  aliases: { requireUnique: true, warnRedundantBasename: true },
  links: { warnAmbiguous: true },
};

/** Merge registry.findability over the in-code DEFAULTS (one loader so validate.ts + organize.ts read
 *  identical config). Missing/absent → all defaults (degrades safe). Shallow-merge per sub-object so a
 *  partial override (e.g. just orphan.graceDays) keeps the rest of the safe defaults. */
export function loadFindabilityConfig(registry: any): FindabilityConfig {
  const f = registry?.findability;
  if (!f || typeof f !== "object") return DEFAULTS;
  return {
    enabled: f.enabled ?? DEFAULTS.enabled,
    orphan: { ...DEFAULTS.orphan, ...(f.orphan ?? {}) },
    mention: { ...DEFAULTS.mention, ...(f.mention ?? {}) },
    aliases: { ...DEFAULTS.aliases, ...(f.aliases ?? {}) },
    links: { ...DEFAULTS.links, ...(f.links ?? {}) },
  };
}

// ── CLI preview ────────────────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const BRAIN = join(import.meta.dir, "..");
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === ".DS_Store" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "_templates") walk(p, out); }
      else if (e.name.endsWith(".md")) out.push(p);
    }
    return out;
  };
  let cfg = DEFAULTS;
  try { cfg = loadFindabilityConfig(JSON.parse(readFileSync(join(BRAIN, "clients", "models.json"), "utf8"))); } catch { /* defaults */ }

  const indexable = [...walk(join(BRAIN, "self")), ...walk(join(BRAIN, "wiki"))]
    .filter((f) => basename(f).toLowerCase() !== "readme.md");
  const records = buildNoteRecords(indexable, BRAIN);
  const { table, collisions, redundant } = buildAliasTable(records);
  const { backlinks, ambiguous } = buildBacklinkIndex(records, (f) => readFileSync(f, "utf8"));
  const sub = process.argv[2] ?? "backlinks";

  if (sub === "backlinks") {
    console.log(`links · backlinks — ${records.length} indexable notes`);
    for (const r of records) {
      const inb = backlinks.get(r.canonicalId);
      if (inb?.length) console.log(`  ${r.canonicalId}  ←  ${inb.join(" · ")}`);
    }
    if (ambiguous.length && cfg.links.warnAmbiguous) for (const a of ambiguous) console.log(`  ⚠ ambiguous: ${a.source} → ${a.target}`);
    if (collisions.length && cfg.aliases.requireUnique) for (const c of collisions) console.log(`  ⚠ alias collision: '${c.surface}' (${c.dropped}) already maps to ${c.kept}`);
    if (redundant.length && cfg.aliases.warnRedundantBasename) for (const r of redundant) console.log(`  ⚠ redundant alias '${r.alias}' in ${r.canonicalId} repeats its own basename`);
  } else if (sub === "orphans") {
    console.log(`links · orphans — notes nothing links to`);
    const orphans = findOrphans(records, backlinks, cfg, (f) => readFileSync(f, "utf8"), today());
    for (const r of orphans) console.log(`  ⚠ ${r.canonicalId}`);
    if (!orphans.length) console.log("  ✓ none");
  } else if (sub === "mentions") {
    console.log(`links · unlinked mentions`);
    const findings = findUnlinkedMentions(records, records, cfg, (f) => readFileSync(f, "utf8"), backlinks);
    if (!findings.length) console.log("  ✓ none");
    for (const f of findings) console.log(`  ⚠ ${f.source} mentions ${f.target}`);
  } else {
    console.error("usage: bun scripts/links.ts [backlinks|orphans|mentions]"); process.exit(1);
  }
  void table;
}
