#!/usr/bin/env bun
/**
 * memex — scaffold a local-first knowledge + memory structure any AI assistant can plug into.
 *
 *   memex init [dir] [--template <name>]   create a new memex (default: ./memex)
 *   memex scan [dir]                        hardware scan + local AI recommendation
 *   memex join <src1> <src2> [out]          merge two memexes into a new one
 *   memex --version
 *
 * Copies the template skeleton (structure + contracts + deterministic tooling + example config),
 * renaming the shipped `gitignore` to `.gitignore`. Zero dependencies — the instance runs on Bun's
 * node built-ins, so there's nothing to install. Tools (a message platform, a chat system, …) can
 * invoke this same init to build a memex for a user, with permission.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PKG_ROOT = join(import.meta.dir, "..");

const cmd = process.argv[2];

if (cmd === "--version" || cmd === "-v") {
  const v = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
  console.log(`memex ${v}`);
  process.exit(0);
}

// `memex user|id|connect|apps|status|heal|trash|purge …` — operate on the current instance by
// delegating to its own engine scripts (the canonical, in-instance tooling). The instance is the
// cwd, or `$MEMEX_ROOT`, or `--root <dir>` (so an app's setup, or Claude Code, can target it without cd).
if (["user", "id", "connect", "apps", "status", "heal", "trash", "purge"].includes(cmd ?? "")) {
  const rootIdx = process.argv.indexOf("--root");
  if (rootIdx >= 0) {
    const v = process.argv[rootIdx + 1];
    if (!v || v.startsWith("--")) { console.error("✗ --root needs a directory path"); process.exit(1); }
  }
  const rawRoot = rootIdx >= 0 ? process.argv[rootIdx + 1] : (process.env.MEMEX_ROOT ?? process.cwd());
  const root = resolve(rawRoot);

  // Validate that root is a real memex instance before executing anything from it.
  // This prevents MEMEX_ROOT injection from executing arbitrary scripts.
  const memexJsonPath = join(root, "memex.json");
  if (!existsSync(memexJsonPath)) {
    console.error(`✗ not a memex instance (memex.json missing at ${root}) — run inside an instance, or set MEMEX_ROOT`);
    process.exit(1);
  }
  let memexInfo: any;
  try {
    memexInfo = JSON.parse(readFileSync(memexJsonPath, "utf8"));
  } catch {
    console.error(`✗ memex.json at ${root} is not valid JSON — cannot continue`);
    process.exit(1);
  }
  if (typeof memexInfo?.id !== "string" || !memexInfo.id.startsWith("mx_")) {
    console.error(`✗ memex.json at ${root} has no valid id (expected "mx_…") — not a real memex instance`);
    process.exit(1);
  }

  const exec = (scriptName: string, args: string[]): number => {
    const s = join(root, "scripts", scriptName);
    if (!existsSync(s)) { console.error(`✗ no memex here (${s} missing) — run inside an instance, or set MEMEX_ROOT`); process.exit(1); }
    return Bun.spawnSync(["bun", s, ...args], { stdout: "inherit", stderr: "inherit" }).exitCode ?? 0;
  };
  // Strip `--root <dir>` from the args forwarded to the engine script (it selects the instance, above).
  const skip = new Set<number>();
  if (rootIdx >= 0) { skip.add(rootIdx); skip.add(rootIdx + 1); }
  const tail = process.argv.slice(3).filter((_, i) => !skip.has(i + 3));
  let code = 0;
  if (cmd === "user") code = exec("users.ts", tail);
  else if (cmd === "heal") code = exec("heal.ts", tail);
  else if (cmd === "trash") code = exec("heal.ts", ["trash", ...tail]);
  else if (cmd === "purge") code = exec("heal.ts", ["purge", ...tail]);
  else if (cmd === "connect") { code = exec("mounts.ts", ["connect", ...tail]); if (code === 0) exec("heal.ts", []); } // auto-heal on plug-in
  else code = exec("mounts.ts", [cmd!, ...tail]); // id, apps, status
  process.exit(code);
}

if (cmd === "scan") {
  const dir = process.argv[3] ?? process.cwd();
  const { runScan } = await import("./scan.ts");
  await runScan(dir);
  process.exit(0);
}

if (cmd === "join") {
  const src1 = process.argv[3];
  const src2 = process.argv[4];
  const out = process.argv[5];
  if (!src1) {
    console.error("✗ join requires at least two source paths\n  usage: memex join <src1> <src2> [out]");
    process.exit(1);
  }
  const { runJoin } = await import("./join.ts");
  await runJoin(src1, src2, out);
  process.exit(0);
}

if (cmd === "init") {
  const argv = process.argv.slice(3);
  const tplIdx = argv.indexOf("--template");
  const templateName = tplIdx >= 0 ? argv[tplIdx + 1] : undefined;
  const dirArgs = argv.filter((a, i) => a !== "--template" && (tplIdx < 0 || i !== tplIdx + 1));
  const target = resolve(dirArgs[0] ?? "memex");
  const { runInit } = await import("./init.ts");
  await runInit(target, templateName);
  process.exit(0);
}

console.log(
  "usage:\n" +
  "  memex init [dir] [--template <name>]   scaffold a new memex (default ./memex)\n" +
  "  memex scan [dir]                        hardware scan + local AI recommendation\n" +
  "  memex join <src1> <src2> [out]          merge two memexes into a new one\n" +
  "\n" +
  "  inside an instance (or pass --root <dir>):\n" +
  "  memex status                            handshake: id · contract · mode · apps · partitions\n" +
  "  memex connect <app> [role]              plug an app in — additive, never re-inits (e.g. connect rotli chat-system)\n" +
  "  memex id | apps                         this instance's id · the apps plugged in\n" +
  "  memex user <list|add|remove|…>          manage knowledge partitions\n" +
  "  memex heal [--dry] | trash <p> | purge --confirm   self-heal · soft-delete · hard-delete\n" +
  "\n" +
  "  memex --version"
);
process.exit(cmd ? 1 : 0);
