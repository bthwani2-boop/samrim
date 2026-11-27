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

// One best-effort cancellation boundary handles native synchronous access and
// asynchronous cancellation alike. Callers never wait for transport cleanup.
async function discardStream(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // Cleanup failure must not replace the established owner outcome.
  }
}

function discardUnread(response: Response): void {
  void discardStream(() => {
    if (response.bodyUsed) return null;
    const body = response.body;
    return body && !body.locked ? body : null;
  });
}

// A response body has its own established byte and read budget. Header
// acquisition must also settle even when a native fetch ignores cancellation.
const headerDeadlineMs = 10_000;

export async function fetchOwnerHeaders(input: string | URL, init: RequestInit): Promise<Response> {
  const caller = init.signal;
  const stale = () => new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (caller?.aborted) throw stale();

  const transport = new AbortController();
  let interrupted = false;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  function interrupt(error: Error): void {
    if (interrupted) return;
    interrupted = true;
    rejectStopped(error);
    transport.abort();
  }
  const onAbort = () => interrupt(stale());
  caller?.addEventListener("abort", onAbort, { once: true });
  const deadline = setTimeout(() => interrupt(new Error("DSH owner header deadline exceeded")), headerDeadlineMs);

  try {
    const pending = (async () => {
      const response = await fetch(input, { ...init, signal: transport.signal });
      if (interrupted) {
        discardUnread(response);
        throw stale();
      }
      return response;
    })();
    const response = await Promise.race([pending, stopped]);
    if (caller?.aborted) {
      discardUnread(response);
      throw stale();
    }
    return response;
  } finally {
    clearTimeout(deadline);
    caller?.removeEventListener("abort", onAbort);
  }
}

// The response boundary owns unread bodies. The bounded decoder owns its
// acquired reader, including cancellation before releasing the lock.
export async function consumeOwnerResponse<T>(
  response: Response, consume: () => Promise<T>,
): Promise<T> {
  try {
    return await consume();
  } finally {
    discardUnread(response);
  }
}

// Pinned Expo and browser fetch expose streams. A text-only bridge cannot
// establish a byte bound before allocating the complete reply. Reject it.
export async function readBoundedOwnerJSON(
  response: Response, maxTextLength: number, strictByteLimit?: number, signal?: AbortSignal,
): Promise<unknown> {
  const maxBytes = strictByteLimit ?? 3 * maxTextLength;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    const length = response.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      throw new Error("Oversized or invalid DSH owner reply length");
    }
    const body = response.body;
    if (signal?.aborted || !body?.getReader || typeof TextDecoder !== "function") {
      throw new Error(signal?.aborted ? "DSH owner read cancelled" : "DSH owner reply stream unavailable");
    }
    const acquired = body.getReader();
    reader = acquired;
    const bytes = new Uint8Array(maxBytes);
    let size = 0;
    const stopped = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("DSH owner body deadline exceeded")), bodyDeadlineMs);
      if (signal) {
        onAbort = () => reject(new Error("DSH owner read cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
    });
    const result = await Promise.race([
      stopped,
      (async () => {
        for (;;) {
          const chunk = await acquired.read();
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
    if (reader) {
      if (!complete) void discardStream(() => reader ?? null);
      reader.releaseLock();
    } else {
      discardUnread(response);
    }
  }
}
