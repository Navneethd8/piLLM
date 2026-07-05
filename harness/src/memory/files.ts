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

export function listSkillIndex(home: string): string {
  const skillsDir = join(home, "skills");
  if (!existsSync(skillsDir)) return "(no skills yet)";
  const lines: string[] = [];
  for (const category of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const catPath = join(skillsDir, category.name);
    for (const skill of readdirSync(catPath, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const skillPath = join(catPath, skill.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const firstLine = readFileSync(skillPath, "utf8").split("\n")[0] ?? skill.name;
      lines.push(`- ${category.name}/${skill.name}: ${firstLine.replace(/^#\s*/, "")}`);
    }
  }
  return lines.length ? lines.join("\n") : "(no skills yet)";
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
