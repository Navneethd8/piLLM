import type { HarnessConfig } from "../../config.js";
import {
  countSkills,
  readSkill,
  skillExists,
  writeSkill,
} from "../../memory/files.js";
import type { Tool } from "./index.js";

export function createSkillTools(config: HarnessConfig): Tool[] {
  if (!config.skillsEnabled) return [];

  return [skillReadTool(config), skillManageTool(config)];
}

const skillReadTool = (config: HarnessConfig): Tool => ({
  definition: {
    name: "skill_read",
    description:
      "Load a skill's full SKILL.md from ~/.pillm/skills. Use when a task matches an indexed skill.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Skill path as category/name (e.g. general/git-status)",
        },
      },
      required: ["path"],
    },
  },
  async run(args) {
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { output: "path required (category/name)", isError: true };
    }
    const content = readSkill(config.home, path);
    if (!content) {
      return { output: `Skill not found: ${path}`, isError: true };
    }
    const max = config.maxSkillBytes;
    if (content.length > max) {
      return {
        output:
          content.slice(0, max) +
          `\n...[truncated ${content.length - max} chars]`,
      };
    }
    return { output: content };
  },
});

const skillManageTool = (config: HarnessConfig): Tool => ({
  definition: {
    name: "skill_manage",
    description:
      "Save a reusable workflow as a skill (SKILL.md). Only when the user asks or after a multi-step task worth reusing.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill directory name (kebab-case)",
        },
        category: {
          type: "string",
          description: "Category folder (default: general)",
        },
        content: {
          type: "string",
          description: "Full SKILL.md markdown content",
        },
      },
      required: ["name", "content"],
    },
  },
  async run(args) {
    const category = String(args.category ?? "general").trim() || "general";
    const name = String(args.name ?? "").trim();
    const content = String(args.content ?? "");

    if (!name) {
      return { output: "name required", isError: true };
    }
    if (!content.trim()) {
      return { output: "content required", isError: true };
    }
    if (content.length > config.maxSkillBytes) {
      return {
        output: `Skill too large (${content.length} bytes, max ${config.maxSkillBytes})`,
        isError: true,
      };
    }

    const exists = skillExists(config.home, category, name);
    if (!exists && countSkills(config.home) >= config.maxSkills) {
      return {
        output: `Skill limit reached (${config.maxSkills}). Delete an old skill first.`,
        isError: true,
      };
    }

    const path = writeSkill(config.home, category, name, content);
    return { output: `Skill saved: ${path}` };
  },
});
