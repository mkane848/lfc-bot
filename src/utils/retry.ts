export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Retry an async operation with exponential backoff and jitter. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 300, maxDelayMs = 3000 }: RetryOptions = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) {
        break;
      }
      const delay = Math.min(baseDelayMs * 2 ** i, maxDelayMs) + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
