const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type OllamaPsResponse = { models?: Array<{ name: string }> };

export async function listLoadedModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as OllamaPsResponse;
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function unloadModel(baseUrl: string, model: string): Promise<void> {
  try {
    await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // best-effort
  }
}

export async function unloadAllModels(baseUrl: string): Promise<void> {
  for (const model of await listLoadedModels(baseUrl)) {
    await unloadModel(baseUrl, model);
  }
}

export async function waitUntilUnloaded(
  baseUrl: string,
  maxWaitMs: number,
): Promise<string[]> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const loaded = await listLoadedModels(baseUrl);
    if (loaded.length === 0) return [];
    await sleep(500);
  }
  return listLoadedModels(baseUrl);
}

/** Unload a model and wait until Ollama reports no loaded models. */
export async function prepareModelSwitch(
  baseUrl: string,
  fromModel: string,
  cooldownMs = 2000,
): Promise<void> {
  await unloadModel(baseUrl, fromModel);
  if (cooldownMs > 0) await sleep(cooldownMs);

  const stillLoaded = await waitUntilUnloaded(baseUrl, Math.max(cooldownMs, 30_000));
  if (stillLoaded.length === 0) return;

  for (const model of stillLoaded) {
    await unloadModel(baseUrl, model);
  }
  await sleep(2000);
  await waitUntilUnloaded(baseUrl, 15_000);
}

export function isOllamaFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const lower = err.message.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket hang up") ||
    lower.includes("econnreset")
  );
}
