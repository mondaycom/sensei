/**
 * Retry with exponential backoff for LLM judge calls.
 *
 * Handles 429/500/502/503 and timeouts with configurable retries.
 * Does NOT retry 400/401/403 (client errors that won't resolve on retry).
 */

export interface RetryConfig {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 500) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 to randomise delay (default: 0.3) */
  jitter?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403]);

/** Check whether an error is retryable. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Timeout / abort errors are retryable
    if (err.name === 'AbortError' || err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      return true;
    }

    // OpenAI SDK attaches status to the error object
    const status = (err as unknown as Record<string, unknown>).status as number | undefined;
    if (typeof status === 'number') {
      if (NON_RETRYABLE_STATUS_CODES.has(status)) return false;
      if (RETRYABLE_STATUS_CODES.has(status)) return true;
      // Any 5xx is retryable
      if (status >= 500) return true;
    }

    // Check for status code in message (some SDKs format it this way)
    const match = err.message.match(/\b(429|500|502|503)\b/);
    if (match) return true;

    // Network errors
    if (err.message.includes('ECONNRESET') || err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      return true;
    }
  }

  // Unknown errors — retry by default to be safe
  return true;
}

/** Compute delay with exponential backoff and jitter. */
export function computeDelay(attempt: number, config: Required<Pick<RetryConfig, 'baseDelayMs' | 'maxDelayMs' | 'jitter'>>): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitterAmount = capped * config.jitter * Math.random();
  return capped + jitterAmount;
}

/**
 * Execute a function with retry + exponential backoff.
 *
 * @throws The last error if all retries are exhausted, or immediately for non-retryable errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 500;
  const maxDelayMs = config.maxDelayMs ?? 30_000;
  const jitter = config.jitter ?? 0.3;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry non-retryable errors
      if (!isRetryableError(err)) {
        throw lastError;
      }

      // Don't delay after the last attempt
      if (attempt < maxRetries) {
        const delay = computeDelay(attempt, { baseDelayMs, maxDelayMs, jitter });
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('All retries exhausted');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
