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

async function discardUnread(reply: Response): Promise<void> {
  try {
    const body = reply.body;
    if (body && !body.locked && !reply.bodyUsed) await body.cancel();
  } catch {
    // Cleanup failure must not replace the request outcome.
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
  const current = () => {
    if (signal.aborted) throw new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  };

  current();
  let reply: Response;
  try {
    reply = await fetch("/api/admission?" + query.toString(), {
      method, signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "X-Merchant-Context": actorId, ...(change === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(change === undefined ? {} : { body: JSON.stringify(change) }),
    });
  } catch {
    current();
    throw new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  }

  try {
    current();
    const noStore = reply.headers.get("Cache-Control")?.toLowerCase().split(",")
      .some(value => value.trim() === "no-store");
    if (!noStore || (reply.ok && !acceptedStatuses.includes(reply.status))) {
      throw reply.ok ? invalid() : unknown(reply.status);
    }

    const document = asDocument(await readMerchantJSON(
      reply, signal, reply.ok ? byteLimit : Math.min(byteLimit, 4096), 5000,
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
    void discardUnread(reply);
  }
}
