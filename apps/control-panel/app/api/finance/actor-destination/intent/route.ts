import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorWalletProviderIntent } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType")?.trim() ?? "";
  const actorId = query.get("actorId")?.trim() ?? "";
  if (!(actorType === "partner" || actorType === "captain" || actorType === "field") || !actorId) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "actorType and actorId are required" } }, { status: 400 });
  try {
    const response = await readOperatorWalletProviderIntent(actorType, actorId, { operatorActorId: identity.subject });
    return NextResponse.json({ ...response, operatorActorId: identity.subject }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "wallet provider intent read failed" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
