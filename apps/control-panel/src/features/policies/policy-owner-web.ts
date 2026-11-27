import { isStoreRegistrationPolicyActor } from "@bthwani/dsh";

type PolicyMethod = "GET" | "PATCH" | "POST";
type PolicyReply =
  | { status: 200; document: unknown }
  | { status: 400 | 401 | 403 | 409; document: null };

const maxReplyBytes = 65_536;
const deadlineMs = 10_000;
const route = /^\/api\/policies\/cities\/[a-z0-9-]{1,64}(?:\/store-registration\/(?:DIRECT|MARKETPLACE))?(?:\?delivery=1|\?history=1&limit=10(?:&beforeVersion=[1-9][0-9]{0,18})?)?$/u;

function invalid(): Error { return new Error("DSH policy owner response invalid"); }

export function policyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function discard(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try { await acquire()?.cancel(); } catch { /* Cleanup must not change the outcome. */ }
}

function discardResponse(reply: Response): void {
  void discard(() => {
    const body = reply.body;
    return body && !body.locked && !reply.bodyUsed ? body : null;
  });
}

function admitsJSON(reply: Response, limit: number): boolean {
  const length = reply.headers.get("Content-Length");
  return reply.headers.get("Cache-Control")?.split(",")
    .some(value => value.trim().toLowerCase() === "no-store") === true
    && reply.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() === "application/json"
    && (length === null || (/^\d+$/.test(length) && Number(length) <= limit));
}

function definitiveStatus(status: number, document: unknown): status is 400 | 401 | 403 | 409 {
  if (!policyRecord(document) || Object.keys(document).length !== 1 || !Object.hasOwn(document, "code")) return false;
  return (status === 400 && document.code === "INVALID_REQUEST")
    || (status === 401 && document.code === "UNAUTHORIZED")
    || (status === 403 && document.code === "FORBIDDEN")
    || (status === 409 && document.code === "VERSION_CONFLICT");
}

/** Same-origin Operator BFF, one bounded private response lifetime for every policy. */
export async function requestPolicyOwner(
  endpoint: string, actorId: string, method: PolicyMethod = "GET",
  change?: unknown, signal?: AbortSignal,
): Promise<PolicyReply> {
  if (typeof endpoint !== "string" || !route.test(endpoint) || /\s/u.test(endpoint) || !isStoreRegistrationPolicyActor(actorId)) {
    throw new Error("Invalid policy scope");
  }
  const deadline = new AbortController();
  const lifetime = signal ? AbortSignal.any([deadline.signal, signal]) : deadline.signal;
  if (lifetime.aborted) throw invalid();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  let rejectStopped: (reason: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const onAbort = () => rejectStopped(invalid());
  lifetime.addEventListener("abort", onAbort, { once: true });
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  const current = () => { if (lifetime.aborted) throw invalid(); };

  async function exchange(): Promise<PolicyReply> {
    current();
    const reply = await fetch(endpoint, {
      method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: lifetime,
      headers: {
        "X-BThwani-Operator": encodeURIComponent(actorId),
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(change) }),
    });
    if (lifetime.aborted) { discardResponse(reply); throw invalid(); }
    response = reply;
    const success = reply.status === 200;
    if (!success && ![400, 401, 403, 409].includes(reply.status)) throw invalid();
    const limit = success ? maxReplyBytes : 4096;
    if (!admitsJSON(reply, limit) || !reply.body || reply.body.locked) throw invalid();
    const acquired = reply.body.getReader();
    reader = acquired;
    const buffer = new Uint8Array(limit);
    let size = 0;
    for (;;) {
      const { done, value } = await acquired.read();
      current();
      if (done) break;
      if (value.byteLength > limit - size) throw invalid();
      buffer.set(value, size);
      size += value.byteLength;
    }
    const document: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
    current();
    complete = true;
    if (success) return { status: 200, document };
    if (!definitiveStatus(reply.status, document)) throw invalid();
    return { status: reply.status, document: null };
  }

  try {
    return await Promise.race([exchange(), stopped]);
  } catch {
    throw invalid();
  } finally {
    clearTimeout(timer);
    lifetime.removeEventListener("abort", onAbort);
    if (reader) {
      if (!complete) void discard(() => reader ?? null);
      reader.releaseLock();
    } else if (response) {
      discardResponse(response);
    }
  }
}
