#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { ensureHome } from "./memory/files.js";
import { AgentLoop } from "./agent/loop.js";
import { ProviderRouter } from "./providers/router.js";
import { startGateway } from "./gateway/runner.js";
import { startWebServer } from "./web/server.js";
import { globalQueue } from "./queue/single-flight.js";
import { runBenchmark } from "./eval/benchmark.js";
import { join } from "node:path";

async function cmdChat(): Promise<void> {
  const config = loadConfig();
  ensureHome(config.home);
  const agent = new AgentLoop(config);
  const router = new ProviderRouter(config);
  const sessionId = agent.getSessionStore().getOrCreateSession("cli", "default", "CLI");

  console.log(`piLLM harness — provider: ${config.provider} (${router.describeChain()})`);
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

async function cmdBenchmark(): Promise<void> {
  const config = loadConfig();
  ensureHome(config.home);

  const modelsArg = process.env.PILLM_BENCHMARK_MODELS;
  const models = modelsArg
    ? modelsArg.split(",").map((m) => m.trim()).filter(Boolean)
    : undefined;

  const outputPath =
    process.env.PILLM_BENCHMARK_OUTPUT ??
    join(config.home, "benchmarks", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

  await runBenchmark({
    ollamaBaseUrl: config.ollamaBaseUrl,
    models,
    outputPath,
    timeoutMs: config.inferenceTimeoutMs,
    home: config.home,
    numCtx: Number.parseInt(process.env.PILLM_BENCHMARK_NUM_CTX ?? "512", 10) || 512,
    cooldownMs: Number.parseInt(process.env.PILLM_BENCHMARK_COOLDOWN_MS ?? "3000", 10) || 3000,
    loadProbeMs:
      Number.parseInt(process.env.PILLM_BENCHMARK_LOAD_PROBE_MS ?? "300000", 10) || 300_000,
  });
}

async function cmdHealth(): Promise<void> {
  const config = loadConfig();
  const router = new ProviderRouter(config);
  const ollama = await fetch(`${config.ollamaBaseUrl}/v1/models`).catch(() => null);
  console.log(JSON.stringify({
    home: config.home,
    provider: config.provider,
    chain: router.describeChain(),
    ollama: ollama?.ok ?? false,
    cloud: Boolean(config.openaiApiKey),
    gemini: Boolean(config.geminiApiKey),
    model: config.openaiApiKey
      ? config.openaiModel
      : config.geminiApiKey
        ? config.geminiModel
        : config.ollamaModel,
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
    case "benchmark":
      await cmdBenchmark();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Usage: pillm [chat|serve|gateway|health|benchmark]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
