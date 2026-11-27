import { DshPublicError, listCurrentCustomerCarts } from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "./cart-owner-origins.ts";

const deadlineMs = 10_000;
type Owners = NonNullable<ReturnType<typeof customerCartOwnerOrigins>>;
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

async function readDirectory(
  owners: Owners, admission: DirectoryRequest, signal: AbortSignal,
): Promise<Response> {
  const { bearer, actor, after } = admission;
  signal.throwIfAborted();
  const before = await readVerifiedIdentitySession(owners.identity, bearer, signal);
  signal.throwIfAborted();
  if (before.role !== "customer" || before.actorId !== actor) return deny(403, "FORBIDDEN");
  const initialExpiry = Date.parse(before.sessionExpiresAt);
  if (!(initialExpiry > Date.now())) return deny(401, "UNAUTHORIZED");

  const page = await listCurrentCustomerCarts(owners.dsh, bearer, actor, after, signal);
  signal.throwIfAborted();
  const current = await readVerifiedIdentitySession(owners.identity, bearer, signal);
  signal.throwIfAborted();
  const expiresAt = Math.min(initialExpiry, Date.parse(current.sessionExpiresAt));
  if (current.role !== "customer" || current.actorId !== actor ||
      page.actorId !== actor || !(expiresAt > Date.now())) {
    return deny(401, "UNAUTHORIZED");
  }
  return result(page);
}

export async function handleCustomerCartDirectory(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return deny(503, "OWNER_UNAVAILABLE");
  const admission = admitRequest(request, url);
  if (admission instanceof Response) return admission;

  try {
    // The two Identity proofs and DSH read share the same absolute budget.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)]);
    return await readDirectory(owners, admission, signal);
  } catch (error) {
    if ((error instanceof DshPublicError || error instanceof IdentityClientError) &&
        [400, 401, 403].includes(error.status)) {
      return deny(error.status, "DIRECTORY_REQUEST_REJECTED");
    }
    return deny(503, "OWNER_UNAVAILABLE");
  }
}
