#!/usr/bin/env bun
/**
 * The shared conversation layer for smBrain — the one place both a MESSAGE PLATFORM
 * (a message platform) and a CHAT SYSTEM (a chat system) read and write, so they:
 *   • work with both           — one library, two surfaces
 *   • reach into each other     — uniform READ helpers span both surfaces + shared notes
 *   • don't bleed               — each tool WRITES only its own surface (enforced here, not
 *                                 just documented): appendDaily() only touches history/,
 *                                 writeChat() only touches chats/, and writeChat rejects a
 *                                 source that doesn't belong to the chat surface.
 *   • are built with memory in mind — conversations are SOURCES: capture() → inbox.md, then
 *                                 the owning tool distills its day into history/ (e.g. a message platform's
 *                                 daily-log), /brain promotes durable facts into self/ + wiki/,
 *                                 and organize.ts indexes everything in MAP.md.
 *
 * Both tools import this from smBrain (the shared ground): resolve knowledgePath, then
 * `import(join(knowledgePath(), "scripts", "conversations.ts"))`. BRAIN is derived from this
 * file's own location, so paths are correct no matter who imports it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";

const BRAIN = join(import.meta.dir, "..");
const TZ = "America/New_York"; // your home tz
export const today = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

/** The two surfaces and which conversation `source`s may live on each (the non-bleed partition). */
export const SURFACES = {
  history: { dir: join(BRAIN, "history"), sources: ["signal", "claude"] },                 // message platform
  chats: { dir: join(BRAIN, "chats"), sources: ["app", "claude", "manual", "signal"] },  // chat system
} as const;

const DAILY_SECTIONS = ["Threads", "Decisions", "Captures", "Open"] as const;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ── WRITE · message platform → history/ only ────────────────────────────────
/** Append a line to a section of a day's note (creating the daily if needed). history/ only. */
export function appendDaily(text: string, opts: { date?: string; section?: (typeof DAILY_SECTIONS)[number] } = {}): string {
  const date = opts.date ?? today();
  const section = opts.section && DAILY_SECTIONS.includes(opts.section) ? opts.section : "Threads";
  const dir = join(SURFACES.history.dir, date.slice(0, 4));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${date}.md`);
  if (!existsSync(path)) {
    writeFileSync(path, `---\nsummary: (to fill)\ntags: [daily]\nupdated: ${date}\n---\n\n# ${date}\n\n## Threads\n\n## Decisions\n\n## Captures\n\n## Open\n`);
  }
  let t = readFileSync(path, "utf8");
  const head = `## ${section}`;
  const i = t.indexOf(head);
  if (i < 0) t += `\n${head}\n- ${text}\n`;
  else { const nl = t.indexOf("\n", i); t = t.slice(0, nl + 1) + `- ${text}\n` + t.slice(nl + 1); }
  writeFileSync(path, t.replace(/updated:\s*.+/, `updated: ${date}`));
  return path;
}

// ── WRITE · chat system → chats/ only ───────────────────────────────────────
export type ChatMsg = { speaker: string; text: string; at?: string };
export type ChatMeta = { title: string; source: string; id?: string; slug?: string; attachedTo?: string; participants?: string[] };

