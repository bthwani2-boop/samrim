/** Shared DSH SDK error, endpoint validation and bounded owner-response decoding. */
export class DshPublicError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DshPublicError";
    this.status = status;
    this.code = code;
  }
}

export function endpoint(baseUrl: string, path: string): URL {
  if (!baseUrl) throw new DshPublicError(0, "DSH_ENDPOINT_NOT_CONFIGURED");
  let root: URL;
  try {
    root = new URL(baseUrl);
  } catch {
    throw new DshPublicError(0, "DSH_ENDPOINT_INVALID");
  }
  const secure = root.protocol === "https:" ||
    (root.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(root.hostname));
  if (!secure || root.username || root.password || root.pathname !== "/" || root.search || root.hash) {
    throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  }
  const pathname = path.split("?")[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") ||
    path.includes("#") || Array.from(path).some(character =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    /(^|\/)(?:\.|%2e){1,2}(\/|$)/i.test(pathname)) {
    throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  }
  const target = new URL(path, root);
  if (target.origin !== root.origin) throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  return target;
}

export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function isDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

const bodyDeadlineMs = 5_000;

function discard(response: Response): void {
  try {
    if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
  } catch { /* Failed cleanup cannot authorize an invalid reply. */ }
}

// The transport owns every acquired response until its domain policy finishes.
// The bounded reader owns an acquired reader; this boundary owns unread bodies,
// including status/media rejections and cancellation before a reader exists.
export async function consumeOwnerResponse<T>(
  response: Response, consume: () => Promise<T>,
): Promise<T> {
  try {
    return await consume();
  } finally {
    if (!response.bodyUsed) discard(response);
  }
}

// Pinned Expo and browser fetch expose streams. A text-only bridge cannot
// establish a byte bound before allocating the complete reply. Reject it.
export async function readBoundedOwnerJSON(
  response: Response, maxTextLength: number, strictByteLimit?: number, signal?: AbortSignal,
): Promise<unknown> {
  const maxBytes = strictByteLimit ?? 3 * maxTextLength;
  const length = response.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    discard(response);
    throw new Error("Oversized or invalid DSH owner reply length");
  }
  if (signal?.aborted || !response.body?.getReader || typeof TextDecoder !== "function") {
    discard(response);
    throw new Error(signal?.aborted ? "DSH owner read cancelled" : "DSH owner reply stream unavailable");
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  let complete = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("DSH owner body deadline exceeded")), bodyDeadlineMs);
    if (signal) {
      onAbort = () => reject(new Error("DSH owner read cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });

  try {
    const result = await Promise.race([
      stopped,
      (async () => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value.byteLength > maxBytes - size) throw new Error("Oversized DSH owner reply");
          bytes.set(chunk.value, size);
          size += chunk.value.byteLength;
        }
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
        if (decoded.length > maxTextLength) throw new Error("Oversized DSH owner reply");
        return JSON.parse(decoded) as unknown;
      })(),
    ]);
    if (signal?.aborted) throw new Error("DSH owner read cancelled");
    complete = true;
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    try {
      // Do not await transport cleanup: a hung cancellation must not keep
      // the caller or an abandoned account/Store context alive.
      if (!complete) void reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
}
