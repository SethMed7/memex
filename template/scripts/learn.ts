#!/usr/bin/env bun
/**
 * SELF-IMPROVING LAYER — per model. A thin, deterministic layer on top of the client layer.
 * Each model keeps a PLAYBOOK (clients/learning/<model-slug>.md): its own running notes on how to
 * navigate and maintain THIS memex. The playbook is folded back into the model's context pack every
 * session (see client.ts), so each model — when used — gets its map PLUS what it has already learned,
 * and gets a little sharper each time.
 *
 *   import { mapFor, learn, heal } from ".../scripts/learn.ts"
 *   mapFor("claude-opus")                       // ensure + read this model's playbook (its "map")
 *   learn("claude-opus", "for payments, read projects/gateway first", { section: "Heuristics" })
 *   heal("claude-opus")                          // → worklist of mechanical drift this model should fix
 *
 * The memex makes NO LLM calls (CONFIG.md Rule #9): this script only reads/writes files and SCANS for
 * drift. Deciding what's worth learning, writing a missing summary, fixing a link — that's the model's
 * job, done by whoever plugs in. learn() records the result; heal() just points at the work.
 *
 *   bun scripts/learn.ts map  <model>                     print (creating if needed) a model's playbook
 *   bun scripts/learn.ts add  <model> "<insight>" [--heuristic|--fix|--watch]   append a learning
 *   bun scripts/learn.ts heal <model>                     list drift this model should self-heal
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const BRAIN = join(import.meta.dir, "..");
const REGISTRY = JSON.parse(readFileSync(join(BRAIN, "clients", "models.json"), "utf8"));
const LEARN_CFG = REGISTRY.learning ?? { enabled: true, dir: "clients/learning", maxKb: 24 };
const LEARN_DIR = join(BRAIN, ...LEARN_CFG.dir.split("/"));

export type Section = "Heuristics" | "Corrections" | "Watch";
const SECTIONS: Section[] = ["Heuristics", "Corrections", "Watch"];

// Resolve a model id to its registry label (mirrors client.ts profileFor: first substring match
// wins, else the safe default). Kept local so this layer is a leaf — client.ts imports IT, not vice
// versa.
const labelFor = (model: string): string => {
  const id = (model || "").toLowerCase();
  for (const m of REGISTRY.models) if (m.match.some((s: string) => id.includes(s))) return m.label;
  return REGISTRY.default.label;
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Stable per-model (per-profile) slug: same family → same playbook, matching the client layer.
export const playbookSlug = (model: string) => slugify(labelFor(model) || model);
export const playbookPath = (model: string) => join(LEARN_DIR, `${playbookSlug(model)}.md`);

// Date without LLM/randomness — local day. (Kept here so the layer is self-contained.)
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

function seed(model: string): string {
  const label = labelFor(model) || model;
  return [
    "---", `model: ${label}`, `slug: ${playbookSlug(model)}`, `updated: ${today()}`, "---", "",
    `# Playbook — ${label}`, "",
    "What this model has learned about navigating and maintaining *this* memex. Folded back into its",
    "context pack each session; appended by the model itself as it works (`scripts/learn.ts add`).", "",
    "## Heuristics", "_How to use this memex well — navigation shortcuts, where things live._", "",
    "## Corrections", "_Drift this model healed — links fixed, summaries written, notes filed._", "",
    "## Watch", "_Open issues it couldn't resolve yet._", "",
  ].join("\n");
}

/** Ensure a model's playbook exists (seeding from template) and return its content. The model's "map". */
export function mapFor(model: string): string {
  if (LEARN_CFG.enabled === false) return "";
  mkdirSync(LEARN_DIR, { recursive: true });
  const p = playbookPath(model);
  if (!existsSync(p)) writeFileSync(p, seed(model));
  return readFileSync(p, "utf8");
}

