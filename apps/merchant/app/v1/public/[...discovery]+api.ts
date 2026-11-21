import { DshPublicError, listPublicOffers } from "@bthwani/dsh";

// Isolated development only: public Store Offers, never draft catalog, tokens,
// merchant grants or financial writes. The browser cannot reach the owner-only
// Docker port across the Surface/Lenovo SSH forward.
const localDSH = "http://127.0.0.1:3202";
const offersPath = /^\/v1\/public\/stores\/([a-z0-9-]{1,64})\/offers$/;
const publicErrors = new Set(["INVALID_SEARCH", "INVALID_CURSOR", "INVALID_LIMIT", "INVALID_REQUEST"]);

function respond(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(status === 405 ? { Allow: "GET" } : {}),
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    return respond({ error: "NOT_FOUND" }, 404);
  }
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if ((origin !== null && origin !== url.origin) ||
    (site !== null && site !== "none" && site !== "same-origin")) {
    return respond({ error: "FORBIDDEN" }, 403);
  }
  if (request.method !== "GET") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
  const match = offersPath.exec(url.pathname);
  if (!match) return respond({ error: "NOT_FOUND" }, 404);
  if (url.search.length > 4097 ||
    [...url.searchParams.keys()].some(key =>
      !["q", "limit", "cursor"].includes(key) || url.searchParams.getAll(key).length !== 1)) {
    return respond({ error: "INVALID_REQUEST" }, 400);
  }
  try {
    decodeURIComponent(url.search);
  } catch {
    return respond({ error: "INVALID_REQUEST" }, 400);
  }
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)) {
    return respond({ error: "INVALID_LIMIT" }, 400);
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) {
    return respond({ error: "INVALID_CURSOR" }, 400);
  }
  try {
    return respond(await listPublicOffers(
      process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN ?? localDSH,
      match[1] as string,
      {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
        ...(cursor === null ? {} : { cursor }),
        ...(url.searchParams.has("q") ? { query: url.searchParams.get("q") as string } : {}),
      },
    ));
  } catch (error) {
    if (error instanceof DshPublicError) {
      if (error.status === 400 && publicErrors.has(error.code)) return respond({ error: error.code }, 400);
      if (error.status === 404 && error.code === "NOT_FOUND") return respond({ error: error.code }, 404);
      if (error.status === 409 && error.code === "STALE_CURSOR") return respond({ error: error.code }, 409);
    }
    return respond({ error: "OWNER_UNAVAILABLE" }, 503);
  }
}
