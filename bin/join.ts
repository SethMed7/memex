#!/usr/bin/env bun
/**
 * memex join — merge two existing memex instances into a new scaffolded one.
 *
 *   runJoin(src1, src2, out)
 *     src1, src2  paths to existing memexes (each must have memex.json + STRUCTURE.md)
 *     out         output path (default: "memex-joined")
 *
 * Merges users.json, clients/models.json, clients/resources.json, and memex.json apps.
 * NEVER copies knowledge content (self/, wiki/, history/, chats/, inbox.md, MAP.md).
 * Interactive prompts for conflicts. Atomic writes throughout.
 */
import {
  readdirSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

const PKG_ROOT = join(import.meta.dir, "..");
const TEMPLATE = join(PKG_ROOT, "template");

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const from = join(src, e.name);
    const name = e.name === "gitignore" ? ".gitignore" : e.name;
    const to = join(dst, name);
    if (e.isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function atomicWrite(filePath: string, data: any): void {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, filePath);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compare two version strings numerically (major.minor).
 * Returns positive if a > b, negative if a < b, 0 if equal.
 * Handles versions like "3.10" correctly (not lexicographic).
 */
function compareVersions(a: string, b: string): number {
  const parseV = (v: string): number[] => v.split(".").map(Number);
  const [aMaj, aMin] = parseV(a);
  const [bMaj, bMin] = parseV(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  return aMin - bMin;
}

export async function runJoin(
  src1: string,
  src2: string,
  out: string | undefined
): Promise<void> {
  if (!src1 || !src2) {
    console.error(
      "usage: memex join <src1> <src2> [out]\n" +
        "  Merge two memex instances into a new scaffolded memex."
    );
    process.exit(1);
  }

  // Resolve all paths
  src1 = resolve(src1);
  src2 = resolve(src2);
  const outPath = resolve(out ?? "memex-joined");

  // Guard: src1 and src2 must be distinct
  if (src1 === src2) {
    console.error("✗ src1 and src2 resolve to the same path — nothing to merge");
    process.exit(1);
  }

  // Validate sources
  for (const [label, p] of [["src1", src1], ["src2", src2]] as [string, string][]) {
    if (!existsSync(join(p, "memex.json"))) {
      console.error(`✗ ${label} (${p}) does not contain memex.json — not a valid memex`);
      process.exit(1);
    }
    if (!existsSync(join(p, "STRUCTURE.md"))) {
      console.error(`✗ ${label} (${p}) does not contain STRUCTURE.md — not a valid memex`);
      process.exit(1);
    }
  }

  // Check output doesn't exist and isn't non-empty
  if (
    existsSync(outPath) &&
    readdirSync(outPath).filter((f) => f !== ".DS_Store").length > 0
  ) {
    console.error(
      `✗ ${outPath} already exists — choose a different output path`
    );
    process.exit(1);
  }

  // Read data from both sources
  const m1 = {
    users: readJson(join(src1, "users.json")),
    models: readJson(join(src1, "clients", "models.json")),
    resources: readJson(join(src1, "clients", "resources.json")),
    info: readJson(join(src1, "memex.json")),
  };
  const m2 = {
    users: readJson(join(src2, "users.json")),
    models: readJson(join(src2, "clients", "models.json")),
    resources: readJson(join(src2, "clients", "resources.json")),
    info: readJson(join(src2, "memex.json")),
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Ensure readline is closed cleanly on SIGINT
  process.on("SIGINT", () => {
    rl.close();
    process.exit(130);
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((res) => rl.question(prompt, res));

  // Print src mapping once so user can refer back to it during conflict prompts
  console.log(`\n  [1] src1: ${src1}`);
  console.log(`  [2] src2: ${src2}\n`);

  // --- Merge users.json ---
  let mergedUsers: any = null;

  if (!m1.users && !m2.users) {
    mergedUsers = null; // single-tenant, no users.json
  } else if (m1.users && !m2.users) {
    mergedUsers = m1.users;
    console.log("  note: only src1 has users.json — using it verbatim");
  } else if (!m1.users && m2.users) {
    mergedUsers = m2.users;
    console.log("  note: only src2 has users.json — using it verbatim");
  } else {
    // Both have users.json — merge
    const u1 = m1.users!;
    const u2 = m2.users!;

    // Merge primary
    let primary: string;
    if (u1.primary === u2.primary) {
      primary = u1.primary;
    } else {
      const ans = await question(
        `Primary user conflict:\n  [1] ${u1.primary}\n  [2] ${u2.primary}\n  Primary? [1/2]: `
      );
      primary = ans.trim() === "2" ? u2.primary : u1.primary;
    }

    // Merge mode — fail-closed: empty Enter defaults to 'secure'
    let mode: string;
    if (u1.mode === u2.mode) {
      mode = u1.mode ?? "secure";
    } else {
      const ans = await question(
        `Access mode conflict:\n  [1] ${u1.mode ?? "(unset)"}\n  [2] ${u2.mode ?? "(unset)"}\n  [secure] (recommended if unsure — Enter defaults to secure)\n  Mode? [1/2/secure]: `
      );
      const choice = ans.trim().toLowerCase();
      if (choice === "1") mode = u1.mode ?? "secure";
      else if (choice === "2") mode = u2.mode ?? "secure";
      else mode = "secure"; // empty input or "secure" or anything else → fail-closed
    }

    // Merge users array
    const usersByName = new Map<string, any>();
    for (const u of u1.users ?? []) {
      usersByName.set(u.name, { ...u, _src: "1" });
    }
    for (const u of u2.users ?? []) {
      if (usersByName.has(u.name)) {
        const existing = usersByName.get(u.name)!;
        // Conflict if role or path differs
        if (existing.role !== u.role || existing.path !== u.path) {
          const display1 = `name=${existing.name} role=${existing.role} path=${existing.path || "(root)"} [src1: ${src1}]`;
          const display2 = `name=${u.name} role=${u.role} path=${u.path || "(root)"} [src2: ${src2}]`;
          const ans = await question(
            `User conflict for "${u.name}":\n  [1] ${display1}\n  [2] ${display2}\n  Keep? [1/2]: `
          );
          if (ans.trim() === "2") usersByName.set(u.name, { ...u });
        }
        // else: same — keep existing
      } else {
        usersByName.set(u.name, { ...u });
      }
    }
    const mergedUsersArr = Array.from(usersByName.values()).map(
      ({ _src, ...rest }) => rest
    );

    // Merge auth.stepUp
    let auth: any = undefined;
    if (u1.auth?.stepUp || u2.auth?.stepUp) {
      const combined = [
        ...(u1.auth?.stepUp ?? []),
        ...(u2.auth?.stepUp ?? []),
      ];
      const deduped = Array.from(new Set(combined));
      auth = { stepUp: deduped };
    }

    mergedUsers = {
      version: 2,
      primary,
      mode,
      ...(auth ? { auth } : {}),
      users: mergedUsersArr,
    };
  }

  // --- Merge clients/models.json ---
  let mergedModels: any = null;

  if (!m1.models && !m2.models) {
    mergedModels = null;
  } else if (m1.models && !m2.models) {
    mergedModels = m1.models;
  } else if (!m1.models && m2.models) {
    mergedModels = m2.models;
  } else {
    // Both present — use src1 as base, merge models arrays
    mergedModels = { ...m1.models };
    const m1Models: any[] = m1.models?.models ?? [];
    const m2Models: any[] = m2.models?.models ?? [];

    const mergedModelsList = [...m1Models];

    for (const m2entry of m2Models) {
      const m2Keys = new Set<string>(m2entry.match ?? []);
      // Check for overlap with existing entries
      let conflict: any = null;
      let conflictIdx = -1;
      for (let i = 0; i < mergedModelsList.length; i++) {
        const m1entry = mergedModelsList[i];
        const m1Keys = new Set<string>(m1entry.match ?? []);
        const hasOverlap = [...m2Keys].some((k) => m1Keys.has(k));
        if (hasOverlap) {
          conflict = m1entry;
          conflictIdx = i;
          break;
        }
      }

      if (!conflict) {
        // No overlap — append
        mergedModelsList.push(m2entry);
      } else {
        const ans = await question(
          `Model conflict:\n  [1] ${conflict.label} [src1]\n  [2] ${m2entry.label} [src2]\n  Keep? [1/2/both]: `
        );
        const choice = ans.trim().toLowerCase();
        if (choice === "2") {
          mergedModelsList[conflictIdx] = m2entry;
        } else if (choice === "both") {
          mergedModelsList.push(m2entry);
        }
        // "1" or anything else: keep existing (no change)
      }
    }

    mergedModels = { ...m1.models, models: mergedModelsList };
  }

  // --- Merge clients/resources.json ---
  let mergedResources: any = null;

  if (!m1.resources && !m2.resources) {
    mergedResources = null;
  } else if (m1.resources && !m2.resources) {
    mergedResources = m1.resources;
  } else if (!m1.resources && m2.resources) {
    mergedResources = m2.resources;
  } else {
    // Union by url field; conflict prompt if same url differs
    const byUrl = new Map<string, any>();
    for (const r of m1.resources?.resources ?? []) {
      byUrl.set(r.url, { ...r });
    }
    for (const r of m2.resources?.resources ?? []) {
      if (byUrl.has(r.url)) {
        const existing = byUrl.get(r.url)!;
        // Check if they differ in any meaningful way
        if (JSON.stringify(existing) !== JSON.stringify(r)) {
          const ans = await question(
            `Resource conflict for <${r.url}>:\n  [1] src1 version  [${src1}]\n  [2] src2 version  [${src2}]\n  Keep? [1/2]: `
          );
          if (ans.trim() === "2") byUrl.set(r.url, { ...r });
        }
      } else {
        byUrl.set(r.url, { ...r });
      }
    }
    // Use src1 defaults (note if they differ)
    if (
      m1.resources?.defaults &&
      m2.resources?.defaults &&
      JSON.stringify(m1.resources.defaults) !== JSON.stringify(m2.resources.defaults)
    ) {
      console.log(
        "  note: resources.json defaults differ between src1 and src2 — using src1 defaults"
      );
    }
    mergedResources = {
      ...m1.resources,
      resources: Array.from(byUrl.values()),
    };
  }

  // --- Merge memex.json apps ---
  const apps1: Record<string, any> = m1.info?.apps ?? {};
  const apps2: Record<string, any> = m2.info?.apps ?? {};
  const mergedApps: Record<string, any> = { ...apps1 };
  for (const [appKey, appVal] of Object.entries(apps2)) {
    if (mergedApps[appKey]) {
      // Take the one with the later connectedAt (deterministic, no prompt)
      const t1 = new Date(mergedApps[appKey].connectedAt ?? 0).getTime();
      const t2 = new Date(appVal.connectedAt ?? 0).getTime();
      if (t2 > t1) mergedApps[appKey] = appVal;
    } else {
      mergedApps[appKey] = appVal;
    }
  }

  // Pick the higher contract version using numeric comparison (handles 3.10 > 3.9 correctly)
  const contract1: string = m1.info?.contract ?? "3.4";
  const contract2: string = m2.info?.contract ?? "3.4";
  const contract = compareVersions(contract1, contract2) >= 0 ? contract1 : contract2;

  // --- Scaffold output ---
  copyDir(TEMPLATE, outPath);

  // Write merged memex.json
  const mergedInfo = {
    id: "mx_" + randomUUID(),
    contract,
    createdAt: new Date().toISOString(),
    selfHeal: true,
    apps: mergedApps,
  };
  atomicWrite(join(outPath, "memex.json"), mergedInfo);

  // Write merged users.json
  if (mergedUsers) {
    const usersDst = join(outPath, "users.json");
    atomicWrite(usersDst, mergedUsers);
  }

  // Write merged models.json
  if (mergedModels) {
    const modelsDst = join(outPath, "clients", "models.json");
    atomicWrite(modelsDst, mergedModels);
  }

  // Write merged resources.json
  if (mergedResources) {
    const resourcesDst = join(outPath, "clients", "resources.json");
    atomicWrite(resourcesDst, mergedResources);
  }

  // --- Print summary ---
  const userCount = mergedUsers?.users?.length ?? 0;
  const modelCount = mergedModels?.models?.length ?? 0;
  const resourceCount = mergedResources?.resources?.length ?? 0;

  console.log(`\n✓ joined memex at ${outPath}`);
  console.log(
    `  users: ${userCount} merged · models: ${modelCount} merged · resources: ${resourceCount} merged`
  );
  console.log("");
  console.log("  Knowledge partitions were NOT copied (your data stays private).");
  console.log("  To bring in content from src1:");
  console.log(`    cp -r ${src1}/self ${outPath}/self`);
  console.log(`    cp -r ${src1}/wiki ${outPath}/wiki`);
  console.log("    # and so on for history/, chats/, inbox.md, MAP.md");
  console.log(`  Then: bun ${outPath}/scripts/validate.ts`);

  rl.close();
}

if (import.meta.main) {
  const src1 = process.argv[2];
  const src2 = process.argv[3];
  const out = process.argv[4];
  await runJoin(src1, src2, out);
  process.exit(0);
}
