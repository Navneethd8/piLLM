import type { HarnessConfig } from "../../config.js";
import { BUILTIN_TOOLS, type Tool } from "./index.js";
import { createSkillTools } from "./skills.js";

export function getAgentTools(config: HarnessConfig): Tool[] {
  return [...BUILTIN_TOOLS, ...createSkillTools(config)];
}
