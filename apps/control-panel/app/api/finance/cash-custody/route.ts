import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorCashCustody } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const allowedSorts = ["collected_asc", "collected_desc"] as const;

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return errorResponse("FORBIDDEN", "Finance permission is required", 403);

  const query = new URL(request.url).searchParams;
  const search = query.get("search")?.trim() ?? "";
  const sort = query.get("sort") ?? "collected_asc";
  const cursor = query.get("cursor") ?? "";
  const rawLimit = query.get("limit") ?? "50";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (search.length > 128 || cursor.length > 1024 || !allowedSorts.includes(sort as typeof allowedSorts[number]) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return errorResponse("INVALID_INPUT", "مرشحات سجل النقد المحصل غير صالحة", 400);
  }

  try {
    const result = await listOperatorCashCustody(search, sort as typeof allowedSorts[number], cursor, limit, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "cash custody read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
