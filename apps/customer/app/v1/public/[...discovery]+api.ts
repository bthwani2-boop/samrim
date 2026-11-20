import { DshPublicError, getPublicStore, listPublicOffers, listPublicStores, listPublicVerticals } from "@bthwani/dsh";

// The isolated DSH port and Expo server share the same development host.
const owner = "http://127.0.0.1:3202";
const publicId = /^[a-z0-9-]{1,64}$/;
const discoveryPath = /^\/v1\/public\/stores(?:\/([a-z0-9-]{1,64})(\/offers)?)?$/;
const badRequestCodes = new Set(["INVALID_REQUEST", "INVALID_CITY", "INVALID_LIMIT", "INVALID_CURSOR", "INVALID_SEARCH", "INVALID_VERTICAL"]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...(status === 405 ? { Allow: "GET" } : {}),
  } });
}

const fail = (status: number, error: string) => json({ error }, status);

function ownerFailure(error: unknown) {
  if (error instanceof DshPublicError) {
    if (error.status === 400 && badRequestCodes.has(error.code)) return fail(400, error.code);
    if (error.status === 404 && error.code === "NOT_FOUND") return fail(404, error.code);
    if (error.status === 409 && error.code === "STALE_CURSOR") return fail(409, error.code);
  }
  return fail(503, "OWNER_UNAVAILABLE");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    return fail(404, "NOT_FOUND");
  }
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin !== null && origin !== url.origin) ||
      (fetchSite !== null && fetchSite !== "none" && fetchSite !== "same-origin")) {
    return fail(403, "FORBIDDEN");
  }
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");

  const verticals = url.pathname === "/v1/public/verticals";
  const path = discoveryPath.exec(url.pathname);
  if (!path && !verticals) return fail(404, "NOT_FOUND");
  const [, id, offers] = path ?? [];
  const allowedKeys = verticals ? ["city_id", "limit", "cursor"] :
    id ? (offers ? ["q", "limit", "cursor"] : []) : ["city_id", "q", "vertical_id", "limit", "cursor"];
  const params = url.searchParams;
  if (url.search.length > 4097 ||
      [...params.keys()].some(key => !allowedKeys.includes(key) || params.getAll(key).length > 1)) {
    return fail(400, "INVALID_REQUEST");
  }
  try {
    // URLSearchParams tolerates malformed percent/UTF-8 sequences. Reject them
    // before the typed owner client can normalize them into a different query.
    decodeURIComponent(url.search);
  } catch {
    return fail(400, "INVALID_REQUEST");
  }

  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (rawLimit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)) return fail(400, "INVALID_LIMIT");
  const cursor = params.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) return fail(400, "INVALID_CURSOR");
  const city = params.get("city_id");
  if (!id && (city === null || !publicId.test(city))) return fail(400, "INVALID_CITY");

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  const query = params.get("q");
  const vertical = params.get("vertical_id");
  const page = { signal, ...(limit === undefined ? {} : { limit }), ...(cursor === null ? {} : { cursor }),
    ...(query === null ? {} : { query }),
    ...(vertical === null ? {} : { verticalId: vertical }) };
  try {
    if (verticals) return json(await listPublicVerticals(owner, city as string, page));
    if (id) return json(offers ? await listPublicOffers(owner, id, page) : await getPublicStore(owner, id, signal));
    return json(await listPublicStores(owner, city as string, page));
  } catch (error) {
    return ownerFailure(error);
  }
}
