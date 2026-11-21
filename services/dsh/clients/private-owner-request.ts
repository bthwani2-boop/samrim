/** Shared authenticated DSH owner transport; domain clients validate changes before calling. */
import { DshPublicError, endpoint, readBoundedOwnerJSON } from "./client-core.ts";

const maxOwnerTextLength = 32 * 1024;

export async function privateOwnerRequest(
  baseUrl: string, path: string, bearer: string, method: "GET" | "PATCH" | "POST", change?: unknown, signal?: AbortSignal,
): Promise<unknown> {
  // Only fixed owner-authored paths assembled by the public functions below
  // reach this uncached transport. A user cannot supply an arbitrary URL.
  if (!bearer || bearer.trim() !== bearer || /\s/.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
  const mutating = method !== "GET";
  const stale = () => {
    if (signal?.aborted) throw new DshPublicError(0,
      mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  };
  const url = endpoint(baseUrl, path);
  stale(); // Do not dispatch a request already abandoned by an account/Store switch.
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method, signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
        ...(mutating ? { "Content-Type": "application/json" } : {}),
      },
      ...(mutating ? { body: JSON.stringify(change) } : {}),
    });
  } catch {
    // A write may have committed before the transport failed. Never report
    // an ordinary read outage or imply that retrying with a NEW key is safe.
    if (mutating) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
    throw new DshPublicError(0, signal?.aborted ? "OWNER_RESPONSE_STALE" : "OWNER_NETWORK_UNAVAILABLE");
  }
  stale();
  if (!response.ok) {
    let code = "STORE_OPERATION_FAILED";
    try {
      const err = await readBoundedOwnerJSON(response, maxOwnerTextLength);
      if (err && typeof err === "object") {
        if ("code" in err && typeof err.code === "string") code = err.code;
        else if ("error" in err && typeof err.error === "string") code = err.error;
      }
    } catch { /* fail closed with a stable generic error */ }
    stale();
    // A server-side failure after a write does not prove that the owner
    // transaction was rolled back. Reconcile using the original operationId.
    throw new DshPublicError(response.status,
      mutating && response.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  const directives = response.headers.get("Cache-Control")
    ?.toLowerCase().split(",").map(value => value.trim()) ?? [];
  if (response.status !== 200 ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    !directives.includes("no-store")) {
    void response.body?.cancel().catch(() => {});
    throw new DshPublicError(502, mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    body = await readBoundedOwnerJSON(response, maxOwnerTextLength);
  } catch {
    stale();
    throw new DshPublicError(502, mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  // A body can arrive after an aborted signal even if fetch previously resolved.
  // Never expose a stale GET or accept a PATCH as confirmed for a new context.
  stale();
  return body;
}
