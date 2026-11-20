/** Shared authenticated DSH owner transport; domain clients validate changes before calling. */
import { DshPublicError, endpoint } from "./client-core.ts";

export async function privateOwnerRequest(
  baseUrl: string, path: string, bearer: string, method: "GET" | "PATCH", change?: unknown, signal?: AbortSignal,
): Promise<unknown> {
  // Only fixed owner-authored paths assembled by the public functions below
  // reach this uncached transport. A user cannot supply an arbitrary URL.
  if (!bearer || bearer.trim() !== bearer || /\s/.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
  const url = endpoint(baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method, signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: {
        Authorization: "Bearer " + bearer,
        Accept: "application/json",
        ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "PATCH" ? { body: JSON.stringify(change) } : {}),
    });
  } catch (error) {
    // A PATCH may have committed before the transport failed. Never report
    // an ordinary read outage or imply that retrying with a NEW key is safe.
    if (method === "PATCH") throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
    if (signal?.aborted) throw error;
    throw new DshPublicError(0, "OWNER_NETWORK_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "STORE_OPERATION_FAILED";
    try {
      const err: unknown = await response.json();
      if (err && typeof err === "object") {
        if ("code" in err && typeof err.code === "string") code = err.code;
        else if ("error" in err && typeof err.error === "string") code = err.error;
      }
    } catch { /* fail closed with a stable generic error */ }
    // A server-side failure after a PATCH does not prove that the Store
    // transaction was rolled back. Reconcile using the original operationId.
    throw new DshPublicError(response.status,
      method === "PATCH" && response.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new DshPublicError(502, method === "PATCH" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > 32768) throw new Error("oversized");
    body = JSON.parse(text) as unknown;
  } catch {
    throw new DshPublicError(502, method === "PATCH" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  return body;
}
