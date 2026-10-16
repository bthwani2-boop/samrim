import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readHREmployeeByOperatorActor } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

export async function GET(_request: Request, context: { params: Promise<{ actorId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("hr")) return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const actorId = (await context.params).actorId;
  if (!actorId || actorId.length > 128) return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
  try {
    const result = await readHREmployeeByOperatorActor(actorId, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "HR_UNAVAILABLE" } }, { status: 502 });
    return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
