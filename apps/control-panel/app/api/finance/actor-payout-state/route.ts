import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPayoutState } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

const actorTypes = new Set(["partner", "captain", "field"]);

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType")?.trim() ?? "";
  const actorId = query.get("actorId")?.trim() ?? "";
  if (!actorTypes.has(actorType) || !actorId) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "actorType and actorId are required" } }, { status: 400 });
  try {
    return NextResponse.json(await readOperatorPayoutState(actorType as "partner" | "captain" | "field", actorId, { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "payout state read failed" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
