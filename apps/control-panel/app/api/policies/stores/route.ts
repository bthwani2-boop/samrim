import { NextResponse } from "next/server";

import { listOperatorStores, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);

  const params = new URL(request.url).searchParams;
  const search = params.get("q")?.trim() ?? "";
  const serviceCityId = params.get("serviceCityId")?.trim() ?? "";
  const rawCursor = params.get("cursor") ?? "";
  const cursor = rawCursor.trim();
  const limitValue = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(limitValue) ? Number(limitValue) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || Array.from(search).length > 128 || serviceCityId.length > 128 || rawCursor.length > 1024) return errorResponse("INVALID_INPUT", "store search, city, page size, or cursor are invalid", 400);
  if (!serviceCityId) return errorResponse("INVALID_INPUT", "choose a service city before searching stores", 400);
  if (Array.from(search).length < 2) return NextResponse.json({ stores: [], nextCursor: "" }, { headers: { "Cache-Control": "no-store" } });

  try {
    const page = await listOperatorStores("published", search, serviceCityId, "name_prefix", "name_asc", limit, cursor, { operatorActorId: identity.subject });
    const stores = page.stores.map(({ id, name, serviceCityId: cityId }) => ({ id, name, serviceCityId: cityId }));
    return NextResponse.json({ stores, nextCursor: page.nextCursor ?? "" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "published store lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
