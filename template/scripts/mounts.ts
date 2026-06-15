#!/usr/bin/env bun
/**
 * memex mounts — named logical folders, each pointed at any path (inside, sibling, external, or a
 * synced Drive) by config. A generalization of the single assets root: `assets` is the canonical
 * mount; declare more under `mounts` in memex.local.json. The memex only RESOLVES paths — it never
 * syncs. An external mount's backend (Drive, a share, another repo) owns its sync/conflicts/permissions.
 * Resolve mounts through this module, never hardcode a deep path (Configuration Rule #5).
 *
 * Per-mount policy (safe defaults):
 *   external=false  — true ⇒ opaque + offline-tolerant: tools read/write it, but the memex does NOT
 *                     validate its contents and does NOT error when it's absent.
 *   media=false     — true ⇒ binaries allowed under it (the core text spine stays text-only).
 *   git=track|ignore — external ⇒ ignore (it syncs via its own backend, not the memex repo).
 */
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const BRAIN = join(import.meta.dir, "..");
const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export type Mount = { name: string; path: string; external: boolean; media: boolean; git: "track" | "ignore" };

function config(): any {
  try { return JSON.parse(readFileSync(process.env.MEMEX_CONFIG ?? join(BRAIN, "memex.local.json"), "utf8")); }
  catch { return {}; }
}

/** The canonical assets mount, resolved exactly like validate.ts (env → assetsPath → sibling default). */
function assetsPath(c: any): string {
  return expand(process.env.MEMEX_ASSETS ?? c.assetsPath ?? join(BRAIN, "..", `${basename(BRAIN)}-assets`));
}

/** All mounts with defaults filled — the synthesized `assets` mount first, then declared `mounts`. */
export function listMounts(): Mount[] {
  const c = config();
  const mounts: Mount[] = [
    { name: "assets", path: assetsPath(c), external: false, media: true, git: "ignore" },
  ];
  for (const [name, m] of Object.entries((c.mounts ?? {}) as Record<string, any>)) {
    mounts.push({
      name,
      path: expand(m.path ?? ""),
      external: Boolean(m.external),
      media: m.media ?? false,
      git: m.git ?? (m.external ? "ignore" : "track"),
    });
  }
  return mounts;
}

export const resolveMount = (name: string): Mount | null => listMounts().find((m) => m.name === name) ?? null;
/** Roots under which binaries are allowed (media mounts, incl. assets). */
export const mediaRoots = (): string[] => listMounts().filter((m) => m.media).map((m) => m.path);
/** Roots the memex treats as opaque — don't validate their contents. */
export const externalRoots = (): string[] => listMounts().filter((m) => m.external).map((m) => m.path);

if (import.meta.main) {
  for (const m of listMounts()) {
    const tags = [m.external && "external", m.media && "media", `git:${m.git}`].filter(Boolean).join(" ");
    console.log(`${m.name}\t${m.path.replace(homedir(), "~")}\t[${tags}]`);
  }
}