/** Append a learning under a section (default Heuristics) and stamp `updated`. */
export function learn(model: string, insight: string, opts: { section?: Section } = {}): string {
  mapFor(model); // ensure it exists
  const p = playbookPath(model);
  const section = opts.section && SECTIONS.includes(opts.section) ? opts.section : "Heuristics";
  let t = readFileSync(p, "utf8");
  const head = `## ${section}`;
  const i = t.indexOf(head);
  const line = `- ${today()} — ${insight.trim()}`;
  if (i < 0) {
    t += `\n${head}\n${line}\n`;
  } else {
    // insert after the section heading and its optional italic descriptor line
    let nl = t.indexOf("\n", i) + 1;
    if (t.slice(nl).startsWith("_")) nl = t.indexOf("\n", nl) + 1;
    t = t.slice(0, nl) + line + "\n" + t.slice(nl);
  }
  writeFileSync(p, t.replace(/updated:\s*.+/, `updated: ${today()}`));
  return p;
}

// ── self-heal: scan for the mechanical drift a model can fix (judgment is the model's, not ours) ──
const md = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f); else if (e.name.endsWith(".md")) out.push(f);
    } };
  walk(dir); return out;
};
const prose = (t: string) => t.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");

export type Drift = { kind: "missing-summary" | "dangling-link" | "not-in-map"; where: string; detail: string };

/** Worklist of mechanical drift the model should heal. Pure scan — fixing is the model's job. */
export function heal(model: string): Drift[] {
  const selfWiki = [...md(join(BRAIN, "self")), ...md(join(BRAIN, "wiki"))]
    .filter((f) => !f.includes("/_templates/") && basename(f).toLowerCase() !== "readme.md");
  const allNotes = [...selfWiki, ...md(join(BRAIN, "chats")), ...md(join(BRAIN, "history"))];
  const names = new Set(allNotes.map((f) => basename(f, ".md")));
  const MAP = existsSync(join(BRAIN, "MAP.md")) ? readFileSync(join(BRAIN, "MAP.md"), "utf8") : "";
  const drift: Drift[] = [];
  for (const f of selfWiki) {
    const r = f.replace(BRAIN + "/", "");
    const head = readFileSync(f, "utf8").slice(0, 400);
    if (r.startsWith("wiki/") && !/\nsummary:[ \t]*\S/.test(head)) drift.push({ kind: "missing-summary", where: r, detail: "add a one-line `summary:` so it indexes into MAP" });
    if (!MAP.includes(basename(f, ".md"))) drift.push({ kind: "not-in-map", where: r, detail: "not in MAP.md — run `bun scripts/organize.ts` (or add a summary)" });
  }
  for (const f of allNotes) {
    for (const m of prose(readFileSync(f, "utf8")).matchAll(/\[\[([^\]]+)\]\]/g)) {
      const target = m[1].split("|")[0].split("#")[0].trim();
      if (!names.has(basename(target))) drift.push({ kind: "dangling-link", where: f.replace(BRAIN + "/", ""), detail: `dangling [[${target}]] — fix the link or create the note` });
    }
  }
  return drift;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const [sub, model, ...rest] = process.argv.slice(2);
  if (!sub || !model) { console.error("usage: bun scripts/learn.ts <map|add|heal> <model> [args]"); process.exit(1); }
  if (sub === "map") {
    console.log(mapFor(model));
  } else if (sub === "add") {
    const flag = rest.find((a) => a.startsWith("--"));
    const section: Section = flag === "--fix" ? "Corrections" : flag === "--watch" ? "Watch" : "Heuristics";
    const insight = rest.filter((a) => !a.startsWith("--")).join(" ");
    if (!insight) { console.error("nothing to learn — pass an insight string"); process.exit(1); }
    console.log(`✓ learned (${section}) → ${learn(model, insight, { section }).replace(BRAIN + "/", "")}`);
  } else if (sub === "heal") {
    const drift = heal(model);
    console.log(`heal · ${labelFor(model)} — ${drift.length} item(s) to self-heal`);
    for (const d of drift) console.log(`  ⚠ [${d.kind}] ${d.where} — ${d.detail}`);
    if (!drift.length) console.log("  ✓ no mechanical drift found");
  } else { console.error(`unknown subcommand: ${sub}`); process.exit(1); }
}
