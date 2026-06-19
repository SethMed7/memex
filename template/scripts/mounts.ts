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
/** The distribution root: shared scripts + contracts + clients/ + the users.json registry. Never moves. */
export const REPO_ROOT = BRAIN;
const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export type Mount = { name: string; path: string; external: boolean; media: boolean; git: "track" | "ignore" };

function config(): any {
  try { return JSON.parse(readFileSync(process.env.MEMEX_CONFIG ?? join(BRAIN, "memex.local.json"), "utf8")); }
  catch { return {}; }
}

// ── Multi-tenancy (v3.3) ──────────────────────────────────────────────────────────────────────
// A memex may hold several isolated knowledge partitions ("users") declared in users.json at the
// REPO_ROOT. memex DECLARES the partitions + access policy; the connected app (e.g. Breve) ENFORCES
// who may reach which at runtime. No users.json ⇒ single-tenant: one implicit default user whose
// root IS the repo root (byte-identical to pre-v3.3). Resolve roots PER USER — never hardcode.

/** Root dir basenames a partition `name` may never collide with. */
export const RESERVED = new Set([
  "users", "scripts", "clients", "archive", "trash", "self", "wiki", "history", "chats",
]);

export type Role = "admin" | "member";
export type AccessMode = "local" | "open" | "secure";
export type UserEntry = { name: string; role: Role; path: string; powers?: string[]; createdAt?: string };
export type Registry = {
  version: number;
  primary: string;
  users: UserEntry[];
  mode?: AccessMode;            // local (1 user, no auth) · open (multi-user, isolated, no auth) · secure (RBAC + step-up auth)
  auth?: { stepUp?: string[] }; // secure-mode factors for an admin entering a bound space, e.g. ["email-code","weekly-passphrase"]
};

/** The partition registry, or null when single-tenant (absent/invalid ⇒ null). */
export function registry(): Registry | null {
  try {
    const raw = JSON.parse(readFileSync(process.env.MEMEX_USERS ?? join(REPO_ROOT, "users.json"), "utf8"));
    if (!Array.isArray(raw?.users) || typeof raw?.primary !== "string") return null;
    return raw as Registry;
  } catch { return null; }
}

/**
 * The access MODE — the use-case knob a connected app honors. No registry ⇒ "local" (single user,
 * no auth/isolation). A registry with no explicit mode ⇒ "secure" (SAFE default: never silently
 * drop isolation/auth on an existing multi-tenant memex). Set it with `users.ts mode <m>`.
 */
export function accessMode(): AccessMode {
  const reg = registry();
  if (!reg) return "local";
  // Normalize + fail closed: a malformed/typo/non-string mode collapses to the most-restrictive "secure".
  const m = typeof reg.mode === "string" ? reg.mode.trim().toLowerCase() : "";
  return m === "local" || m === "open" ? (m as AccessMode) : "secure";
}

/**
 * Identity HANDLES — the app-neutral, gitignored map name → {phone,uuid,email} that EVERY frontend
 * resolves a login against (Breve matches a phone/uuid; Rotli an email/phone). PII, so it lives in a
 * gitignored file, never the committed registry. Absent ⇒ {} (single-user / local).
 */
