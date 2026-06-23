#!/usr/bin/env bun
/**
 * memex scan — detect hardware and recommend a local AI model tier.
 *
 *   runScan(memexDir, existingRl?)
 *     memexDir    path to an existing (or freshly scaffolded) memex, or any directory
 *     existingRl  optional: an already-open readline.Interface to reuse (avoids two readers on stdin)
 *
 * Collects CPU/RAM/GPU info, classifies into compact|standard|full tier,
 * runs an optional use-case quiz, and optionally updates clients/models.json.
 * No LLM calls, no network. Pure Bun + node built-ins.
 *
 * NOTE: runScan() does NOT call process.exit(). Only the import.meta.main guard below does.
 * This allows init.ts to call runScan() and continue printing its success message.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";

function spawnText(cmd: string[]): string {
  try {
    const r = Bun.spawnSync(cmd, { stderr: "pipe" });
    return r.stdout.toString().trim();
  } catch {
    return "";
  }
}

/**
 * Extract a "model:tag" pair from a localModel description string.
 * E.g. "llama3.2:3b via Ollama" → "llama3.2:3b"
 *      "qwen2.5:32b or llama3.1:70b (4-bit) via Ollama" → "qwen2.5:32b"
 * Falls back to the first word before a space if no tag is found.
 */
function extractModelTag(localModel: string): string {
  const match = /([a-z0-9.]+:[a-z0-9]+)/i.exec(localModel);
  if (match) return match[1];
  return localModel.split(" ")[0];
}

