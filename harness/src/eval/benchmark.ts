import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Check =
  | { type: "contains"; value: string; ignoreCase?: boolean }
  | { type: "not_contains"; value: string; ignoreCase?: boolean }
  | { type: "regex"; pattern: string; ignoreCase?: boolean }
  | { type: "exact"; value: string; ignoreCase?: boolean };

export interface BenchmarkCase {
  id: string;
  category: string;
  prompt: string;
  checks: Check[];
  maxTokens?: number;
}

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

export interface CaseResult {
  model: string;
  caseId: string;
  category: string;
  ok: boolean;
  error?: string;
  accuracy: number;
  ttftMs: number;
  totalMs: number;
  loadMs: number;
  tokensGenerated: number;
  tokensPerSec: number;
  response: string;
}

export interface ModelSummary {
  model: string;
  casesTotal: number;
  casesOk: number;
  accuracy: number;
  avgTtftMs: number;
  avgTotalMs: number;
  avgTokensPerSec: number;
  reliability: number;
  compositeScore: number;
  rank: number;
}

export interface BenchmarkReport {
  ranAt: string;
  ollamaBaseUrl: string;
  models: string[];
  results: CaseResult[];
  summaries: ModelSummary[];
  winner: string | null;
  winnerReason: string;
}

function harnessRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalize(text: string, ignoreCase?: boolean): string {
  return ignoreCase ? text.toLowerCase() : text;
}

function scoreChecks(response: string, checks: Check[]): number {
  if (!checks.length) return 1;
  let passed = 0;
  for (const check of checks) {
    const hay = normalize(response, check.ignoreCase);
    switch (check.type) {
      case "contains":
        if (hay.includes(normalize(check.value, check.ignoreCase))) passed++;
        break;
      case "not_contains":
        if (!hay.includes(normalize(check.value, check.ignoreCase))) passed++;
        break;
      case "exact":
        if (hay.trim() === normalize(check.value, check.ignoreCase).trim()) passed++;
        break;
      case "regex": {
        const re = new RegExp(check.pattern, check.ignoreCase ? "i" : "");
        if (re.test(response)) passed++;
        break;
      }
    }
  }
  return passed / checks.length;
}

interface OllamaPsResponse {
  models?: Array<{ name: string; size?: number }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ollamaFetch(
  baseUrl: string,
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function listLoadedModels(baseUrl: string): Promise<string[]> {
  const res = await ollamaFetch(baseUrl, "/api/ps", {}).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json()) as OllamaPsResponse;
  return (data.models ?? []).map((m) => m.name);
}

async function unloadModel(baseUrl: string, model: string): Promise<void> {
  await ollamaFetch(baseUrl, "/api/generate", {
    model,
    prompt: "",
    keep_alive: 0,
  }).catch(() => null);
}

async function unloadAllModels(baseUrl: string): Promise<void> {
  const loaded = await listLoadedModels(baseUrl);
  for (const model of loaded) {
    await unloadModel(baseUrl, model);
  }
}

async function waitUntilUnloaded(baseUrl: string, maxWaitMs: number): Promise<string[]> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const loaded = await listLoadedModels(baseUrl);
    if (loaded.length === 0) return [];
    await sleep(500);
  }
  return listLoadedModels(baseUrl);
}

