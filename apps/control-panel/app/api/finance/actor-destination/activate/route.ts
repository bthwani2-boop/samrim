import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { activateOperatorDestination, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Finance permission is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType")?.trim() ?? "";
  const actorId = query.get("actorId")?.trim() ?? "";
  const destinationId = query.get("destinationId")?.trim() ?? "";
  if (!["partner", "captain", "field"].includes(actorType) || !actorId || !destinationId) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "destination and actor are required" } }, { status: 400 });
  try { return NextResponse.json(await activateOperatorDestination(actorType as "partner" | "captain" | "field", actorId, destinationId, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() })); } catch (error) { return mapError(error, "destination activation failed"); }
}

function mapError(error: unknown, message: string) {
  if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
}
