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
 *   (d) no dangling [[wikilinks]] (alias-aware); (d2) chats well-formed + bidirectional; (d3) conversations don't bleed
 *   (d4) client registry valid; (d5) config spine present; (d6) NO LLM calls in scripts; (d7) NO secrets
 *   (d8) per-model playbooks well-formed + within the size cap; (d9) alias uniqueness + no redundant-basename aliases
 *   (e) wiki/ notes carry frontmatter (summary/tags/updated)
 *   (f) orphan notes — nothing links to them (findability); (g) unlinked mentions — a title in plain prose
 *   (+) orphan assets that no note references (warning)
 *
 * (d) and (d9)/(f)/(g) — the findability cluster — share scripts/links.ts (the canonical wikilink
 * regex + alias-aware resolver + backlink/orphan/mention passes). The memex makes NO LLM calls: it
 * FLAGS findability gaps; the model decides what to link. Gated by the `findability` config.
 *
 * Asset store (the `storage:` root) resolves from: $MEMEX_ASSETS → memex.local.json "assetsPath"
 * → sibling `../<dir>-assets`. memex is text-only; binaries live there. See ASSETS.md.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { homedir } from "node:os";
import {
  buildNoteRecords, buildAliasTable, resolveTarget, buildBacklinkIndex,
  findOrphans, findUnlinkedMentions, duplicateBasenames, displayTarget, loadFindabilityConfig,
  type NoteRecord,
} from "./links.ts";

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
const reg = join(BRAIN, "clients", "models.json"); // client registry — parsed by (d) findability + (d4)

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
// Local day (no Date.now leak beyond this Intl helper) — passed into the orphan grace check.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
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

// findability config + the alias-aware index (shared scripts/links.ts) — drives (d)/(d9)/(f)/(g)
let registry: any = {};
try { if (existsSync(reg)) registry = JSON.parse(read(reg)); } catch { /* (d4) reports invalid JSON below */ }
const findCfg = loadFindabilityConfig(registry);
// `records` = ALL notes (resolution scope: a [[link]] may still point at README/MAP/CONFIG — keep
// (d) non-regressing). `noteRecords` = real note files only (self/wiki/chats/history, no READMEs and
// no root structural docs like MAP.md) — the SOURCE scope for the backlink index, so MAP.md's own
// generated [[links]] never count as inbound (that would mask every orphan). Matches organize.ts.
const records: NoteRecord[] = buildNoteRecords(notes.filter((f) => !isTemplate(f)), BRAIN);
const { table: aliasTable, collisions, redundant } = buildAliasTable(records);
const noteRecords: NoteRecord[] = records.filter((r) => {
  if (basename(r.file).toLowerCase() === "readme.md") return false;
  return r.canonicalId.startsWith("self/") || r.canonicalId.startsWith("wiki/")
    || r.canonicalId.startsWith("chats/") || r.canonicalId.startsWith("history/");
});

// (d) dangling [[links]] — alias-aware via resolveTarget, so alias-targeted links don't flag
const linkResolves = (t: string) => resolveTarget(t, records, aliasTable) !== null;
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
if (existsSync(reg)) {
  try {
    const r = JSON.parse(read(reg));
    if (!Array.isArray(r.models) || !r.default) errors.push("clients/models.json missing models[] or default");
  } catch (e) {
    errors.push(`clients/models.json invalid JSON: ${String(e).slice(0, 80)}`);
  }
}

