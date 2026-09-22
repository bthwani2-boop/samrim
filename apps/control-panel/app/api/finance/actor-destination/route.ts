import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorDestination, dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorDestination } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

const actorTypes = new Set(["partner", "captain", "field"]);

async function operator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401 }) };
  if (identity.role !== "operator") return { error: NextResponse.json({ error: { code: "FORBIDDEN", message: "control operator access is required" } }, { status: 403 }) };
  return { identity };
}

export async function GET(request: Request) {
  const access = await operator();
  if (access.error) return access.error;
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType")?.trim() ?? "";
  const actorId = query.get("actorId")?.trim() ?? "";
  if (!actorTypes.has(actorType) || !actorId) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "actorType and actorId are required" } }, { status: 400 });
  try { return NextResponse.json(await readOperatorDestination(actorType as "partner" | "captain" | "field", actorId, { operatorActorId: access.identity.subject }), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return mapError(error, "destination read failed"); }
}

export async function POST(request: Request) {
  const access = await operator();
  if (access.error) return access.error;
  const query = new URL(request.url).searchParams;
  const actorType = query.get("actorType")?.trim() ?? "";
  const actorId = query.get("actorId")?.trim() ?? "";
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!actorTypes.has(actorType) || !actorId || !body || Object.keys(body).some((key) => !["providerKey", "walletIdentifier", "beneficiaryName", "changeReason", "verificationEvidenceReference", "changeEvidenceReference"].includes(key)) || Object.values(body).some((value) => typeof value !== "string" || !value.trim())) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "destination facts are required" } }, { status: 400 });
  try { return NextResponse.json((await createOperatorDestination(actorType as "partner" | "captain" | "field", actorId, body as never, { operatorActorId: access.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() })).payload, { status: 201 }); } catch (error) { return mapError(error, "destination creation failed"); }
}

function mapError(error: unknown, message: string) {
  if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error) });
}
