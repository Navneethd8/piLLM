#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { ensureHome } from "./memory/files.js";
import { AgentLoop } from "./agent/loop.js";
import { startGateway } from "./gateway/runner.js";
import { startWebServer } from "./web/server.js";
import { globalQueue } from "./queue/single-flight.js";

async function cmdChat(): Promise<void> {
  const config = loadConfig();
  ensureHome(config.home);
  const agent = new AgentLoop(config);
  const sessionId = agent.getSessionStore().getOrCreateSession("cli", "default", "CLI");

  console.log(`piLLM harness — provider chain: local first (${config.ollamaModel})`);
  console.log(`home: ${config.home}`);
  console.log("Type exit to quit.\n");

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const line = (await rl.question("you> ")).trim();
      if (!line || line === "exit" || line === "quit") break;

      const result = await globalQueue.enqueue(() =>
        agent.runTurn({ sessionId, userText: line, platform: "cli" }),
      );
      console.log(`\npillm [${result.provider}, ${result.iterations} steps]>\n${result.reply}\n`);
    }
  } finally {
    rl.close();
    agent.close();
  }
}

async function cmdServe(): Promise<void> {
  const config = loadConfig();
  ensureHome(config.home);
  startWebServer(config);
}

async function cmdGateway(): Promise<void> {
  const config = loadConfig();
  ensureHome(config.home);
  await startGateway(config);
}

async function cmdHealth(): Promise<void> {
  const config = loadConfig();
  const res = await fetch(`${config.ollamaBaseUrl}/v1/models`).catch(() => null);
  console.log(JSON.stringify({
    home: config.home,
    ollama: res?.ok ?? false,
    model: config.ollamaModel,
  }, null, 2));
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "chat";
  switch (cmd) {
    case "chat":
      await cmdChat();
      break;
    case "serve":
      await cmdServe();
      break;
    case "gateway":
      await cmdGateway();
      break;
    case "health":
      await cmdHealth();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Usage: pillm [chat|serve|gateway|health]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