async function prepareModel(
  baseUrl: string,
  model: string,
  cooldownMs: number,
  numCtx: number,
  loadProbeMs: number,
): Promise<void> {
  await unloadAllModels(baseUrl);
  if (cooldownMs > 0) await sleep(cooldownMs);

  const stillLoaded = await waitUntilUnloaded(baseUrl, Math.max(cooldownMs, 30_000));
  if (stillLoaded.length > 0) {
    for (const loaded of stillLoaded) {
      await unloadModel(baseUrl, loaded);
    }
    await sleep(2000);
    const retry = await waitUntilUnloaded(baseUrl, 15_000);
    if (retry.length > 0) {
      throw new Error(
        `unload incomplete — still loaded: ${retry.join(", ")} (free RAM before benchmarking larger models)`,
      );
    }
  }

  let res: Response;
  try {
    res = await ollamaFetch(
      baseUrl,
      "/api/generate",
      { model, prompt: "ok", stream: false, options: { num_predict: 1, num_ctx: numCtx } },
      loadProbeMs,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timeout") || message.includes("aborted")) {
      throw new Error(
        `load probe timed out after ${Math.round(loadProbeMs / 1000)}s — ` +
          `USB model storage and 1GB RAM swap can take 10–15 min for 1B+ models on Pi`,
      );
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`load probe failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function runCase(
  baseUrl: string,
  model: string,
  testCase: BenchmarkCase,
  timeoutMs: number,
  numCtx: number,
): Promise<CaseResult> {
  const started = performance.now();
  let firstTokenAt: number | null = null;
  let response = "";
  let error: string | undefined;
  let loadMs = 0;
  let totalMs = 0;
  let tokensGenerated = 0;
  let tokensPerSec = 0;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: testCase.prompt }],
        stream: true,
        keep_alive: "5m",
        options: {
          num_predict: testCase.maxTokens ?? 128,
          num_ctx: numCtx,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const chunk = JSON.parse(trimmed) as OllamaChatChunk;
        if (chunk.error) throw new Error(chunk.error);

        const piece = chunk.message?.content ?? "";
        if (piece && firstTokenAt === null) firstTokenAt = performance.now();
        response += piece;

        if (chunk.done) {
          loadMs = (chunk.load_duration ?? 0) / 1e6;
          totalMs = (chunk.total_duration ?? 0) / 1e6;
          tokensGenerated = chunk.eval_count ?? 0;
          const evalMs = (chunk.eval_duration ?? 0) / 1e6;
          tokensPerSec = evalMs > 0 ? tokensGenerated / (evalMs / 1000) : 0;
          if (chunk.done_reason === "error") {
            error = "Ollama returned done_reason=error";
          }
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    totalMs = performance.now() - started;
  }

  const ttftMs = firstTokenAt !== null ? firstTokenAt - started : totalMs;
  const accuracy = error ? 0 : scoreChecks(response, testCase.checks);

  return {
    model,
    caseId: testCase.id,
    category: testCase.category,
    ok: !error,
    error,
    accuracy,
    ttftMs,
    totalMs: totalMs || performance.now() - started,
    loadMs,
    tokensGenerated,
    tokensPerSec,
    response: response.slice(0, 500),
  };
}

function summarizeModel(model: string, results: CaseResult[]): ModelSummary {
  const modelResults = results.filter((r) => r.model === model);
  const okResults = modelResults.filter((r) => r.ok);
  const reliability = modelResults.length ? okResults.length / modelResults.length : 0;
  const accuracy =
    modelResults.length
      ? modelResults.reduce((sum, r) => sum + r.accuracy, 0) / modelResults.length
      : 0;
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  const avgTtftMs = avg(okResults.map((r) => r.ttftMs));
  const avgTotalMs = avg(okResults.map((r) => r.totalMs));
  const avgTokensPerSec = avg(okResults.map((r) => r.tokensPerSec));

  const speedScore = Math.min(avgTokensPerSec / 8, 1);
  const latencyScore = Math.max(0, 1 - avgTtftMs / 30_000);
  const compositeScore =
    accuracy * 0.5 + speedScore * 0.25 + latencyScore * 0.15 + reliability * 0.1;

  return {
    model,
    casesTotal: modelResults.length,
    casesOk: okResults.length,
    accuracy,
    avgTtftMs,
    avgTotalMs,
    avgTokensPerSec,
    reliability,
    compositeScore,
    rank: 0,
  };
}

function pickWinner(summaries: ModelSummary[]): { winner: string | null; reason: string } {
  const viable = summaries.filter((s) => s.reliability >= 0.8);
  if (!viable.length) {
    const bestEffort = [...summaries].sort((a, b) => b.compositeScore - a.compositeScore)[0];
    if (!bestEffort || bestEffort.reliability === 0) {
      return { winner: null, reason: "No models completed successfully. Pull models first or check Ollama." };
    }
    return {
      winner: null,
      reason: `No model reached 80% reliability. Best effort: ${bestEffort.model} at ${Math.round(bestEffort.reliability * 100)}% reliability.`,
    };
  }

  const ranked = [...viable].sort((a, b) => b.compositeScore - a.compositeScore);
  const winner = ranked[0];
  return {
    winner: winner.model,
    reason: `Highest composite score (${(winner.compositeScore * 100).toFixed(1)}/100): accuracy ${(winner.accuracy * 100).toFixed(0)}%, ${winner.avgTokensPerSec.toFixed(1)} tok/s, TTFT ${winner.avgTtftMs.toFixed(0)}ms.`,
  };
}

function printReport(report: BenchmarkReport): void {
  console.log("\n=== piLLM model benchmark ===\n");
  console.log(`Ran at: ${report.ranAt}`);
  console.log(`Ollama: ${report.ollamaBaseUrl}\n`);

  console.log("Rank  Model               Acc%   Rel%   tok/s   TTFT ms  Total ms  Score");
  console.log("----  ------------------  -----  -----  ------  -------  --------  -----");
  for (const s of report.summaries) {
    console.log(
      `${String(s.rank).padStart(4)}  ${s.model.padEnd(20)}  ` +
        `${(s.accuracy * 100).toFixed(0).padStart(4)}  ` +
        `${(s.reliability * 100).toFixed(0).padStart(4)}  ` +
        `${s.avgTokensPerSec.toFixed(1).padStart(6)}  ` +
        `${s.avgTtftMs.toFixed(0).padStart(7)}  ` +
        `${s.avgTotalMs.toFixed(0).padStart(8)}  ` +
        `${(s.compositeScore * 100).toFixed(1).padStart(5)}`,
    );
  }

  console.log("\nPer-case detail:");
  for (const r of report.results) {
    const status = r.ok ? (r.accuracy >= 1 ? "PASS" : "PART") : "FAIL";
    console.log(
      `  [${status}] ${r.model} :: ${r.caseId} — acc ${(r.accuracy * 100).toFixed(0)}%, ` +
        `ttft ${r.ttftMs.toFixed(0)}ms, total ${r.totalMs.toFixed(0)}ms, ${r.tokensPerSec.toFixed(1)} tok/s` +
        (r.error ? ` — ${r.error}` : ""),
    );
  }

  console.log("\n=== Recommendation ===");
  if (report.winner) {
    console.log(`Best model: ${report.winner}`);
    console.log(report.winnerReason);
    console.log(`\nSet in ~/.pillm/.env:\n  OLLAMA_MODEL=${report.winner}`);
  } else {
    console.log("No viable model found. Check Ollama logs and Pi memory.");
  }
  console.log("");
}

export async function runBenchmark(opts: {
  ollamaBaseUrl: string;
  models?: string[];
  outputPath?: string;
  timeoutMs?: number;
  home?: string;
  numCtx?: number;
  cooldownMs?: number;
  loadProbeMs?: number;
}): Promise<BenchmarkReport> {
  const root = harnessRoot();
  const cases = loadJson<BenchmarkCase[]>(join(root, "eval/cases.json"));
  const models =
    opts.models ??
    loadJson<{ models: string[] }>(join(root, "eval/models.json")).models;

  const health = await fetch(`${opts.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Ollama not reachable at ${opts.ollamaBaseUrl}. Start ollama and retry.`);
  }

  const results: CaseResult[] = [];
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const numCtx = opts.numCtx ?? 512;
  const cooldownMs = opts.cooldownMs ?? 3000;
  const loadProbeMs = opts.loadProbeMs ?? 300_000;

  for (const model of models) {
    console.log(
      `\n>> Benchmarking ${model} (unload others, num_ctx=${numCtx}, load_probe=${Math.round(loadProbeMs / 1000)}s)...`,
    );
    try {
      await prepareModel(opts.ollamaBaseUrl, model, cooldownMs, numCtx, loadProbeMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`   SKIP: could not load ${model} — ${message}`);
      for (const testCase of cases) {
        results.push({
          model,
          caseId: testCase.id,
          category: testCase.category,
          ok: false,
          error: `model load failed: ${message}`,
          accuracy: 0,
          ttftMs: 0,
          totalMs: 0,
          loadMs: 0,
          tokensGenerated: 0,
          tokensPerSec: 0,
          response: "",
        });
      }
      await unloadAllModels(opts.ollamaBaseUrl);
      continue;
    }

    for (const testCase of cases) {
      process.stdout.write(`   ${testCase.id}... `);
      const result = await runCase(opts.ollamaBaseUrl, model, testCase, timeoutMs, numCtx);
      results.push(result);
      const label = result.ok
        ? `${(result.accuracy * 100).toFixed(0)}% acc, ${result.tokensPerSec.toFixed(1)} tok/s`
        : `FAIL: ${result.error}`;
      console.log(label);
    }

    console.log(`   unloading ${model}...`);
    await unloadModel(opts.ollamaBaseUrl, model);
    await unloadAllModels(opts.ollamaBaseUrl);
    if (cooldownMs > 0) await sleep(cooldownMs);
  }

  const summaries = models
    .map((model) => summarizeModel(model, results))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const { winner, reason } = pickWinner(summaries);
  const report: BenchmarkReport = {
    ranAt: new Date().toISOString(),
    ollamaBaseUrl: opts.ollamaBaseUrl,
    models,
    results,
    summaries,
    winner,
    winnerReason: reason,
  };

  if (opts.outputPath) {
    mkdirSync(dirname(opts.outputPath), { recursive: true });
    writeFileSync(opts.outputPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved: ${opts.outputPath}`);
  }

  printReport(report);
  return report;
}
