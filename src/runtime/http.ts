export type HttpErrorKind = "timeout" | "rate_limit" | "auth" | "payment_required" | "server" | "client" | "network";

export class HttpRequestError extends Error {
  constructor(message: string, public readonly kind: HttpErrorKind, public readonly status?: number, public readonly retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = "HttpRequestError";
  }
}

export interface FetchRetryOptions {
  timeoutMs?: number;
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function classifyStatus(status: number): HttpRequestError {
  if (status === 401 || status === 403) return new HttpRequestError(`HTTP ${status}（鉴权失败）`, "auth", status, false);
  if (status === 402) return new HttpRequestError("HTTP 402（配额或付费要求）", "payment_required", status, false);
  if (status === 429) return new HttpRequestError("HTTP 429（请求频率受限）", "rate_limit", status, true);
  if (status >= 500) return new HttpRequestError(`HTTP ${status}（上游服务异常）`, "server", status, true);
  return new HttpRequestError(`HTTP ${status}（请求被拒绝）`, "client", status, false);
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export async function fetchWithRetry(input: string | URL, init: RequestInit = {}, options: FetchRetryOptions = {}): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      const error = classifyStatus(response.status);
      lastError = error;
      if (!error.retryable || attempt === attempts) throw error;
      const wait = Math.min(maxDelayMs, retryAfterMs(response) ?? baseDelayMs * 2 ** (attempt - 1));
      await sleep(wait);
    } catch (error) {
      const classified = error instanceof HttpRequestError
        ? error
        : error instanceof DOMException && error.name === "TimeoutError"
          ? new HttpRequestError("请求超时", "timeout", undefined, true, { cause: error })
          : new HttpRequestError("网络请求失败", "network", undefined, true, { cause: error as Error });
      lastError = classified;
      if (!classified.retryable || attempt === attempts) throw classified;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}
