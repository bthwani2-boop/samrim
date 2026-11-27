import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { fundingIdValid } from "./validation.ts";

const readBudgetMs = 12_000;

function admitRequest(origin: string, method: "GET", path: string, cursor?: string) {
  const isolated = /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!isolated || Number(isolated[1]) > 65535 || method !== "GET") throw new WltReadError(503);
  // Only the five protected GET operations can carry a bearer. Construct exact
  // owner paths from the generated templates; do not admit URL aliases.
  const history = path === wltOperations.listCurrentCustomerWalletTransactions.path;
  const segments = path.split("/");
  const checkout = segments.at(-1);
  const store = segments.at(-2);
  const allocation = fundingIdValid(checkout) &&
    path === wltOperations.getCurrentCustomerOrderPaymentAllocation.path.replace("{checkoutID}", checkout);
  const agreement = typeof store === "string" && /^[a-z0-9-]{1,64}$/.test(store) &&
    (path === wltOperations.getOperatorCommercialAgreementReview.path.replace("{storeID}", store) ||
     path === wltOperations.getOwnedMerchantCommercialAgreementReview.path.replace("{storeID}", store));
  if (!history && path !== wltOperations.getCurrentCustomerWalletBalance.path && !allocation && !agreement) {
    throw new WltReadError(503);
  }
  const url = new URL(path, origin);
  if (cursor !== undefined) {
    if (!history || typeof cursor !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(cursor)) {
      throw new WltReadError(400);
    }
    url.searchParams.set("cursor", cursor);
  }
  return { url, maxBytes: history ? 8192 : 4096 };
}
async function discardStream(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // Cleanup failures cannot replace a previously established owner denial.
  }
}

function discardBody(response: Response): void {
  void discardStream(() => {
    const body = response.body;
    return body && !body.locked ? body : null;
  });
}

function admitResponse(response: Response, maxBytes: number): void {
  if (response.status !== 200 ||
    response.headers.get("Cache-Control")?.toLowerCase() !== "no-store" ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new WltReadError([400, 401, 403].includes(response.status) ? response.status : 503);
  }
  const declaredSize = response.headers.get("Content-Length");
  if (declaredSize !== null && (!/^[0-9]+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) {
    throw new WltReadError(502);
  }
}

async function readJSON(response: Response, maxBytes: number,
  stopped: Promise<never>): Promise<unknown> {
  const body = response.body;
  // Preserve the admitted text-only Native contract. It bounds decoded size,
  // not the bridge's pre-buffer allocation; native runtime proof is separate.
  if (!body?.getReader || typeof TextDecoder !== "function") {
    const text = await Promise.race([response.text(), stopped]);
    let size = 0;
    for (const rune of text) {
      const point = rune.codePointAt(0) ?? 0xfffd;
      size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      if (size > maxBytes) throw new WltReadError(502);
    }
    return JSON.parse(text) as unknown;
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
  } finally {
    if (!complete) void discardStream(() => reader);
    reader.releaseLock();
  }
}

export async function readOwner(origin: string, bearer: string, method: "GET", path: string,
  signal: AbortSignal, cursor?: string): Promise<unknown> {
  const { url, maxBytes } = admitRequest(origin, method, path, cursor);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(bearer)) throw new WltReadError(401);
  if (signal.aborted) throw new WltReadError(503);

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
    try {
      if (controller.signal.aborted) throw new WltReadError(503);
      admitResponse(response, maxBytes);
    } catch (error) {
      discardBody(response);
      throw error instanceof WltReadError ? error : new WltReadError(502);
    }
    try {
      const value = await readJSON(response, maxBytes, stopped);
      if (controller.signal.aborted) throw new WltReadError(503);
      return value;
    } catch {
      // The stream path has already released its reader; only the text/native
      // acquisition path may still have a body to discard.
      discardBody(response);
      throw new WltReadError(controller.signal.aborted ? 503 : 502);
    }
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
  }
}
