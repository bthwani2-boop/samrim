import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";

export async function readOwner(origin: string, bearer: string, method: "GET", path: string,
  signal: AbortSignal, cursor?: string): Promise<unknown> {
  // Only isolated local WLT and the Android emulator's host-loopback alias.
  // Production/public network origins are intentionally not admitted.
  const isolated = /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!isolated || Number(isolated[1]) > 65535) throw new WltReadError(503);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) throw new WltReadError(401);
  // Ten contract-valid funding entries, reversals and a keyset cursor can
  // exceed 4 KiB. Keep the balance bound at 4 KiB and history at 8 KiB.
  const maxBytes = path === wltOperations.listCurrentCustomerWalletTransactions.path ? 8192 : 4096;
  const requestURL = new URL(path, origin);
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(cursor)) {
      throw new WltReadError(400);
    }
    requestURL.searchParams.set("cursor", cursor);
  }
  const response = await fetch(requestURL, {
    method, signal, redirect: "error", credentials: "omit", cache: "no-store",
    headers: { Accept: "application/json", Authorization: "Bearer " + bearer },
  });
  if (response.status !== 200 ||
    response.headers.get("Cache-Control")?.toLowerCase() !== "no-store" ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    void response.body?.cancel().catch(() => {});
    throw new WltReadError([400, 401, 403].includes(response.status) ? response.status : 503);
  }
  const declaredSize = response.headers.get("Content-Length");
  if (declaredSize !== null && (!/^[0-9]+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) {
    void response.body?.cancel().catch(() => {});
    throw new WltReadError(502);
  }
  // Hermes/React Native may expose Response.text() but not ReadableStream or
  // TextDecoder. In that case validate the decoded UTF-8 byte count before
  // parsing. The WLT owner is limited to isolated host-loopback origins.
  if (!response.body?.getReader || typeof TextDecoder !== "function") {
    const text = await response.text();
    let bytes = 0;
    for (const rune of text) {
      const value = rune.codePointAt(0) ?? 0xfffd;
      bytes += value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4;
      if (bytes > maxBytes) throw new WltReadError(502);
    }
    signal.throwIfAborted();
    try { return JSON.parse(text) as unknown; }
    catch { throw new WltReadError(502); }
  }
  const stream = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      if (size + value.length > bytes.length) {
        void stream.cancel().catch(() => {});
        throw new WltReadError(502);
      }
      bytes.set(value, size);
      size += value.length;
    }
    signal.throwIfAborted();
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
    } catch {
      throw new WltReadError(502);
    }
  } finally {
    stream.releaseLock();
  }
}
