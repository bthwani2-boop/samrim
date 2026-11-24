export async function readBoundedCustomerJSON(request: Request, textSize = 8192): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > textSize)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const readSignal = AbortSignal.any([request.signal, AbortSignal.timeout(2000)]);
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<null>(resolve => {
    onAbort = () => resolve(null);
    if (readSignal.aborted) resolve(null);
    else readSignal.addEventListener("abort", onAbort, { once: true });
  });
  const bytes = new Uint8Array(textSize);
  let used = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next === null) return null;
      const { done, value } = next;
      if (done) break;
      if (used + value.length > bytes.length) return null;
      bytes.set(value, used);
      used += value.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
  } catch {
    return null;
  } finally {
    if (onAbort) readSignal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
