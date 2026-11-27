/** One byte-bounded JSON decoder for Merchant same-origin HTTP messages. */
export async function readMerchantJSON(
  message: Pick<Request, "body" | "headers">,
  signal: AbortSignal,
  limit: number,
  deadlineMs: number,
): Promise<unknown> {
  const { body, headers } = message;
  if (!body || body.locked) return null;
  const declared = headers.get("Content-Length");
  if (
    signal.aborted ||
    headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
  ) {
    void body.cancel().catch(() => {});
    return null;
  }
  const reader = body.getReader();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
  let interrupt!: () => void;
  let consumed = false;
  const stopped = new Promise<null>(resolve => { interrupt = () => resolve(null); });
  deadline.addEventListener("abort", interrupt, { once: true });
  async function consume(): Promise<unknown> {
    const bytes = new Uint8Array(limit);
    let used = 0;
    for (;;) {
      const chunk = await reader.read();
      if (deadline.aborted) return null;
      if (chunk.done) {
        consumed = true;
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
      }
      if (chunk.value.byteLength > bytes.length - used) return null;
      bytes.set(chunk.value, used);
      used += chunk.value.byteLength;
    }
  }
  try {
    if (deadline.aborted) return null;
    const value = await Promise.race([consume(), stopped]);
    return deadline.aborted ? null : value;
  } catch {
    return null;
  } finally {
    deadline.removeEventListener("abort", interrupt);
    if (!consumed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function readMutationBody(request: Request, limit: number): Promise<unknown> {
  return readMerchantJSON(request, request.signal, limit, 2000);
}
