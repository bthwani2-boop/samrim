/** Customer owns bounded same-origin JSON admission, consumption and disposal. */
type Cancelable = { cancel(): Promise<void> };
type Message = Pick<Request, "headers" | "body" | "signal">;
type Frame = { ceiling: number; expected: number | null };
const deadlineMs = 2000;

async function cancelBestEffort(acquire: () => Cancelable | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // Disposal must never replace an established outcome or wait indefinitely.
  }
}

function discardUnowned(body: ReadableStream<Uint8Array> | null): void {
  void cancelBestEffort(() => body && !body.locked ? body : null);
}

export function discardCustomerResponse(response: Pick<Response, "body" | "bodyUsed">): void {
  void cancelBestEffort(() => {
    const body = response.body;
    return body && !body.locked && !response.bodyUsed ? body : null;
  });
}

function admitFrame(headers: Headers, limit: number, incoming: boolean): Frame | null {
  if (!Number.isSafeInteger(limit) || limit <= 0 ||
    headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;

  const length = headers.get("Content-Length");
  const transfer = headers.get("Transfer-Encoding");
  const encoding = headers.get("Content-Encoding")?.toLowerCase() ?? null;
  if (transfer !== null && (length !== null || transfer.toLowerCase() !== "chunked")) return null;

  const declared = length === null ? null : Number(length);
  if (length !== null && (!/^\d+$/.test(length) || declared === null ||
    !Number.isSafeInteger(declared) || declared <= 0 || declared > limit)) return null;

  if (encoding === null || encoding === "identity") {
    return { ceiling: declared ?? limit, expected: declared };
  }
  // Browser Fetch exposes decoded response bytes but may retain the encoded
  // wire length. Never compare those two representations. Request bodies are
  // not transparently decompressed by this reader; reject compressed requests.
  if (incoming || !["gzip", "deflate", "br", "zstd"].includes(encoding)) return null;
  return { ceiling: limit, expected: null };
}

async function consumeJSON(reader: ReadableStreamDefaultReader<Uint8Array>, frame: Frame,
  lifetime: AbortSignal, finished: () => void): Promise<unknown> {
  const bytes = new Uint8Array(frame.ceiling);
  let used = 0;
  for (;;) {
    const chunk = await reader.read();
    if (lifetime.aborted) return null;
    if (chunk.done) {
      finished();
      if (frame.expected !== null && used !== frame.expected) return null;
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
    }
    if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > bytes.length - used) return null;
    bytes.set(chunk.value, used);
    used += chunk.value.byteLength;
  }
}

export async function readBoundedCustomerJSON(message: Message, limit = 8192): Promise<unknown> {
  let body: ReadableStream<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let lifetime: AbortSignal | undefined;
  let interrupt: (() => void) | undefined;
  let complete = false;
  try {
    body = message.body;
    if (!body || body.locked) return null;
    const signal = message.signal;
    // Inbound BFF consumers pass a Request; browser consumers pass the
    // explicitly selected response body, headers and caller signal.
    const frame = admitFrame(message.headers, limit, message instanceof Request);
    if (!frame || signal.aborted) return null;

    reader = body.getReader();
    lifetime = AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
    const stopped = new Promise<null>(resolve => { interrupt = () => resolve(null); });
    if (interrupt) lifetime.addEventListener("abort", interrupt, { once: true });
    if (lifetime.aborted) return null;
    const value = await Promise.race([
      consumeJSON(reader, frame, lifetime, () => { complete = true; }), stopped,
    ]);
    return lifetime.aborted ? null : value;
  } catch {
    return null;
  } finally {
    if (lifetime && interrupt) lifetime.removeEventListener("abort", interrupt);
    if (reader) {
      if (!complete) {
        const acquired = reader;
        void cancelBestEffort(() => acquired);
      }
      try { reader.releaseLock(); } catch { /* Never replace the response outcome during cleanup. */ }
    } else {
      discardUnowned(body);
    }
  }
}