/** Create/append a named chat (chats/ only) and keep the attached note's link-back in sync. */
export function writeChat(meta: ChatMeta, messages: ChatMsg[] = []): string {
  if (!(SURFACES.chats.sources as readonly string[]).includes(meta.source)) {
    throw new Error(`chat source "${meta.source}" not allowed on the chats surface (${SURFACES.chats.sources.join("/")})`);
  }
  mkdirSync(SURFACES.chats.dir, { recursive: true });
  const slug = meta.slug ?? slugify(meta.title);
  const path = join(SURFACES.chats.dir, `${slug}.md`);
  const date = today();
  if (!existsSync(path)) {
    writeFileSync(path, [
      "---", `id: ${meta.id ?? `${date}-${slug}`}`, `title: ${meta.title}`, `source: ${meta.source}`,
      `attachedTo: ${meta.attachedTo ? `[[${meta.attachedTo}]]` : ""}`,
      `participants: [${(meta.participants ?? ["you"]).join(", ")}]`,
      `created: ${date}`, `updated: ${date}`, "tags: [chat]", "---", "",
      `# ${meta.title}`, meta.attachedTo ? `\n> attached to [[${meta.attachedTo}]]` : "", "", "## Messages", "",
    ].join("\n"));
  }
  if (messages.length) {
    appendFileSync(path, messages.map((m) => `**${m.speaker}** · ${m.at ?? date} — ${m.text}`).join("\n") + "\n");
    writeFileSync(path, readFileSync(path, "utf8").replace(/updated:\s*.+/, `updated: ${date}`));
  }
  if (meta.attachedTo) ensureChatLink(meta.attachedTo, slug); // cross-reach: note ↔ chat stays bidirectional
  return path;
}

function ensureChatLink(noteName: string, slug: string): void {
  const target = findNote(noteName);
  if (!target) return;
  let t = readFileSync(target, "utf8");
  if (t.includes(`[[${slug}]]`)) return;
  t = /\n## Chat\b/.test(t) ? t.replace(/(\n## Chat\b[^\n]*\n)/, `$1- [[${slug}]]\n`) : t.replace(/\s*$/, "") + `\n\n## Chat\n- [[${slug}]]\n`;
  writeFileSync(target, t);
}

// ── READ · cross-reach (either tool spans both surfaces + shared notes) ──────
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Resolve a note by basename or relative path across self/ + wiki/. */
export function findNote(name: string): string | null {
  const want = basename(name);
  for (const root of ["self", "wiki"]) {
    for (const f of walk(join(BRAIN, root))) {
      if (basename(f, ".md") === want || f.replace(/\.md$/, "").endsWith(name)) return f;
    }
  }
  return null;
}

const fm = (t: string, key: string) => t.slice(0, 600).match(new RegExp(`\\n${key}:\\s*(.+)`))?.[1]?.trim() ?? "";

/** Recent dailies (message-platform stream), newest first. */
export function recentDailies(n = 10): Array<{ date: string; path: string; summary: string }> {
  return walk(SURFACES.history.dir)
    .filter((f) => /\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort().reverse().slice(0, n)
    .map((path) => ({ date: basename(path, ".md"), path, summary: fm(readFileSync(path, "utf8"), "summary") }));
}

/** Named chats, optionally filtered by source or the note they're attached to. */
export function listChats(filter: { source?: string; attachedTo?: string } = {}): Array<{ slug: string; title: string; source: string; attachedTo: string; path: string }> {
  return walk(SURFACES.chats.dir)
    .filter((f) => basename(f).toLowerCase() !== "readme.md")
    .map((path) => { const t = readFileSync(path, "utf8"); return { slug: basename(path, ".md"), title: fm(t, "title"), source: fm(t, "source"), attachedTo: (fm(t, "attachedTo").match(/\[\[([^\]]+)\]\]/)?.[1] ?? ""), path }; })
    .filter((c) => (!filter.source || c.source === filter.source) && (!filter.attachedTo || basename(c.attachedTo) === basename(filter.attachedTo)));
}

/** All chats attached to a given note (e.g. a message platform reaching into a chat system's chats for a topic). */
export const chatsFor = (noteName: string) => listChats({ attachedTo: noteName });

// ── MEMORY · the capture → distill → promote path ───────────────────────────
/** Drop a capture into inbox.md (the owning tool distills, /brain promotes to self/+wiki/, MAP indexes). */
export function capture(text: string, tag?: string): void {
  appendFileSync(join(BRAIN, "inbox.md"), `- ${tag ? tag + ": " : ""}${text}\n`);
}
