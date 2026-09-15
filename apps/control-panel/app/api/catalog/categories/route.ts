import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listCatalogCategories } from "../../../../src/server/dsh/dsh-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const verticalId = new URL(request.url).searchParams.get("verticalId")?.trim() ?? "";
  if (!verticalId) return errorResponse("INVALID_INPUT", "verticalId is required", 400);
  try {
    return NextResponse.json(await listCatalogCategories(verticalId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog category lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
