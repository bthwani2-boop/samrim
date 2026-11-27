import { DshPublicError } from "./client-core.ts";
import {
  estimatePublicOffer, getPublicStore, listPublicCities, listPublicOffers,
  listPublicStores, listPublicVerticals, parseOfferEstimateQuantity,
} from "./public-discovery.ts";

type Audience = "customer" | "merchant";
type Route =
  | { kind: "cities" | "verticals" | "stores" }
  | { kind: "store" | "offers"; storeId: string }
  | { kind: "estimate"; storeId: string; offerId: string };

const publicId = /^[a-z0-9-]{1,64}$/;
const storeRoute = /^\/v1\/public\/stores\/([a-z0-9-]{1,64})(?:\/(offers)(?:\/([a-z0-9-]{1,64})\/estimate)?)?$/;
const badRequestCodes = new Set([
  "INVALID_REQUEST", "INVALID_CITY", "INVALID_LIMIT", "INVALID_CURSOR", "INVALID_SEARCH", "INVALID_VERTICAL",
]);

function routeFor(path: string, audience: Audience): Route | null {
  if (audience === "customer") {
    if (path === "/v1/public/cities") return { kind: "cities" };
    if (path === "/v1/public/verticals") return { kind: "verticals" };
    if (path === "/v1/public/stores") return { kind: "stores" };
  }
  const match = storeRoute.exec(path);
  if (!match) return null;
  const [, storeId, offers, offerId] = match;
  if (!storeId) return null;
  if (!offers) return audience === "merchant" && storeId === "mine" ? null : { kind: "store", storeId };
  if (!offerId) return { kind: "offers", storeId };
  return audience === "customer" ? { kind: "estimate", storeId, offerId } : null;
}

function reply(value: unknown, status = 200): Response {
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

function fail(status: number, error: string): Response {
  return reply({ error }, status);
}

function ownerFailure(error: unknown, audience: Audience): Response {
  if (error instanceof DshPublicError) {
    const merchantDeniedCode = audience === "merchant" &&
      (error.code === "INVALID_CITY" || error.code === "INVALID_VERTICAL");
    if (error.status === 400 && badRequestCodes.has(error.code) && !merchantDeniedCode) {
      return fail(400, error.code);
    }
    if (error.status === 404 && error.code === "NOT_FOUND") return fail(404, error.code);
    if (error.status === 409 && (error.code === "STALE_CURSOR" ||
      (audience === "customer" && error.code === "INSUFFICIENT_AVAILABLE_QUANTITY"))) {
      return fail(409, error.code);
    }
  }
  return fail(503, "OWNER_UNAVAILABLE");
}
// The BFF must reject malformed wire input, not normalize it into a different
// valid owner request. Typed owner clients still own value and projection validation.
function admittedQuery(request: Request, url: URL, route: Route): URLSearchParams | null {
  const length = request.headers.get("Content-Length");
  if (request.body !== null || (length !== null && length !== "0") || request.headers.has("Transfer-Encoding")) {
    return null;
  }
  if (url.search.length > 4097 || url.search.includes(";") ||
    (route.kind === "store" && url.href.split("#", 1)[0]?.includes("?"))) {
    return null;
  }
  try {
    decodeURIComponent(url.search);
  } catch {
    return null;
  }
  const keys = route.kind === "cities" ? ["limit", "cursor"] :
    route.kind === "verticals" ? ["city_id", "limit", "cursor"] :
    route.kind === "stores" ? ["city_id", "q", "vertical_id", "limit", "cursor"] :
    route.kind === "offers" ? ["q", "limit", "cursor"] :
    route.kind === "estimate" ? ["quantity"] : [];
  const params = url.searchParams;
  return [...params.keys()].every(key => keys.includes(key) && params.getAll(key).length === 1) ? params : null;
}

/** Server-only isolated development adapter. No credentials or mutable owner operations. */
export async function servePublicDiscovery(
  request: Request, audience: Audience, owner: string, development: boolean,
): Promise<Response> {
  const url = new URL(request.url);
  if (!development || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    return fail(404, "NOT_FOUND");
  }
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if ((origin !== null && origin !== url.origin) ||
    (site !== null && site !== "none" && site !== "same-origin")) return fail(403, "FORBIDDEN");
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");

  const route = routeFor(url.pathname, audience);
  if (!route) return fail(404, "NOT_FOUND");
  const params = admittedQuery(request, url, route);
  if (!params) return fail(400, "INVALID_REQUEST");

  const rawLimit = params.get("limit");
  if (rawLimit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)) return fail(400, "INVALID_LIMIT");
  const cursor = params.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) return fail(400, "INVALID_CURSOR");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  const query = params.get("q");
  const vertical = params.get("vertical_id");
  const page = {
    signal,
    ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
    ...(cursor === null ? {} : { cursor }),
    ...(query === null ? {} : { query }),
    ...(vertical === null ? {} : { verticalId: vertical }),
  };

  try {
    switch (route.kind) {
      case "cities": return reply(await listPublicCities(owner, page));
      case "verticals":
      case "stores": {
        const city = params.get("city_id");
        if (city === null || !publicId.test(city)) return fail(400, "INVALID_CITY");
        return reply(route.kind === "verticals"
          ? await listPublicVerticals(owner, city, page)
          : await listPublicStores(owner, city, page));
      }
      case "store": return reply(await getPublicStore(owner, route.storeId, signal));
      case "offers": return reply(await listPublicOffers(owner, route.storeId, page));
      case "estimate": {
        const quantity = parseOfferEstimateQuantity(params.get("quantity") ?? "");
        if (quantity === null) return fail(400, "INVALID_REQUEST");
        return reply(await estimatePublicOffer(owner, route.storeId, route.offerId, quantity, signal));
      }
    }
  } catch (error) {
    return ownerFailure(error, audience);
  }
}
