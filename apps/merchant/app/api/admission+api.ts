import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokeVerifiedIdentitySession,
} from "@bthwani/identity";
import { verifyMerchantAdmission } from "../../src/features/access/admission";

const cookieName = "bthwani_merchant_admission";
const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function configuredOrigin(request: Request) {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return undefined;
  return process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
}

function response(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers(noStoreHeaders);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}

function sessionCookie(request: Request, bearer: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${bearer}; Path=/api/admission; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function bearerFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map(entry => entry.trim())
    .find(entry => entry.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
}

function isLocalMutation(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function ownerError(error: unknown) {
  if (error instanceof IdentityClientError && error.status >= 400 && error.status < 500) {
    return response({ code: error.code }, error.status);
  }
  return response({ code: "OWNER_UNAVAILABLE" }, 503);
}

export async function GET(request: Request) {
  const origin = configuredOrigin(request);
  if (!origin) return response({ enabled: false, session: null });
  const bearer = bearerFrom(request);
  if (!bearer) return response({ enabled: true, session: null });
  try {
    const session = await readVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    if (session.role === "merchant") return response({ enabled: true, session });
  } catch (error) {
    if (!(error instanceof IdentityClientError && error.status === 401)) return ownerError(error);
  }
  return response({ enabled: true, session: null }, 200, sessionCookie(request, "", 0));
}

export async function POST(request: Request) {
  const origin = configuredOrigin(request);
  if (!origin) return response({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isLocalMutation(request)) return response({ code: "FORBIDDEN" }, 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const reader = request.body?.getReader();
  const bytes = new Uint8Array(512);
  let length = 0;
  let input: unknown;
  try {
    if (!reader) return response({ code: "INVALID_REQUEST" }, 400);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length + length > bytes.length) {
        await reader.cancel();
        return response({ code: "INVALID_REQUEST" }, 400);
      }
      bytes.set(value, length);
      length += value.length;
    }
    input = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
  } catch {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return response({ code: "INVALID_REQUEST" }, 400);
  }
  const data = input as Record<string, unknown>;
  try {
    const signal = AbortSignal.timeout(15000);
    if (Object.keys(data).length === 1 && typeof data.phone === "string") {
      const ticket = await issueCustomerPhoneChallenge(origin, data.phone, signal);
      return response({ ticket }, 201);
    }
    if (Object.keys(data).length === 2 && typeof data.ticket === "string" && typeof data.code === "string") {
      const currentBearer = bearerFrom(request);
      if (currentBearer) {
        try {
          await readVerifiedIdentitySession(origin, currentBearer, signal);
          return response({ code: "SIGN_OUT_REQUIRED" }, 409);
        } catch (error) {
          if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
        }
      }
      const { bearer, session } = await verifyMerchantAdmission(origin, data.ticket, data.code, signal);
      const remaining = Math.max(0, Math.floor((Date.parse(session.sessionExpiresAt) - Date.now()) / 1000));
      return response({ session }, 200, sessionCookie(request, bearer, remaining));
    }
    return response({ code: "INVALID_REQUEST" }, 400);
  } catch (error) {
    return ownerError(error);
  }
}

export async function DELETE(request: Request) {
  const origin = configuredOrigin(request);
  if (!origin) return response({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isLocalMutation(request)) return response({ code: "FORBIDDEN" }, 403);
  const bearer = bearerFrom(request);
  if (bearer) {
    try {
      await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    } catch (error) {
      if (!(error instanceof IdentityClientError && error.status === 401)) return ownerError(error);
    }
  }
  return new Response(null, {
    status: 204,
    headers: { ...noStoreHeaders, "Set-Cookie": sessionCookie(request, "", 0) },
  });
}
