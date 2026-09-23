import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorPayoutRequests } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  try {
    return NextResponse.json(await listOperatorPayoutRequests(new URL(request.url).searchParams.get("status") ?? "", { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "payout queue read failed" } }, { status: 500 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
  }
}
