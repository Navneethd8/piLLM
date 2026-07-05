import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MEMORY_MAX = 2200;
const USER_MAX = 1375;

export function ensureHome(home: string): void {
  for (const sub of ["skills", "sessions", "data"]) {
    mkdirSync(join(home, sub), { recursive: true });
  }
}

function readOrDefault(home: string, name: string, fallback: string): string {
  const path = join(home, "data", name);
  if (!existsSync(path)) {
    mkdirSync(join(home, "data"), { recursive: true });
    writeFileSync(path, fallback, "utf8");
    return fallback;
  }
  return readFileSync(path, "utf8").trim();
}

export function loadSoul(home: string): string {
  return readOrDefault(
    home,
    "SOUL.md",
    "# SOUL\n\nYou are piLLM, a helpful edge agent running locally on a Raspberry Pi.\n",
  );
}

export function loadMemory(home: string): string {
  const raw = readOrDefault(home, "MEMORY.md", "# MEMORY\n\n");
  return raw.slice(0, MEMORY_MAX);
}

export function loadUser(home: string): string {
  const raw = readOrDefault(home, "USER.md", "# USER\n\n");
  return raw.slice(0, USER_MAX);
}

export function listSkillIndex(home: string, max = 20): { index: string; total: number } {
  const skillsDir = join(home, "skills");
  if (!existsSync(skillsDir)) return { index: "(no skills yet)", total: 0 };

  const entries: Array<{ key: string; desc: string }> = [];
  for (const category of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const catPath = join(skillsDir, category.name);
    for (const skill of readdirSync(catPath, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const skillPath = join(catPath, skill.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const raw = readFileSync(skillPath, "utf8");
      entries.push({
        key: `${category.name}/${skill.name}`,
        desc: skillDescription(raw, skill.name),
      });
    }
  }

  if (!entries.length) return { index: "(no skills yet)", total: 0 };

  entries.sort((a, b) => a.key.localeCompare(b.key));
  const lines = entries.slice(0, max).map((e) => `- ${e.key}: ${e.desc}`);
  if (entries.length > max) {
    lines.push(`(+${entries.length - max} more — use skill_read with category/name)`);
  }
  return { index: lines.join("\n"), total: entries.length };
}

function skillDescription(raw: string, fallback: string): string {
  const descMatch = raw.match(/^description:\s*(.+)$/m);
  if (descMatch) return descMatch[1]!.trim().slice(0, 60);
  const heading = raw.split("\n").find((l) => l.startsWith("# "));
  if (heading) return heading.replace(/^#\s*/, "").slice(0, 60);
  return fallback;
}

export function countSkills(home: string): number {
  return listSkillIndex(home, Number.MAX_SAFE_INTEGER).total;
}

export function skillExists(home: string, category: string, name: string): boolean {
  return existsSync(join(home, "skills", category, name, "SKILL.md"));
}

export function readSkill(home: string, skillPath: string): string | null {
  const normalized = skillPath.replace(/^\/+/, "");
  const path = join(home, "skills", normalized, "SKILL.md");
  if (!existsSync(path)) {
    const alt = join(home, "skills", normalized);
    if (existsSync(alt) && alt.endsWith("SKILL.md")) {
      return readFileSync(alt, "utf8");
    }
    return null;
  }
  return readFileSync(path, "utf8");
}

export function writeSkill(
  home: string,
  category: string,
  name: string,
  content: string,
): string {
  const dir = join(home, "skills", category, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content, "utf8");
  return path;
}

export function appendMemory(home: string, note: string): void {
  const path = join(home, "data", "MEMORY.md");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "# MEMORY\n\n";
  writeFileSync(path, `${existing.trimEnd()}\n\n${note.trim()}\n`, "utf8");
}
