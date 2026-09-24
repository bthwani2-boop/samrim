import { NextResponse } from "next/server";

import { listPublishedStoresForMarketing, listServiceCities, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);

  try {
    const cities = await listServiceCities(false, { operatorActorId: identity.subject });
    const groups = await Promise.all(cities.cities.filter((city) => city.active).map((city) => listPublishedStoresForMarketing(city.id)));
    const stores = groups.flatMap((group) => group.stores.map((store) => ({ id: store.id, name: store.name, serviceCityName: store.serviceCity.displayNameAr }))).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return NextResponse.json({ stores }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "published store lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
