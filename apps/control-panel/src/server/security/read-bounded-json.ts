export type BoundedJsonResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; status: 400 | 413 }>;

/** Enforces the body cap while streaming, including chunked requests with no Content-Length. */
export async function readBoundedJson(request: Request, limit: number): Promise<BoundedJsonResult> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("INVALID_BODY_LIMIT");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > limit) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
