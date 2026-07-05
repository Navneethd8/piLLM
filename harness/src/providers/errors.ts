export class ProviderChatError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = "ProviderChatError";
  }
}

const RETRYABLE_STATUSES = new Set([401, 402, 408, 409, 429, 500, 502, 503, 504, 529]);

export function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof ProviderChatError) {
    if (err.status && RETRYABLE_STATUSES.has(err.status)) return true;
    return matchesRetryableMessage(err.message);
  }

  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    if (matchesRetryableMessage(err.message)) return true;
    const cause = (err as { cause?: unknown }).cause;
    if (cause && cause !== err) return isRetryableProviderError(cause);
  }

  return false;
}

function matchesRetryableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("insufficient") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("overloaded") ||
    lower.includes("capacity") ||
    lower.includes("too many requests") ||
    lower.includes("billing") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket hang up")
  );
}
