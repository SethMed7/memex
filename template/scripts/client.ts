#!/usr/bin/env bun
/**
 * CLIENT LAYER — the top layer of the brain. Different models have different
 * context windows and abilities, and the brain is meant to be reachable by local
 * systems too. So nothing should dump the whole brain at a model blindly: it asks
 * the client layer for a context pack sized and shaped to THAT model, so the brain
 * works the best each model can.
 *
 *   import { profileFor, contextPack } from ".../scripts/client.ts"
 *   const pack = contextPack("gemma4:12b-it-qat", { focus: "projects/my-project" })
 *   // → a tight, pre-assembled string a tiny local model can actually use.
 *
 * Rules live in clients/models.json (editable). Matching is by substring on the
 * lowercased model id; unknown → the most-constrained default (safe for any new local model).
 *
 *   bun scripts/client.ts <model> [focusNote]   # preview a pack on the CLI
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const BRAIN = join(import.meta.dir, "..");
const REGISTRY = JSON.parse(readFileSync(join(BRAIN, "clients", "models.json"), "utf8"));

export type Profile = {
  label: string; windowTokens: number; brainFraction: number;
  tier: "compact" | "standard" | "full"; agentic: boolean; structuredOutput: boolean; notes?: string;
};

/** Resolve a model id/alias to its profile (first substring match; else the safe default). */
export function profileFor(model: string): Profile {
  const id = (model || "").toLowerCase();
  for (const m of REGISTRY.models) if (m.match.some((s: string) => id.includes(s))) return m;
  return REGISTRY.default;
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const estTokens = (s: string) => Math.round(s.length / 4);

function selfFiles(): string[] {
  const d = join(BRAIN, "self");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md")).sort().map((f) => join(d, f)) : [];
}

/** Find a note by basename or relative path across self/ + wiki/. */
function findNote(name: string): string | null {
  const want = basename(name);
  const walk = (dir: string): string[] => !existsSync(dir) ? [] :
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []);
  for (const root of ["self", "wiki"]) {
    const hit = walk(join(BRAIN, root)).find((f) => basename(f, ".md") === want || f.replace(/\.md$/, "").endsWith(name));
    if (hit) return hit;
  }
  return null;
}

// [[links]] inside a note's prose
const linksIn = (t: string) => [...t.replace(/```[\s\S]*?```/g, "").matchAll(/\[\[([^\]\]|#]+)/g)].map((m) => m[1].trim());
// MAP summary line for a note
function mapSummary(map: string, name: string): string {
  return map.match(new RegExp(`\\[\\[${basename(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]\\s*—\\s*(.+)`))?.[1]?.trim() ?? "";
}

/**
 * Assemble a brain context pack for a model.
 *  - agentic + full: hand the spine (MAP + self/) and tell it to roam (read files / follow [[links]]).
 *  - non-agentic / compact / standard: PRE-ASSEMBLE content (it can't read files), trimmed to budget.
 */
export function contextPack(model: string, opts: { focus?: string; budgetTokens?: number; assemble?: boolean } = {}): {
  text: string; profile: Profile; estTokens: number; included: string[];
} {
  const p = profileFor(model);
  const budgetTokens = opts.budgetTokens ?? Math.floor(p.windowTokens * p.brainFraction);
  const budgetChars = budgetTokens * 4;
  const map = read(join(BRAIN, "MAP.md"));
  const included: string[] = [];
  const parts: string[] = [`# Brain context — for ${p.label} (~${Math.round(p.windowTokens / 1000)}k window · tier:${p.tier} · ${p.agentic ? "agentic" : "pre-assembled"})`];

  // `assemble` forces pre-assembled content even for an agentic model — needed when the
  // *harness* gives no file access (e.g. a no-tools chat tier runs with no tools).
  if (p.agentic && p.tier === "full" && !opts.assemble) {
    // Roam mode: spine + instructions. The model reads the rest itself.
    parts.push(
      "You can read this knowledge base directly at ~/smBrain. Start from the MAP below, follow [[links]], and open notes under self/ and wiki/ as needed. Binaries are in smStorage via `storage:` refs. The layout contract is STRUCTURE.md.",
      "\n## MAP\n" + map,
      "\n## self/ (open the files for detail)\n" + selfFiles().map((f) => `- ${basename(f)}`).join("\n"),
    );
    included.push("MAP.md", "self/ (pointers)", "roam-instructions");
  } else {
    // Pre-assemble mode: hand the model actual content, trimmed to its budget.
    parts.push("\n## MAP (the index — summaries of everything)\n" + map);
    included.push("MAP.md");
    // self/ summaries (from MAP, which already carries them) for compact; full self/ for standard
    if (p.tier === "standard") {
      for (const f of selfFiles()) { parts.push(`\n## self/${basename(f)}\n` + read(f)); included.push(`self/${basename(f)}`); }
    }
    // focused note + its linked notes' summaries
    if (opts.focus) {
      const nf = findNote(opts.focus);
      if (nf) {
        const t = read(nf);
        parts.push(`\n## focus · ${basename(nf)}\n` + t);
        included.push(`focus:${basename(nf)}`);
        const links = [...new Set(linksIn(t))].slice(0, 8);
        if (links.length) parts.push("\n### related (summaries)\n" + links.map((l) => `- [[${l}]] — ${mapSummary(map, l) || "(see note)"}`).join("\n"));
      }
    }
    // today's daily summary for situational awareness
    const hy = join(BRAIN, "history");
    if (existsSync(hy)) {
      const years = readdirSync(hy, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      const dailies = years.flatMap((y) => readdirSync(join(hy, y)).filter((f) => /\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => join(hy, y, f)));
      const latest = dailies.sort().at(-1);
      if (latest) { parts.push(`\n## latest day · ${basename(latest)}\n` + read(latest).slice(0, 1200)); included.push(`daily:${basename(latest)}`); }
    }
  }

  let text = parts.join("\n");
  if (text.length > budgetChars) { text = text.slice(0, budgetChars - 40) + "\n\n…[trimmed to fit window]"; included.push("(trimmed)"); }
  return { text, profile: p, estTokens: estTokens(text), included };
}

// CLI preview
if (import.meta.main) {
  const [model, focus] = process.argv.slice(2);
  if (!model) { console.error("usage: bun scripts/client.ts <model> [focusNote]"); process.exit(1); }
  const pack = contextPack(model, { focus });
  console.error(`profile: ${pack.profile.label} · tier:${pack.profile.tier} · agentic:${pack.profile.agentic} · ~${pack.estTokens} tok · included: ${pack.included.join(", ")}`);
  console.log(pack.text);
}