export type Identity = { phone?: string; uuid?: string; email?: string };
export function identities(): Record<string, Identity> {
  try {
    const raw = JSON.parse(readFileSync(process.env.MEMEX_IDENTITIES ?? join(REPO_ROOT, "identities.local.json"), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

/** Declared partitions ([] when single-tenant). */
export const listUsers = (): UserEntry[] => registry()?.users ?? [];
/** The default/primary partition name, or null when single-tenant. */
export const primaryUser = (): string | null => registry()?.primary ?? null;

/**
 * Resolve a partition's absolute root.
 *   no registry        → REPO_ROOT (single-tenant: spine lives at the repo root)
 *   user omitted       → the primary partition
 *   unknown name       → throw (Config Rule #2 safe default: never silently span partitions)
 * The primary may declare path "" meaning the repo root itself (unmigrated flat layout).
 */
export function userRoot(user?: string): string {
  const reg = registry();
  if (!reg) return REPO_ROOT;
  const name = user ?? reg.primary;
  const e = reg.users.find((u) => u.name === name);
  if (!e) throw new Error(`unknown memex user "${name}" — declared: ${reg.users.map((u) => u.name).join(", ") || "(none)"}`);
  return e.path ? join(REPO_ROOT, e.path) : REPO_ROOT;
}

// Logical roots, resolved per user (default = primary / single-tenant root). Resolve via these —
// never hardcode `users/<name>/...` (Configuration Rule #5).
export const knowledgePath = (user?: string): string => userRoot(user);
export const selfPath    = (user?: string): string => join(userRoot(user), "self");
export const wikiPath    = (user?: string): string => join(userRoot(user), "wiki");
export const historyPath = (user?: string): string => join(userRoot(user), "history");
export const chatsPath   = (user?: string): string => join(userRoot(user), "chats");
export const inboxPath   = (user?: string): string => join(userRoot(user), "inbox.md");
export const mapPath     = (user?: string): string => join(userRoot(user), "MAP.md");
/** Shared, install-level model rules — NOT per-user (lives at the repo root). */
export const clientsPath = (): string => join(REPO_ROOT, "clients");

/**
 * The active user/partition: `--user <name>` flag → $MEMEX_USER → memex.local.json `activeUser` →
 * undefined (⇒ primary/root). The file fallback is the APP-NEUTRAL active-partition knob: any
 * connected app (Rotli, a future app) persists the current persona here and every engine + app reads
 * it through this one resolver — no app invents its own selector. (Apps layer their own stickiness/TTL
 * above it; the knob itself carries no TTL.)
 */
export function currentUser(): string | undefined {
  const i = process.argv.indexOf("--user");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.MEMEX_USER) return process.env.MEMEX_USER;
  const a = config().activeUser;
  return typeof a === "string" && a ? a : undefined;
}

// ── Contract version handshake ──────────────────────────────────────────────────────────────────
// The machine-readable contract version (mirrors STRUCTURE.md). A connected app calls requireContract()
// at startup so it FAILS LOUDLY against a contract it wasn't built for, instead of silently corrupting
// data (the local-first "no push an update" reality means apps and contracts drift).
export const CONTRACT_VERSION = "3.3";
const verNum = (v: string) => v.split(".").map(Number).reduce((a, n, i) => a + n / Math.pow(1000, i), 0);
/** Throw unless CONTRACT_VERSION is within [min, max] (inclusive, "major.minor" strings; max optional). */
export function requireContract(min: string, max?: string): void {
  const v = verNum(CONTRACT_VERSION);
  if (v < verNum(min) || (max && v > verNum(max))) {
    throw new Error(`memex contract ${CONTRACT_VERSION} outside supported range ${min}${max ? `–${max}` : "+"} — upgrade the app or the memex before writing.`);
  }
}

/** The canonical assets mount, resolved exactly like validate.ts (env → assetsPath → sibling default). */
function assetsPath(c: any): string {
  return expand(process.env.MEMEX_ASSETS ?? c.assetsPath ?? join(BRAIN, "..", `${basename(BRAIN)}-assets`));
}

/** The shared assets base (the `assets` mount root). */
export const assetsRoot = (): string => assetsPath(config());

/**
 * Per-partition asset store: where a user's binaries live (text-only spine stays text-only; binaries
 * go here via `storage:`). The primary / single-tenant default keeps the shared base (byte-identical
 * to v1); a persona gets an ISOLATED subdir so one persona's binaries never sit in another's store.
 * Apps must resolve binary writes through THIS, never the bare shared base.
 */
export function assetsPathFor(user?: string): string {
  const base = assetsRoot();
  const reg = registry();
  if (!reg || !user || user === reg.primary) return base;
  return join(base, "users", user);
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
