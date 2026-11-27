/** Shared authenticated DSH transport for fixed owner-authored routes. */
import { consumeOwnerResponse, DshPublicError, endpoint, fetchOwnerHeaders, readBoundedOwnerJSON } from "./client-core.ts";

const defaultTextLimit = 32 * 1024;
type OwnerMethod = "GET" | "PATCH" | "POST" | "PUT";

function privateJSON(response: Response): boolean {
  const cache = response.headers.get("Cache-Control")
    ?.toLowerCase().split(",").map(value => value.trim()) ?? [];
  return cache.includes("no-store")
    && response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

async function readFailure(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    const failure = await readBoundedOwnerJSON(response, defaultTextLimit, undefined, signal);
    if (failure && typeof failure === "object") {
      if ("code" in failure && typeof failure.code === "string") return failure.code;
      if ("error" in failure && typeof failure.error === "string") return failure.error;
    }
  } catch {
    // Unavailable or malformed failure detail must not become a success.
  }
  return "STORE_OPERATION_FAILED";
}

export async function privateOwnerRequest(
  baseUrl: string, path: string, bearer: string, method: OwnerMethod,
  change?: unknown, signal?: AbortSignal, acceptedStatuses: readonly number[] = [200],
  responseByteLimit?: number,
): Promise<unknown> {
  if (typeof bearer !== "string" || !bearer || bearer.trim() !== bearer || /\s/.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }
  const mutating = method !== "GET";
  const stale = () => {
    if (signal?.aborted) {
      throw new DshPublicError(0, mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
    }
  };
  const invalid = () => new DshPublicError(502, mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  const url = endpoint(baseUrl, path);
  stale();

  let response: Response;
  try {
    response = await fetchOwnerHeaders(url.toString(), {
      method, signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: {
        Authorization: "Bearer " + bearer, Accept: "application/json",
        ...(mutating ? { "Content-Type": "application/json" } : {}),
      },
      ...(mutating ? { body: JSON.stringify(change) } : {}),
    });
  } catch {
    stale();
    throw new DshPublicError(0, mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  }

  return consumeOwnerResponse(response, async () => {
    stale();
    if (!response.ok) {
      const code = await readFailure(response, signal);
      stale();
      throw new DshPublicError(response.status,
        mutating && response.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
    }
    if (!acceptedStatuses.includes(response.status) || !privateJSON(response)) throw invalid();

    let result: unknown;
    try {
      // A larger owner projection must supply its contract-derived byte budget.
      // All existing callers retain the original default text/byte bounds.
      result = await readBoundedOwnerJSON(response, responseByteLimit ?? defaultTextLimit, responseByteLimit, signal);
    } catch {
      stale();
      throw invalid();
    }
    stale();
    return result;
  });
}
