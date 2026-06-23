#!/usr/bin/env bun
/**
 * memex init — scaffold a new memex instance, optionally from a product template.
 *
 *   runInit(dir, templateName)
 *     dir           target directory to scaffold into
 *     templateName  optional: name of a template in templates/<name>.json
 *
 * Interactive prompts for mode, primaryName (when mode=open/secure), stepUp (when mode=secure).
 * Honors template fields to skip prompts when they're pre-configured.
 * Optionally runs hardware scan after scaffold.
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
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

const PKG_ROOT = join(import.meta.dir, "..");
const TEMPLATE = join(PKG_ROOT, "template");

// Canonical slug regex — must match scripts/users.ts.
// 2–40 chars, lowercase alphanumeric + hyphens, no leading/trailing dash.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

// Allowed step-up auth factor identifiers.
const VALID_STEP_UP_FACTORS = new Set(["phone-code", "email-code", "totp", "webauthn"]);
const MAX_STEP_UP_FACTORS = 10;
const MAX_FACTOR_LEN = 64;

// Allowed app name regex (same slug pattern).
const APP_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const MAX_APPS = 20;

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

async function ask(
  rl: readline.Interface,
  prompt: string,
  defaultVal: string
): Promise<string> {
  return new Promise((res) => {
    rl.question(prompt, (answer) => {
      res(answer.trim() || defaultVal);
    });
  });
}

const today = () => new Date().toISOString().slice(0, 10);

export async function runInit(
  dir: string,
  templateName: string | undefined
): Promise<void> {
  // --- Sanitize and validate templateName to prevent path traversal ---
  if (templateName !== undefined) {
    // Reject any value containing path separators or dots
    if (templateName.includes("/") || templateName.includes("\\") || templateName.includes(".")) {
      console.error(`✗ invalid template name "${templateName}" — must not contain /, \\, or .`);
      process.exit(1);
    }
    // Additionally, resolve and assert the path stays within the templates directory
    const templatesDir = join(PKG_ROOT, "templates");
    const tplPath = join(templatesDir, templateName + ".json");
    if (!tplPath.startsWith(templatesDir + sep) && tplPath !== templatesDir) {
      console.error(`✗ invalid template name "${templateName}"`);
      process.exit(1);
    }
  }

  // Load template if specified
  let template: any = undefined;
  if (templateName) {
    const templatesDir = join(PKG_ROOT, "templates");
    const tplPath = join(templatesDir, templateName + ".json");
    if (!existsSync(tplPath)) {
      console.error(`✗ template "${templateName}" not found at ${tplPath}`);
      process.exit(1);
    }
    try {
      template = JSON.parse(readFileSync(tplPath, "utf8"));
    } catch (e) {
      console.error(`✗ failed to parse template ${tplPath}: ${String(e).slice(0, 80)}`);
      process.exit(1);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Ensure readline is closed cleanly on SIGINT
  process.on("SIGINT", () => {
    rl.close();
    process.exit(130);
  });

  // --- Collect mode FIRST (least-privilege prompt ordering) ---
  let mode: string;
  if (template?.mode) {
    mode = template.mode;
  } else {
    // Default to 'secure' (fail-closed). Loop until valid input.
    while (true) {
      const rawMode = await ask(rl, "Access mode — local | open | secure [secure]: ", "secure");
      mode = rawMode.trim().toLowerCase();
      if (mode === "local" || mode === "open" || mode === "secure") break;
      console.error(`  ✗ invalid mode "${mode}" — must be local, open, or secure`);
    }
  }

  // --- Collect primaryName only when needed (open or secure mode) ---
  let primaryName: string = "you";
  if (mode === "open" || mode === "secure") {
    if (template?.primaryName) {
      primaryName = template.primaryName;
    } else {
      primaryName = await ask(rl, "Your name (slug for primary partition) [you]: ", "you");
    }

    // Validate primaryName against canonical slug regex
    if (!SLUG_RE.test(primaryName)) {
      console.error(
        `✗ "${primaryName}" is not a valid slug — must be 2–40 chars, lowercase alphanumeric + hyphens, no leading/trailing dash`
      );
      rl.close();
      process.exit(1);
    }
  }

  // --- Collect stepUp (only for secure mode) ---
  let stepUp: string[] = ["phone-code"];
  if (mode === "secure") {
    if (template?.auth?.stepUp) {
      // Validate and filter template-supplied factors against the allowlist
      stepUp = (template.auth.stepUp as string[])
        .slice(0, MAX_STEP_UP_FACTORS)
        .map((f: string) => String(f).slice(0, MAX_FACTOR_LEN).trim())
        .filter((f: string) => VALID_STEP_UP_FACTORS.has(f));
      if (stepUp.length === 0) stepUp = ["phone-code"];
    } else {
      const raw = await ask(
        rl,
        `Step-up auth factors (comma-separated; valid: ${[...VALID_STEP_UP_FACTORS].join(", ")}) [phone-code]: `,
        "phone-code"
      );
      const parsed = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_STEP_UP_FACTORS);
      stepUp = parsed.filter((f) => VALID_STEP_UP_FACTORS.has(f));
      if (stepUp.length === 0) stepUp = ["phone-code"];
      const rejected = parsed.filter((f) => !VALID_STEP_UP_FACTORS.has(f));
      if (rejected.length > 0) {
        console.log(`  note: unknown factors ignored: ${rejected.join(", ")}`);
      }
    }
  }

  // Check target dir
  if (
    existsSync(dir) &&
    readdirSync(dir).filter((f) => f !== ".DS_Store").length > 0
  ) {
    console.error(`✗ ${dir} already exists and isn't empty — choose another path.`);
    rl.close();
    process.exit(1);
  }

  // Copy template skeleton
  copyDir(TEMPLATE, dir);

  // Stamp memex.json
  const contractMatch = readFileSync(join(TEMPLATE, "STRUCTURE.md"), "utf8").match(/v(\d+\.\d+)/);
  const contract = contractMatch ? contractMatch[1] : "3.4";

  // Sanitize apps from template: accept "name" OR {name, role}; slug-shaped names only, cap at MAX_APPS.
  // Stamping the app (with its role) here IS the registration — no separate `memex connect` is needed
  // after a templated init. Shape matches connectApp(): apps[name] = { role?, connectedAt }.
  const apps: Record<string, { role?: string; connectedAt: string }> = {};
  if (template?.apps) {
    const rawApps = Array.isArray(template.apps) ? template.apps : [];
    for (const a of rawApps.slice(0, MAX_APPS)) {
      // Type-guard both fields (don't coerce): a non-string name/role is invalid, not stringified.
      const appName = typeof a === "string" ? a : (a && typeof a.name === "string" ? a.name : "");
      const role = a && typeof a === "object" && typeof a.role === "string" ? a.role.slice(0, 64).trim() : undefined;
      if (APP_SLUG_RE.test(appName)) {
        apps[appName] = { ...(role ? { role } : {}), connectedAt: new Date().toISOString() };
      } else {
        console.log(`  note: skipping invalid app name "${appName}" from template`);
      }
    }
  }

  const info = {
    id: "mx_" + randomUUID(),
    contract,
    createdAt: new Date().toISOString(),
    selfHeal: true,
    apps,
  };
  writeFileSync(join(dir, "memex.json"), JSON.stringify(info, null, 2) + "\n");

  // Write users.json for open or secure mode
  if (mode === "open" || mode === "secure") {
    const usersPath = join(dir, "users.json");
    const usersObj: any = {
      version: 2,
      primary: primaryName,
      mode,
      ...(mode === "secure" ? { auth: { stepUp } } : {}),
      users: [
        {
          name: primaryName,
          role: "admin",
          path: "",
          powers: ["knowledge"],
          createdAt: today(),
        },
      ],
    };
    const usersTmp = usersPath + ".tmp";
    writeFileSync(usersTmp, JSON.stringify(usersObj, null, 2) + "\n");
    renameSync(usersTmp, usersPath);
    console.log("  created users.json — commit it (no PII, no secrets)");
  }

  // Optional hardware scan
  if (!template?.skipScanQuiz) {
    const doScan = await ask(
      rl,
      "Run hardware scan for local AI recommendation? [Y/n]: ",
      "y"
    );
    if (doScan.toLowerCase() !== "n") {
      const { runScan } = await import("./scan.ts");
      // Pass the open readline interface so scan doesn't create a second one on stdin
      await runScan(dir, rl);
    }
  }

  // Print success
  console.log(`\n✓ memex scaffolded at ${dir}`);
  if (template) {
    console.log(`  template: ${template.name} — ${template.description}`);
  }
  if (Object.keys(apps).length) {
    const list = Object.entries(apps)
      .map(([a, m]) => `${a}${m.role ? `(${m.role})` : ""}`)
      .join(", ");
    console.log(`  apps    : ${list} — registered in memex.json (no separate \`memex connect\` needed)`);
  }
  // Be defensive: a malformed operator-authored template (e.g. recommendedModels as a string) must not
  // crash init AFTER the instance is already scaffolded on disk. Coerce to safe shapes, never .join a string.
  const recommended = Array.isArray(template?.recommendedModels) ? template!.recommendedModels : [];
  const localRec = typeof template?.localModel?.recommended === "string" ? template!.localModel!.recommended : "";
  if (recommended.length || localRec) {
    console.log("  models  :");
    if (recommended.length) console.log(`    cloud — ${recommended.join(", ")}`);
    if (localRec) {
      const min = typeof template?.localModel?.minTier === "string" ? ` (min tier: ${template.localModel.minTier})` : "";
      console.log(`    local — ${localRec}${min}`);
    }
  }
  console.log("  next:");
  if (template?.postInit) {
    for (const line of template.postInit) {
      console.log(`    · ${line}`);
    }
  } else {
    console.log(`    cd ${dir}`);
    console.log("    open STRUCTURE.md  · fill self/00-identity.md  · edit clients/models.json");
    console.log("    bun scripts/validate.ts   # confirm the structure is sound");
  }
  if (mode === "secure") {
    console.log(
      "  ⚠ fill identities.local.json (gitignored) with your identity handles — see the example"
    );
  }

  rl.close();
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const tplIdx = argv.indexOf("--template");
  const templateName = tplIdx >= 0 ? argv[tplIdx + 1] : undefined;
  const dirArgs = argv.filter(
    (a, i) => a !== "--template" && (tplIdx < 0 || i !== tplIdx + 1)
  );
  const target = resolve(dirArgs[0] ?? "memex");
  await runInit(target, templateName);
  process.exit(0);
}
