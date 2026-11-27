import { DshPublicError, listCurrentCustomerCarts } from "@bthwani/dsh";
import { withCustomerOwnerSession } from "../access/customer-owner-session.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "./cart-owner-origins.ts";

const deadlineMs = 10_000;
type DirectoryRequest = { bearer: string; actor: string; after: string | undefined };

function result(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function deny(status: number, error: string): Response {
  return result({ error }, status);
}

function admitRequest(request: Request, url: URL): DirectoryRequest | Response {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if ((site !== null && site !== "same-origin") ||
      (origin !== null && origin !== url.origin)) {
    return deny(403, "FORBIDDEN");
  }
  const after = url.searchParams.get("after");
  const length = request.headers.get("Content-Length");
  if (request.method !== "GET" || request.body ||
      request.headers.has("Transfer-Encoding") ||
      (length !== null && length !== "0") ||
      url.href.endsWith("?") ||
      url.searchParams.size !== (after === null ? 0 : 1) ||
      (after !== null && !/^[a-z0-9-]{1,64}$/.test(after))) {
    return deny(400, "INVALID_REQUEST");
  }
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return deny(401, "UNAUTHORIZED");
  const actor = request.headers.get("X-Customer-Context");
  if (!actor) return deny(400, "INVALID_REQUEST");
  return { bearer, actor, after: after ?? undefined };
}

export async function handleCustomerCartDirectory(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return deny(503, "OWNER_UNAVAILABLE");
  const admission = admitRequest(request, url);
  if (admission instanceof Response) return admission;
  const { bearer, actor, after } = admission;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)]);
  const outcome = await withCustomerOwnerSession(owners.identity, bearer, actor, signal,
    verified => listCurrentCustomerCarts(owners.dsh, bearer, verified, after, signal));
  if (outcome.kind === "accepted") {
    return outcome.value.actorId === actor ? result(outcome.value) : deny(401, "UNAUTHORIZED");
  }
  if (outcome.kind === "denied") {
    const code = outcome.status === 503 ? "OWNER_UNAVAILABLE"
      : outcome.stage === "after" ? "UNAUTHORIZED"
        : outcome.reason === "identity" ? "DIRECTORY_REQUEST_REJECTED"
          : outcome.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED";
    return deny(outcome.status, code);
  }
  if (outcome.error instanceof DshPublicError && [400, 401, 403].includes(outcome.error.status)) {
    return deny(outcome.error.status, "DIRECTORY_REQUEST_REJECTED");
  }
  return deny(503, "OWNER_UNAVAILABLE");
}
