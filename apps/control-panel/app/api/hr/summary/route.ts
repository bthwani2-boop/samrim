import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readHRSummary } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function GET() {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator" || !identity.permissions?.includes("hr"))
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const summary = await readHRSummary({ operatorActorId: identity.subject });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "HR_UNAVAILABLE", message: "HR summary unavailable" };
    return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
  }
}