export async function runScan(
  memexDir: string,
  existingRl?: readline.Interface
): Promise<void> {
  const platform = process.platform;

  if (platform === "win32") {
    console.log(
      "Hardware scan not yet supported on Windows. Use a cloud model (Claude/Gemini/GPT)."
    );
    return;
  }

  // --- Collect hardware info ---
  let cpu = "Unknown CPU";
  let ramGb = 0;
  let isAppleSilicon = false;
  let chipModel = "";
  let chipGeneration = 0; // numeric Apple Silicon generation (1=M1, 2=M2, …)
  let gpuName = "";
  let gpuVramMb = 0;

  if (platform === "darwin") {
    // Apple Silicon detection
    isAppleSilicon = spawnText(["sysctl", "-n", "hw.optional.arm64"]) === "1";

    const cpuRaw = spawnText(["sysctl", "-n", "machdep.cpu.brand_string"]);
    cpu = cpuRaw || "Unknown CPU";

    const ramRaw = spawnText(["sysctl", "-n", "hw.memsize"]);
    const ramBytes = parseInt(ramRaw, 10);
    ramGb = isNaN(ramBytes) ? 0 : Math.round(ramBytes / 1e9);

    // Chip model from system_profiler (graceful fallback)
    try {
      const profRaw = spawnText([
        "system_profiler",
        "SPHardwareDataType",
        "-json",
      ]);
      if (profRaw) {
        const profData = JSON.parse(profRaw);
        const hw = profData?.SPHardwareDataType?.[0];
        chipModel = hw?.chip_type ?? hw?.machine_model ?? "";
      }
    } catch {
      chipModel = "";
    }

    // Extract chip generation number from chipModel (e.g. "Apple M3 Pro" → 3)
    if (chipModel) {
      const genMatch = /M(\d+)/i.exec(chipModel);
      if (genMatch) chipGeneration = parseInt(genMatch[1], 10);
    }
  } else {
    // Linux
    const cpuLine = spawnText([
      "bash",
      "-c",
      "grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2",
    ]).trim();
    cpu = cpuLine || "Unknown CPU";

    const memLine = spawnText([
      "bash",
      "-c",
      "grep MemTotal /proc/meminfo | awk '{print $2}'",
    ]);
    const ramKb = parseInt(memLine, 10);
    ramGb = isNaN(ramKb) ? 0 : Math.round(ramKb / 1e6);

    isAppleSilicon = false;

    // NVIDIA GPU detection
    const gpuRaw = spawnText([
      "nvidia-smi",
      "--query-gpu=name",
      "--format=csv,noheader",
    ]);
    gpuName = gpuRaw ? gpuRaw.split("\n")[0].trim() : "";

    if (gpuName) {
      const vramRaw = spawnText([
        "nvidia-smi",
        "--query-gpu=memory.total",
        "--format=csv,noheader,nounits",
      ]);
      const parsed = parseInt(vramRaw.split("\n")[0].trim(), 10);
      gpuVramMb = isNaN(parsed) ? 0 : parsed;
    }
  }

  // --- Classify hardware tier ---
  // localModel must remain an internal constant derived only from tier logic below.
  // If localModel is ever made configurable from external input, apply shell-safe
  // character validation before using it in display output or any future spawn calls.
  let tier: "compact" | "standard" | "full" = "compact";
  let localModel = "cloud model recommended (Claude/Gemini/GPT API)";
  let notes = "";

  if (isAppleSilicon) {
    // For newer chips (M3+), prefer slightly larger models at the same RAM tier
    const newerChip = chipGeneration >= 3;
    if (ramGb < 8) {
      tier = "compact";
      localModel = "gemma2:2b via Ollama";
      notes = `${ramGb}GB unified — tiny model or cloud API`;
      if (chipGeneration > 0) notes += ` (${chipModel})`;
    } else if (ramGb < 16) {
      tier = "standard";
      localModel = newerChip
        ? "llama3.2:3b or gemma2:9b via Ollama"
        : "llama3.2:3b via Ollama";
      if (chipGeneration > 0) notes = chipModel;
    } else if (ramGb < 32) {
      tier = "standard";
      localModel = newerChip
        ? "qwen2.5:14b or llama3.1:8b via Ollama"
        : "qwen2.5:14b or llama3.1:8b via Ollama";
      if (chipGeneration > 0) notes = chipModel;
    } else {
      tier = "full";
      localModel = "qwen2.5:32b or llama3.1:70b (4-bit) via Ollama";
      if (chipGeneration > 0) notes = chipModel;
    }
  } else if (!isAppleSilicon && gpuName) {
    // Linux with NVIDIA GPU
    if (gpuVramMb < 8000) {
      tier = "standard";
      localModel = "llama3.2:3b via Ollama";
    } else {
      tier = "full";
      localModel = "llama3.1:8b or qwen2.5:14b via Ollama";
    }
  } else {
    // Other (Intel Mac, non-GPU Linux)
    tier = "compact";
    localModel = "cloud model recommended (Claude/Gemini/GPT API)";
    notes = "No Apple Silicon or discrete GPU — cloud API is best";
  }

  // --- Use-case quiz ---
  // Use existingRl if provided (called from init.ts), otherwise create a new one.
  const ownRl = !existingRl;
  const rl = existingRl ??
    readline.createInterface({ input: process.stdin, output: process.stdout });

  if (ownRl) {
    // Only install SIGINT handler when we own the readline instance
    process.on("SIGINT", () => {
      rl.close();
      process.exit(130);
    });
  }

  const question = (prompt: string): Promise<string> =>
    new Promise((res) => rl.question(prompt, res));

  process.stdout.write(
    "\nWhat will you use this memex for?\n" +
      "  1. Daily brief / news aggregation\n" +
      "  2. Note-taking & writing assistant\n" +
      "  3. Code assistant (agentic)\n" +
      "  4. Research & deep reading\n" +
      "  5. Personal journal\n" +
      "  6. General purpose\n"
  );
  const rawChoice = await question("→ [1-6]: ");
  const choice = parseInt(rawChoice.trim(), 10);
  const useCase = isNaN(choice) || choice < 1 || choice > 6 ? 6 : choice;

  // Adjustments based on use case — update BOTH tier AND localModel together
  if (useCase === 3) {
    // Code assistant: bump compact → standard, update model recommendation
    if (tier === "compact") {
      tier = "standard";
      // Update localModel to a standard-tier suggestion appropriate for the hardware
      if (isAppleSilicon && ramGb < 16) {
        localModel = "llama3.2:3b via Ollama";
      } else if (isAppleSilicon) {
        localModel = "qwen2.5:14b via Ollama";
      } else {
        localModel = "llama3.2:3b via Ollama";
      }
      if (!notes.includes("cloud")) notes += (notes ? "; " : "") + "agentic model preferred";
      else notes += " — agentic model preferred";
    } else {
      notes += (notes ? "; " : "") + "agentic model preferred";
    }
  } else if (useCase === 4) {
    // Research: bump compact → standard, update model recommendation
    if (tier === "compact") {
      tier = "standard";
      if (isAppleSilicon && ramGb < 16) {
        localModel = "llama3.2:3b via Ollama";
      } else if (isAppleSilicon) {
        localModel = "qwen2.5:14b via Ollama";
      } else {
        localModel = "llama3.2:3b via Ollama";
      }
      if (!notes.includes("cloud")) notes += (notes ? "; " : "") + "large context is important";
      else notes += " — large context is important";
    } else {
      notes += (notes ? "; " : "") + "large context is important";
    }
  }

  // --- Print recommendation box ---
  console.log("\n-------------------------------------------");
  console.log("  Recommendation");
  console.log("-------------------------------------------");
  console.log(`  Hardware : ${cpu} · ${ramGb}GB RAM`);
  if (chipModel) console.log(`  Chip     : ${chipModel}`);
  if (gpuName) console.log(`  GPU      : ${gpuName}`);
  console.log(
    `  Tier     : ${tier}  (compact=pre-assembled pack / standard=MAP+self / full=roam+links)`
  );
  console.log(`  Local AI : ${localModel}`);
  if (notes) console.log(`  Notes    : ${notes}`);
  console.log("");
  if (!notes.includes("cloud")) {
    // Extract full model:tag for the install command (e.g. "llama3.2:3b" not just "llama3.2")
    const modelTag = extractModelTag(localModel);
    console.log(
      `  To install: brew install ollama && ollama pull ${modelTag}`
    );
  }
  console.log(
    "  Cloud models: Claude (claude.ai), Gemini (aistudio.google.com), GPT (platform.openai.com)"
  );
  console.log("-------------------------------------------\n");

  // --- Optionally update clients/models.json ---
  const modelsPath = join(memexDir, "clients", "models.json");
  if (existsSync(modelsPath)) {
    const updateAnswer = await question(
      "Update clients/models.json with these recommended defaults? [Y/n]: "
    );
    const doUpdate = updateAnswer.trim().toLowerCase() !== "n";
    if (doUpdate) {
      try {
        const modelsJson = JSON.parse(readFileSync(modelsPath, "utf8"));
        const modelTag = extractModelTag(localModel);
        const matchSlug = modelTag.split(":")[0];
        const windowTokens =
          tier === "full" ? 32000 : tier === "standard" ? 16000 : 8192;
        const newEntry = {
          match: [matchSlug],
          label: localModel + " (scan recommendation)",
          windowTokens,
          brainFraction: 0.4,
          tier,
          agentic: false,
          structuredOutput: true,
          notes: "Recommended by memex scan for this hardware",
        };
        if (!Array.isArray(modelsJson.models)) modelsJson.models = [];
        modelsJson.models.unshift(newEntry);
        const tmp = modelsPath + ".tmp";
        writeFileSync(tmp, JSON.stringify(modelsJson, null, 2) + "\n");
        renameSync(tmp, modelsPath);
        console.log("✓ updated clients/models.json");
      } catch (e) {
        console.error(`✗ failed to update models.json: ${String(e).slice(0, 80)}`);
      }
    }
  }

  // Only close rl if we own it (not when called from init.ts with an existing interface)
  if (ownRl) {
    rl.close();
  }
  // NOTE: Do NOT call process.exit() here. Callers (init.ts) need to continue after runScan().
}

if (import.meta.main) {
  const dir = process.argv[2] ?? process.cwd();
  await runScan(dir);
  process.exit(0);
}