// (d8) resources registry safe (load-bearing) — the external-source fetch allowlist + guards.
// A resource is config a connected app fetches under; favoriting must never escalate trust/tier and
// no source may point at a private/loopback host (SSRF). Runtime DNS-based blocking is the connected
// app's job (safe-fetch); this is the static, committed-config guard.
const resReg = join(BRAIN, "clients", "resources.json");
if (existsSync(resReg)) {
  try {
    const rr = JSON.parse(read(resReg));
    if (!Array.isArray(rr.resources) || typeof rr.defaults !== "object" || !rr.defaults) {
      errors.push("clients/resources.json missing resources[] or defaults");
    } else {
      const SAFE_TIER = new Set(["local", "local-or-haiku"]);
      const CADENCE = new Set(["on-demand", "brief-only", "daily", "hourly"]);
      const ipLiteral = (h: string) => /^[0-9.]+$/.test(h) || h.includes(":") || /^0x/i.test(h);
      const ids = new Set<string>();
      for (const e of rr.resources) {
        const at = `clients/resources.json [${e.id ?? "?"}]`;
        if (!e.id || !e.url) { errors.push(`${at}: every resource needs id + url`); continue; }
        if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
        ids.add(e.id);
        let host = "";
        try {
          const u = new URL(e.url);
          host = u.hostname.toLowerCase();
          if (u.protocol !== "https:") errors.push(`${at}: url must be https:// (no cleartext fetch)`);
          if (u.username || u.password) errors.push(`${at}: url must not carry credentials (user:pass@)`);
        } catch { errors.push(`${at}: url is not a valid URL`); }
        if (host) {
          if (e.host && String(e.host).toLowerCase() !== host) errors.push(`${at}: host "${e.host}" != url hostname "${host}"`);
          if (ipLiteral(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal"))
            errors.push(`${at}: host must be a public domain, never an IP/localhost/.local (SSRF)`);
        }
        const tier = e.tier ?? rr.defaults.tier;
        const trust = e.trust ?? rr.defaults.trust;
        if (!SAFE_TIER.has(tier)) errors.push(`${at}: tier "${tier}" not allowed — fetched content stays local-class (${[...SAFE_TIER].join("/")})`);
        if (trust !== "untrusted") errors.push(`${at}: trust must be "untrusted" — fetched bytes are never trusted`);
        if (e.favorite && (!SAFE_TIER.has(tier) || trust !== "untrusted")) errors.push(`${at}: a favorite cannot carry an unsafe tier/trust — favoriting is ordering only`);
        if (e.cadence && !CADENCE.has(e.cadence)) warnings.push(`${at}: unknown cadence "${e.cadence}"`);
        if (e.reference && !noteBasenames.has(e.reference)) warnings.push(`${at}: reference "[[${e.reference}]]" doesn't resolve to a wiki note`);
      }
    }
  } catch (e) {
    errors.push(`clients/resources.json invalid JSON: ${String(e).slice(0, 80)}`);
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

// (d8) self-improving layer — playbooks well-formed + within the size cap (they ride along in packs)
const learnDir = join(BRAIN, "clients", "learning");
if (existsSync(learnDir)) {
  let maxKb = 24;
  try { maxKb = JSON.parse(read(reg)).learning?.maxKb ?? 24; } catch { /* registry checked in d4 */ }
  for (const f of walk(learnDir).filter((f) => f.endsWith(".md") && basename(f).toLowerCase() !== "readme.md")) {
    const head = read(f).slice(0, 200);
    if (!head.startsWith("---") || !/\nmodel:/.test(head) || !/\nupdated:/.test(head)) {
      warnings.push(`playbook missing model/updated frontmatter: ${rel(f)}`);
    }
    const kb = Buffer.byteLength(read(f)) / 1024;
    if (kb > maxKb) warnings.push(`playbook over learning.maxKb (${kb.toFixed(0)}kb > ${maxKb}kb), will be trimmed in packs: ${rel(f)} — distill it`);
  }
}

// (e) frontmatter on wiki/ notes
for (const f of indexable.filter((f) => rel(f).startsWith("wiki/"))) {
  const head = read(f).slice(0, 400);
  if (!head.startsWith("---") || !/\nsummary:/.test(head)) warnings.push(`missing frontmatter summary: ${rel(f)}`);
}

// ── findability cluster (d9)/(f)/(g) — shared scripts/links.ts, alias-aware, deterministic ──────────
// Gated by the `findability` config; off → pre-v3 behavior (no orphan/mention/alias warnings).
if (findCfg.enabled) {
  // canonicalId set of indexable notes (orphan/mention scope = self/ + wiki/, minus templates/READMEs)
  const indexableIds = new Set(indexable.map((f) => rel(f).replace(/\.md$/, "")));
  const isIndexable = (id: string) => indexableIds.has(id);

  // (d9) alias uniqueness + redundant-basename (the duplicate-concept smell) — sorted for stability
  if (findCfg.aliases.requireUnique) {
    for (const c of [...collisions].sort((a, b) => (a.dropped < b.dropped ? -1 : a.dropped > b.dropped ? 1 : a.surface < b.surface ? -1 : 1))) {
      warnings.push(`alias collision: '${c.surface}' declared by ${c.dropped} — already maps to ${c.kept}; aliases must be unique`);
    }
  }
  if (findCfg.aliases.warnRedundantBasename) {
    for (const r of [...redundant].sort((a, b) => (a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0))) {
      warnings.push(`redundant alias '${r.alias}' in ${r.canonicalId} repeats its own basename`);
    }
  }

  // backlink index over REAL note sources (computed once; resolution is alias-aware). MAP.md +
  // structural docs are excluded as sources so their generated links don't mask orphans.
  const { backlinks } = buildBacklinkIndex(noteRecords, read);
  const todayStr = today();

  // (f) orphan notes — indexable, empty resolved inbound, not exempt. Shared findOrphans (links.ts) so
  // the gate and the MAP use ONE orphan definition.
  for (const r of findOrphans(noteRecords, backlinks, findCfg, read, todayStr, (rec) => isIndexable(rec.canonicalId))) {
    warnings.push(`orphan note (nothing links to it): ${rel(r.file)}`);
  }

  // (g) unlinked mentions — a note's basename/alias in another note's plain prose, never [[linked]].
  // Shared findUnlinkedMentions (links.ts): dict = indexable targets; sources = indexable notes, plus
  // history/chats only when scanConversations (never MAP/structural docs). recById renders the target.
  const indexableRecs = noteRecords.filter((r) => isIndexable(r.canonicalId));
  const mentionSources = findCfg.mention.scanConversations ? noteRecords : indexableRecs;
  const recById = new Map(noteRecords.map((r) => [r.canonicalId, r]));
  const dupes = duplicateBasenames(noteRecords);
  for (const f of findUnlinkedMentions(mentionSources, indexableRecs, findCfg, read, backlinks)) {
    const rec = recById.get(f.target)!;
    warnings.push(`unlinked mention of [[${displayTarget(rec, dupes)}]] in ${rel(recById.get(f.source)!.file)}`);
  }
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
