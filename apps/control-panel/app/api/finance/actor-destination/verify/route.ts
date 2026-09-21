import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, verifyOperatorDestination } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "control operator access is required" } }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType")?.trim() ?? "";
  const actorId = query.get("actorId")?.trim() ?? "";
  const destinationId = query.get("destinationId")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { evidenceReference?: unknown } | null;
  if (!["partner", "captain", "field"].includes(actorType) || !actorId || !destinationId || typeof body?.evidenceReference !== "string" || !body.evidenceReference.trim()) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "destination and evidence are required" } }, { status: 400 });
  try { return NextResponse.json(await verifyOperatorDestination(actorType as "partner" | "captain" | "field", actorId, destinationId, body.evidenceReference, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() })); } catch (error) { return mapError(error, "destination verification failed"); }
}

function mapError(error: unknown, message: string) {
  if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
}
