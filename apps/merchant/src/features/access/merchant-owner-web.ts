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

/** App-local same-origin DSH projection; the owner SDK retains business validation. */
export async function requestMerchantOwnerDocument({
  query, actorId, method, signal, change, acceptedStatuses = [200], byteLimit = 64 * 1024,
}: OwnerRequest): Promise<{ status: number; document: Record<string, unknown> }> {
  const writing = method !== "GET";
  const invalid = () => new DshPublicError(502,
    writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  const current = () => {
    if (signal.aborted) throw new DshPublicError(0,
      writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  };
  current();
  let reply: Response;
  try {
    reply = await fetch(`/api/admission?${query}`, {
      method, signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "X-Merchant-Context": actorId, ...(change === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(change === undefined ? {} : { body: JSON.stringify(change) }),
    });
  } catch {
    current();
    throw new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  }
  // Every acquired response is either consumed by the bounded decoder or
  // discarded without waiting for the remote transport to finish cleanup.
  const noStore = reply.headers.get("Cache-Control")?.toLowerCase().split(",")
    .some(value => value.trim() === "no-store");
  if (reply.ok && (!acceptedStatuses.includes(reply.status) || !noStore)) {
    if (reply.body && !reply.body.locked) void reply.body.cancel().catch(() => {});
    current();
    throw invalid();
  }
  const payload = await readMerchantJSON(reply, signal, byteLimit, 5000);
  current();
  const document = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : null;
  if (!reply.ok) {
    const code = typeof document?.code === "string" && document.code ? document.code : null;
    if (writing && (reply.status >= 500 || !code)) {
      throw new DshPublicError(reply.status, "OPERATION_RESULT_UNKNOWN");
    }
    throw new DshPublicError(reply.status, code ?? "OWNER_UNAVAILABLE");
  }
  if (!document) throw invalid();
  return { status: reply.status, document };
}
