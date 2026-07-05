import type { HarnessConfig } from "../config.js";
import { readContextFile } from "../config.js";
import { listSkillIndex, loadMemory, loadSoul, loadUser } from "../memory/files.js";

export interface PromptOptions {
  platform?: string;
}

export function buildSystemPrompt(config: HarnessConfig, opts: PromptOptions = {}): string {
  const platform = opts.platform ?? "cli";
  const agents = readContextFile(config.workspace, "AGENTS.md");
  const toolNames = config.skillsEnabled
    ? "read, write, edit, bash, skill_read, skill_manage"
    : "read, write, edit, bash";

  const sections = [
    loadSoul(config.home),
    `Platform: ${platform}. Keep replies concise on edge hardware.`,
    `Memory snapshot:\n${loadMemory(config.home)}\n§\n${loadUser(config.home)}`,
    agents ? `Project context:\n${agents}` : "",
    `You have tools: ${toolNames}. Use them to solve tasks on the Pi.`,
    "Prefer local reasoning. Be honest about limits on a small edge model.",
  ];

  if (config.skillsEnabled) {
    const { index } = listSkillIndex(config.home, config.maxSkills);
    sections.splice(3, 0,
      `Skills (${config.maxSkills} max, ${config.maxSkillBytes} bytes each):\n${index}`,
      "Skills are reusable workflows in ~/.pillm/skills/. Use skill_read when a task matches the index. " +
        "Use skill_manage only when the user asks to save a skill, or after a multi-step task (4+ tool calls) worth reusing. " +
        "Keep SKILL.md short: title, when to use, steps, pitfalls.",
    );
  }

  return sections.filter(Boolean).join("\n\n");
}
