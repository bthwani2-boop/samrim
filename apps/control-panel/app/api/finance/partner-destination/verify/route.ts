import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, verifyOperatorPartnerDestination } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "control operator access is required" } }, { status: 403 });
  const url = new URL(request.url);
  const partnerActorId = url.searchParams.get("partnerActorId")?.trim() ?? "";
  const destinationId = url.searchParams.get("destinationId")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { evidenceReference?: unknown } | null;
  if (!partnerActorId || !destinationId || typeof body?.evidenceReference !== "string" || !body.evidenceReference.trim()) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "destination and evidence are required" } }, { status: 400 });
  try { return NextResponse.json(await verifyOperatorPartnerDestination(partnerActorId, destinationId, body.evidenceReference, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() })); } catch (error) { if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "destination verification failed" } }, { status: 500 }); return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) }); }
}
