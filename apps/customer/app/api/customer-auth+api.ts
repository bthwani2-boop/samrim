import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";

/** Customer's test-only, same-origin BFF. Only Identity issues and revokes sessions. */
const cookieName = "bthwani_customer_auth";
const noStore = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function configuredOwner(request: Request) {
  const host = new URL(request.url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  return process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN ?? null;
}

function json(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers(noStore);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}

function cookieFor(request: Request, bearer: string, seconds: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${bearer}; Path=/api/customer-auth; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}

function bearerFor(request: Request) {
  return request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? null;
}

function isSameOrigin(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function ownerFailure(error: unknown) {
  if (error instanceof IdentityClientError && error.status >= 400 && error.status < 500) {
    return json({ code: error.code }, error.status);
  }
  return json({ code: "OWNER_UNAVAILABLE" }, 503);
}

async function boundedRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(256);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > bytes.length) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, size);
      size += value.length;
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function revokeFailedProof(origin: string, bearer: string) {
  await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(2000)).catch(() => undefined);
}

export async function GET(request: Request) {
  const origin = configuredOwner(request);
  if (!origin) return json({ enabled: false, session: null });
  if (new URL(request.url).search) return json({ code: "INVALID_REQUEST" }, 400);
  const bearer = bearerFor(request);
  if (!bearer) return json({ enabled: true, session: null });
  try {
    const session = await readVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    if (session.role !== "customer") return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
    return json({ enabled: true, session });
  } catch (error) {
    if (error instanceof IdentityClientError && error.status === 401) {
      return json({ enabled: true, session: null }, 200, cookieFor(request, "", 0));
    }
    if (error instanceof IdentityClientError && error.status === 403) {
      return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
    }
    return ownerFailure(error);
  }
}

export async function POST(request: Request) {
  const origin = configuredOwner(request);
  if (!origin) return json({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isSameOrigin(request)) return json({ code: "FORBIDDEN" }, 403);
  const body = await boundedRequestBody(request);
  if (!body) return json({ code: "INVALID_REQUEST" }, 400);
  try {
    const signal = AbortSignal.timeout(15000);
    if (Object.keys(body).length === 1 && typeof body.phone === "string") {
      const ticket = await issueCustomerPhoneChallenge(origin, body.phone, signal);
      return json({ ticket }, 201);
    }
    if (Object.keys(body).length !== 2 || typeof body.ticket !== "string" || typeof body.code !== "string") {
      return json({ code: "INVALID_REQUEST" }, 400);
    }
    const existing = bearerFor(request);
    if (existing) {
      try {
        const active = await readVerifiedIdentitySession(origin, existing, signal);
        if (active.role !== "customer") return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
        return json({ code: "SIGN_OUT_REQUIRED" }, 409);
      } catch (error) {
        if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
      }
    }
    const issued = await verifyCustomerPhoneChallenge(origin, body.ticket, body.code, signal);
    let verified: VerifiedIdentitySession;
    try {
      verified = await readVerifiedIdentitySession(origin, issued.accessToken, signal);
      if (verified.role !== "customer" || signal.aborted) {
        throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
      }
    } catch (error) {
      await revokeFailedProof(origin, issued.accessToken);
      throw error;
    }
    const remaining = Math.max(0, Math.floor((Date.parse(verified.sessionExpiresAt) - Date.now()) / 1000));
    return json({ session: verified }, 200, cookieFor(request, issued.accessToken, remaining));
  } catch (error) {
    return ownerFailure(error);
  }
}

export async function DELETE(request: Request) {
  const origin = configuredOwner(request);
  if (!origin) return json({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isSameOrigin(request)) return json({ code: "FORBIDDEN" }, 403);
  const bearer = bearerFor(request);
  if (bearer) {
    try {
      const verified = await readVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
      if (verified.role !== "customer") return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
      await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    } catch (error) {
      if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
        return ownerFailure(error);
      }
    }
  }
  return new Response(null, {
    status: 204,
    headers: { ...noStore, "Set-Cookie": cookieFor(request, "", 0) },
  });
}
