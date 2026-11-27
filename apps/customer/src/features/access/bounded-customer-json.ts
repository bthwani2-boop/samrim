/** Customer owns the bounded same-origin HTTP body admission and disposal boundary. */
type Cancelable = { cancel(): Promise<void> };

async function cancelBestEffort(acquire: () => Cancelable | null): Promise<void> {
  try {
    const target = acquire();
    if (target) await target.cancel();
  } catch {
    // A cleanup failure must never replace the admitted or rejected outcome.
  }
}

export function discardCustomerResponse(response: Pick<Response, "body" | "bodyUsed">): void {
  void cancelBestEffort(() => {
    const body = response.body;
    return body && !body.locked && !response.bodyUsed ? body : null;
  });
}

export async function readBoundedCustomerJSON(
  message: Pick<Request, "headers" | "body" | "signal">,
  limit = 8192,
): Promise<unknown> {
  const signal = message.signal;
  const deadlineMs = 2000;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let deadline: AbortSignal | undefined;
  let interrupt: (() => void) | undefined;
  let complete = false;
  try {
    const { body, headers } = message;
    if (!body || body.locked) return null;
    const declared = headers.get("Content-Length");
    if (
      signal.aborted ||
      headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    ) {
      void cancelBestEffort(() => body);
      return null;
    }

    const acquired = body.getReader();
    reader = acquired;
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
    deadline = lifetime;
    const stopped = new Promise<null>(resolve => { interrupt = () => resolve(null); });
    lifetime.addEventListener("abort", interrupt!, { once: true });

    async function consume(): Promise<unknown> {
      const bytes = new Uint8Array(limit);
      let used = 0;
      for (;;) {
        const chunk = await acquired.read();
        if (lifetime.aborted) return null;
        if (chunk.done) {
          complete = true;
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
        }
        if (chunk.value.byteLength > bytes.length - used) return null;
        bytes.set(chunk.value, used);
        used += chunk.value.byteLength;
      }
    }

    if (lifetime.aborted) return null;
    const result = await Promise.race([consume(), stopped]);
    return lifetime.aborted ? null : result;
  } catch {
    return null;
  } finally {
    if (deadline && interrupt) deadline.removeEventListener("abort", interrupt);
    if (reader) {
      if (!complete) void cancelBestEffort(() => reader ?? null);
      try { reader.releaseLock(); } catch { /* Never change the response outcome during release. */ }
    }
  }
}