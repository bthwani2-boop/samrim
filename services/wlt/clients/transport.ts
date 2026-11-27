import { WltReadError } from "./errors.ts";
import { wltOperations } from "./generated/wlt-operations.ts";
import { fundingIdValid } from "./validation.ts";

const readBudgetMs = 12_000;
type Frame = { limit: number; declared: number | null };

function admitRequest(origin: string, method: "GET", path: string, cursor?: string) {
  const address = /^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if (!address || Number(address[1]) > 65535 || method !== "GET") throw new WltReadError(503);

  const history = path === wltOperations.listCurrentCustomerWalletTransactions.path;
  const parts = path.split("/");
  const checkout = parts.at(-1);
  const store = parts.at(-2);
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

// Cleanup must not replace the admitted error or delay cancellation.
async function cancelStream(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // A noncooperative transport is already rejected.
  }
}

function discardResponse(response: Response): void {
  void cancelStream(() => {
    const body = response.body;
    return body && !body.locked ? body : null;
  });
}

function admitFrame(response: Response, limit: number, statuses: readonly number[]): Frame {
  const status = response.status;
  if (!statuses.includes(status) ||
    response.headers.get("Cache-Control")?.toLowerCase() !== "no-store" ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new WltReadError([400, 401, 403].includes(status) ? status : 503);
  }
  const headers = response.headers;
  const length = headers.get("Content-Length");
  const transfer = headers.get("Transfer-Encoding");
  const encoding = headers.get("Content-Encoding");
  if ((encoding !== null && encoding.toLowerCase() !== "identity") ||
    (transfer !== null && (length !== null || transfer.toLowerCase() !== "chunked"))) {
    throw new WltReadError(502);
  }
  const declared = length === null ? null : Number(length);
  if (length !== null && (!/^[0-9]+$/.test(length) || declared === null ||
    !Number.isSafeInteger(declared) || declared <= 0 || declared > limit)) {
    throw new WltReadError(502);
  }
  return { limit, declared };
}

function checkSize(size: number, frame: Frame): void {
  if (size > frame.limit || (frame.declared !== null && size !== frame.declared)) {
    throw new WltReadError(502);
  }
}

// Validate complete JSON syntax with the native parser. Before returning any
// parsed value, inspect the same bounded document's structural tokens: native
// JSON.parse alone collapses duplicate keys, including escaped key spellings.
// A stack scopes names to each object; it never recurses on untrusted depth.
function admitDocument(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WltReadError(502);
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g;
  for (const token of text.matchAll(tokens)) {
    const lexeme = token[0];
    if (lexeme === "{") {
      stack.push(new Set<string>());
    } else if (lexeme === "[") {
      stack.push(null);
    } else if (lexeme === "}" || lexeme === "]") {
      stack.pop();
    } else {
      // Native syntax validation proves that a string followed by a colon is
      // a member name. Decode it with the same parser, not a second unescaper.
      let after = token.index + lexeme.length;
      while (after < text.length && /[ \t\r\n]/.test(text.charAt(after))) after++;
      if (text.charAt(after) !== ":") continue;
      const names = stack.at(-1);
      if (!names) throw new WltReadError(502);
      const name: string = JSON.parse(lexeme);
      if (names.has(name)) throw new WltReadError(502);
      names.add(name);
    }
  }
  return parsed;
}

async function collectText(response: Response, frame: Frame, stopped: Promise<never>): Promise<string> {
  // The existing Native bridge may buffer before returning text. Verify the
  // decoded UTF-8 representation; do not claim pre-allocation byte admission.
  const text = await Promise.race([response.text(), stopped]);
  if (typeof text !== "string") throw new WltReadError(502);
  let size = 0;
  const ceiling = frame.declared ?? frame.limit;
  for (const rune of text) {
    const cp = rune.codePointAt(0);
    if (cp === undefined || (cp >= 0xd800 && cp <= 0xdfff)) throw new WltReadError(502);
    size += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (size > ceiling) throw new WltReadError(502);
  }
  checkSize(size, frame);
  return text;
}

async function collectStream(reader: ReadableStreamDefaultReader<Uint8Array>, frame: Frame,
  stopped: Promise<never>): Promise<string> {
  let complete = false;
  try {
    const text = await Promise.race([(async () => {
      const bytes = new Uint8Array(frame.declared ?? frame.limit);
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > bytes.length - size) {
          throw new WltReadError(502);
        }
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      checkSize(size, frame);
      // Preserve a wire BOM so native JSON syntax validation rejects it, as
      // it does for the text bridge. Do not silently normalize either input.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
    })(), stopped]);
    complete = true;
    return text;
  } finally {
    if (!complete) void cancelStream(() => reader);
    reader.releaseLock();
  }
}

// Before a reader is acquired the response owns cleanup. Once acquired,
// only that reader owns collection, cancellation and release. Both paths
// converge on the same complete document admission before financial parsing.
async function consumeResponse(response: Response, limit: number, signal: AbortSignal,
  stopped: Promise<never>, statuses: readonly number[]): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) throw new WltReadError(503);
    const frame = admitFrame(response, limit, statuses);
    const body = response.body;
    let text: string;
    if (body?.getReader && typeof TextDecoder === "function") {
      reader = body.getReader();
      text = await collectStream(reader, frame, stopped);
    } else {
      text = await collectText(response, frame, stopped);
    }
    if (signal.aborted) throw new WltReadError(503);
    return admitDocument(text);
  } catch (error) {
    if (!reader) discardResponse(response);
    if (signal.aborted) throw new WltReadError(503);
    throw error instanceof WltReadError ? error : new WltReadError(502);
  }
}

export async function readOwner(origin: string, bearer: string, method: "GET", path: string,
  signal: AbortSignal, cursor?: string): Promise<unknown> {
  const { url, maxBytes } = admitRequest(origin, method, path, cursor);
  return (await exchangeOwner(url, bearer, method, signal, maxBytes, [200])).value;
}

// Only generated disposable integration commands are admitted here. The
// serving reader remains GET-only; no command is retried by the transport.
export async function requestIsolatedAgreementCommand(origin: string, bearer: string, path: string,
  body: string, signal: AbortSignal): Promise<{ status: number; value: unknown }> {
  const address = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
  const store = path.split("/")[4];
  if (!address || Number(address[1]) > 65535 || !store || !/^[a-z0-9-]{1,64}$/.test(store) ||
      (path !== wltOperations.recordIsolatedMerchantAgreementDecision.path.replace("{storeID}", store) &&
       path !== wltOperations.recordIsolatedFinanceAgreementDecision.path.replace("{storeID}", store) &&
       path !== wltOperations.recordIsolatedFinanceAgreementProposal.path.replace("{storeID}", store))) {
    throw new WltReadError(503);
  }
  return exchangeOwner(new URL(path, origin), bearer, "POST", signal, 4096, [200, 400, 401, 403, 409], body);
}

async function exchangeOwner(url: URL, bearer: string, method: "GET" | "POST", signal: AbortSignal,
  maxBytes: number, statuses: readonly number[], body?: string): Promise<{ status: number; value: unknown }> {
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
          headers: { Accept: "application/json", Authorization: "Bearer " + bearer,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body }),
        });
        if (controller.signal.aborted) {
          discardResponse(reply);
          throw new WltReadError(503);
        }
        return reply;
      }), stopped]);
    } catch {
      throw new WltReadError(503);
    }
    const value = await consumeResponse(response, maxBytes, controller.signal, stopped, statuses);
    if (controller.signal.aborted) throw new WltReadError(503);
    return { status: response.status, value };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
  }
}
