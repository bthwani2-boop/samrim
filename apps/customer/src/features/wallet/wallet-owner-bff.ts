import { WltReadError } from "@bthwani/wlt";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

// A presentation adapter only. WLT verifies the current Identity actor and owns SQL.
export async function handleWalletOwnerRead<T>(
  request: Request,
  read: (origin: string, bearer: string, signal: AbortSignal, cursor?: string) => Promise<T>,
  allowCursor = false,
): Promise<Response> {
  const url = new URL(request.url);
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN;
  if (process.env.BTHWANI_SURFACE_PREVIEW !== "1" || !origin ||
    !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return Response.json({ error: "OWNER_UNAVAILABLE" }, { status: 503, headers });
  }
  const cursors = url.searchParams.getAll("cursor");
  if (request.body || (!allowCursor && url.search) ||
    (allowCursor && url.search && (url.searchParams.size !== 1 ||
      cursors.length !== 1 || typeof cursors[0] !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(cursors[0])))) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  }
  if (site && site !== "same-origin") {
    return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
  }
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const value = await read(origin, bearer, signal, allowCursor ? cursors[0] : undefined);
    return Response.json(value, { headers });
  } catch (error) {
    const status = error instanceof WltReadError && [401, 403].includes(error.status) ? error.status : 503;
    const code = status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "OWNER_UNAVAILABLE";
    return Response.json({ error: code }, { status, headers });
  }
}
