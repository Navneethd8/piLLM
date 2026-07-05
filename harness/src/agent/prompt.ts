import type { HarnessConfig } from "../config.js";
import { readContextFile } from "../config.js";
import { listSkillIndex, loadMemory, loadSoul, loadUser } from "../memory/files.js";

export interface PromptOptions {
  platform?: string;
}

export function buildSystemPrompt(config: HarnessConfig, opts: PromptOptions = {}): string {
  const platform = opts.platform ?? "cli";
  const agents = readContextFile(config.workspace, "AGENTS.md");
  const sections = [
    loadSoul(config.home),
    `Platform: ${platform}. Keep replies concise on edge hardware.`,
    `Memory snapshot:\n${loadMemory(config.home)}\n§\n${loadUser(config.home)}`,
    `Skills index (use read tool on ~/.pillm/skills/<cat>/<name>/SKILL.md when relevant):\n${listSkillIndex(config.home)}`,
    agents ? `Project context:\n${agents}` : "",
    "You have tools: read, write, edit, bash. Use them to solve tasks on the Pi.",
    "Prefer local reasoning. Be honest about limits on a small edge model.",
  ].filter(Boolean);

  return sections.join("\n\n");
}
