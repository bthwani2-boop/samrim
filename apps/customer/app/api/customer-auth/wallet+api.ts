import { readCurrentCustomerWallet, WltReadError } from "@bthwani/wlt";
import { bearerForCustomerRequest } from "../../../src/features/access/customer-session-cookie";

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN;
  if (process.env.BTHWANI_SURFACE_PREVIEW !== "1" || !origin ||
    !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return Response.json({ error: "OWNER_UNAVAILABLE" }, { status: 503, headers });
  }
  if (url.search || request.body) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  }
  if (site && site !== "same-origin") {
    return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
  }
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const balance = await readCurrentCustomerWallet(origin, bearer, signal);
    return Response.json(balance, { headers });
  } catch (error) {
    const status = error instanceof WltReadError && [401, 403].includes(error.status) ? error.status : 503;
    const code = status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "OWNER_UNAVAILABLE";
    return Response.json({ error: code }, { status, headers });
  }
}
