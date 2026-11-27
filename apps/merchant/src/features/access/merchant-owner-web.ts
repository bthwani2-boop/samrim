import { DshPublicError } from "@bthwani/dsh";
import { readMerchantJSON } from "./merchant-json.ts";

type OwnerMethod = "GET" | "POST" | "PUT" | "PATCH";
type OwnerRequest = Readonly<{
  query: URLSearchParams;
  actorId: string;
  method: OwnerMethod;
  signal: AbortSignal;
  change?: unknown;
  acceptedStatuses?: readonly number[];
  byteLimit?: number;
}>;

// The BFF allows up to 15 seconds for owner commands. The browser's
// complete request budget includes a bounded five-second body admission.
const requestDeadlineMs = 20000;
const bodyDeadlineMs = 5000;

function discardUnread(reply: Response): void {
  try {
    const body = reply.body;
    if (body && !body.locked && !reply.bodyUsed) void body.cancel().catch(() => {});
  } catch {
    // Disposal cannot delay or replace the operation outcome.
  }
}

function asDocument(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function requestMerchantOwnerDocument({
  query, actorId, method, signal, change, acceptedStatuses = [200], byteLimit = 64 * 1024,
}: OwnerRequest): Promise<{ status: number; document: Record<string, unknown> }> {
  const writing = method !== "GET";
  const invalid = () => new DshPublicError(502, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  const unknown = (status: number) => new DshPublicError(status, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE");
  const network = () => new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  const stale = () => new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  if (signal.aborted) throw stale();

  const budget = new AbortController();
  const lifetime = AbortSignal.any([signal, budget.signal]);
  const timer = setTimeout(() => budget.abort(), requestDeadlineMs);
  let reply: Response | null = null;
  let stop!: () => void;
  const interrupted = new Promise<null>(resolve => { stop = () => resolve(null); });
  lifetime.addEventListener("abort", stop, { once: true });
  const current = () => {
    if (signal.aborted) throw stale();
    if (budget.signal.aborted) throw network();
  };

  try {
    current();
    try {
      // Race header acquisition as well as body consumption: an adapter
      // that disregards AbortSignal must not retain an active UI operation.
      const pending = fetch("/api/admission?" + query.toString(), {
        method, signal: lifetime, credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "X-Merchant-Context": actorId, ...(change === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(change === undefined ? {} : { body: JSON.stringify(change) }),
      }).then(response => {
        if (lifetime.aborted) {
          discardUnread(response);
          return null;
        }
        return response;
      });
      reply = await Promise.race([pending, interrupted]);
    } catch {
      current();
      throw network();
    }
    current();
    if (!reply) throw network();

    const noStore = reply.headers.get("Cache-Control")?.toLowerCase().split(",")
      .some(value => value.trim() === "no-store");
    if (!noStore || (reply.ok && !acceptedStatuses.includes(reply.status))) {
      throw reply.ok ? invalid() : unknown(reply.status);
    }
    const document = asDocument(await readMerchantJSON(
      reply, lifetime, reply.ok ? byteLimit : Math.min(byteLimit, 4096), bodyDeadlineMs,
    ));
    current();
    if (!reply.ok) {
      const code = document && Object.keys(document).length === 1 &&
        Object.hasOwn(document, "code") && typeof document.code === "string" && document.code
        ? document.code : null;
      if (!code || (writing && reply.status >= 500)) throw unknown(reply.status);
      throw new DshPublicError(reply.status, code);
    }
    if (!document) throw invalid();
    return { status: reply.status, document };
  } finally {
    clearTimeout(timer);
    lifetime.removeEventListener("abort", stop);
    if (reply) discardUnread(reply);
  }
}
