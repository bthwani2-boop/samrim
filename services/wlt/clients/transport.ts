import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";

// The existing wallet continuation budget also bounds direct owner reads.
// One deadline covers headers, body and parsing; a caller may cancel earlier.
const readBudgetMs = 12_000;

// One cleanup boundary handles both a synchronous native bridge exception and
// an asynchronous cancellation rejection without delaying the owner result.
async function discardStream(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // A failed cleanup cannot turn a rejected owner reply into an accepted one.
  }
}

function discardBody(response: Response): void {
  void discardStream(() => {
    const body = response.body;
    return body && !body.locked ? body : null;
  });
}

function requestURL(origin: string, path: string, cursor?: string): URL {
  // WLT is admitted only on isolated local development origins.
  const isolated = /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!isolated || Number(isolated[1]) > 65535) throw new WltReadError(503);
  const url = new URL(path, origin);
  if (!path.startsWith("/") || path.startsWith("//") || url.origin !== new URL(origin).origin) throw new WltReadError(503);
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(cursor)) throw new WltReadError(400);
    url.searchParams.set("cursor", cursor);
  }
  return url;
}

function admitResponse(response: Response, maxBytes: number): void {
  if (response.status !== 200 ||
      response.headers.get("Cache-Control")?.toLowerCase() !== "no-store" ||
      response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    discardBody(response);
    throw new WltReadError([400, 401, 403].includes(response.status) ? response.status : 503);
  }
  const declaredSize = response.headers.get("Content-Length");
  if (declaredSize !== null && (!/^[0-9]+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) {
    discardBody(response);
    throw new WltReadError(502);
  }
}

async function readJSON(response: Response, maxBytes: number,
  stopped: Promise<never>, signal: AbortSignal): Promise<unknown> {
  const body = response.body;
  // Retain the admitted text-only Native compatibility contract. This path
  // bounds the wait and validates the decoded size; streaming is preferred.
  if (!body?.getReader || typeof TextDecoder !== "function") {
    try {
      const text = await Promise.race([response.text(), stopped]);
      let bytes = 0;
      for (const rune of text) {
        const point = rune.codePointAt(0) ?? 0xfffd;
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (bytes > maxBytes) throw new WltReadError(502);
      }
      return JSON.parse(text) as unknown;
    } catch {
      discardBody(response);
      throw new WltReadError(signal.aborted ? 503 : 502);
    }
  }

  const reader = body.getReader();
  let complete = false;
  try {
    const value = await Promise.race([(async () => {
      const bytes = new Uint8Array(maxBytes);
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.byteLength > bytes.length - size) throw new WltReadError(502);
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
    })(), stopped]);
    complete = true;
    return value;
  } catch {
    throw new WltReadError(signal.aborted ? 503 : 502);
  } finally {
    if (!complete) void discardStream(() => reader);
    reader.releaseLock();
  }
}

export async function readOwner(origin: string, bearer: string, method: "GET", path: string,
  signal: AbortSignal, cursor?: string): Promise<unknown> {
  const url = requestURL(origin, path, cursor);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) throw new WltReadError(401);
  if (signal.aborted) throw new WltReadError(503);

  // Own transport cancellation, not the caller's lifecycle. The race is
  // independent of whether the native bridge honors the abort signal.
  const controller = new AbortController();
  let rejectStop!: (error: WltReadError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const stop = () => {
    controller.abort();
    rejectStop(new WltReadError(503));
  };
  signal.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(stop, readBudgetMs);

  try {
    let response: Response;
    try {
      response = await Promise.race([Promise.resolve().then(async () => {
        if (controller.signal.aborted) throw new WltReadError(503);
        const reply = await fetch(url, {
          method, signal: controller.signal, redirect: "error", credentials: "omit", cache: "no-store",
          headers: { Accept: "application/json", Authorization: "Bearer " + bearer },
        });
        if (controller.signal.aborted) {
          discardBody(reply);
          throw new WltReadError(503);
        }
        return reply;
      }), stopped]);
    } catch {
      throw new WltReadError(503);
    }
    if (controller.signal.aborted) {
      discardBody(response);
      throw new WltReadError(503);
    }
    const maxBytes = path === wltOperations.listCurrentCustomerWalletTransactions.path ? 8192 : 4096;
    admitResponse(response, maxBytes);
    const value = await readJSON(response, maxBytes, stopped, controller.signal);
    if (controller.signal.aborted) throw new WltReadError(503);
    return value;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
  }
}
