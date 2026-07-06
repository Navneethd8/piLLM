import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition } from "../../providers/types.js";

const execFileAsync = promisify(execFile);

export interface ToolContext {
  workspace: string;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

function safePath(workspace: string, userPath: string): string {
  const abs = resolve(workspace, userPath);
  const ws = resolve(workspace);
  if (!abs.startsWith(ws)) {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  return abs;
}

export const readTool: Tool = {
  definition: {
    name: "read",
    description: "Read a file from the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within workspace" },
      },
      required: ["path"],
    },
  },
  async run(args, ctx) {
    const path = safePath(ctx.workspace, String(args.path));
    if (!existsSync(path)) {
      return { output: `File not found: ${args.path}`, isError: true };
    }
    if (statSync(path).isDirectory()) {
      return {
        output: `Path is a directory, not a file: ${args.path}. Use bash to list contents (e.g. ls "${args.path}").`,
        isError: true,
      };
    }
    const content = readFileSync(path, "utf8");
    const max = 12_000;
    if (content.length > max) {
      return { output: content.slice(0, max) + `\n...[truncated ${content.length - max} chars]` };
    }
    return { output: content };
  },
};

export const writeTool: Tool = {
  definition: {
    name: "write",
    description: "Write or overwrite a file in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  async run(args, ctx) {
    const path = safePath(ctx.workspace, String(args.path));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(args.content), "utf8");
    return { output: `Wrote ${args.path}` };
  },
};

export const editTool: Tool = {
  definition: {
    name: "edit",
    description: "Replace one exact string in a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  async run(args, ctx) {
    const path = safePath(ctx.workspace, String(args.path));
    if (!existsSync(path)) {
      return { output: `File not found: ${args.path}`, isError: true };
    }
    if (statSync(path).isDirectory()) {
      return {
        output: `Path is a directory, not a file: ${args.path}. Use bash to list contents (e.g. ls "${args.path}").`,
        isError: true,
      };
    }
    const oldText = String(args.old_text);
    const content = readFileSync(path, "utf8");
    if (!content.includes(oldText)) {
      return { output: "old_text not found in file", isError: true };
    }
    writeFileSync(path, content.replace(oldText, String(args.new_text)), "utf8");
    return { output: `Edited ${args.path}` };
  },
};

export const bashTool: Tool = {
  definition: {
    name: "bash",
    description: "Run a shell command in the workspace directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
  },
  async run(args, ctx) {
    const command = String(args.command);
    const blocked = [/rm\s+-rf\s+\//, /\bsudo\b/, /\bmkfs\b/, /\bdd\s+if=/];
    if (blocked.some((re) => re.test(command))) {
      return { output: "Command blocked for safety", isError: true };
    }
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
        cwd: ctx.workspace,
        timeout: 30_000,
        maxBuffer: 64_000,
      });
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { output: out || "(no output)" };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
      return { output: out.slice(0, 8000), isError: true };
    }
  },
};

export const BUILTIN_TOOLS: Tool[] = [readTool, writeTool, editTool, bashTool];

export function getToolMap(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((t) => [t.definition.name, t]));
}
