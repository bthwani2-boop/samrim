import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorPendingActorLegalName, submitOperatorActorLegalName, verifyOperatorActorLegalName } from "../../../../src/server/dsh/dsh-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function operator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) };
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "operator access is required", 403) };
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  return denied ? { error: denied } : { identity };
}

function mapError(error: unknown) {
  if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "Identity legal-name workflow failed", 500);
  const payload = dshErrorPayload(error);
  return errorResponse(payload.code, payload.message, dshHttpStatus(error));
}

export async function GET(request: Request) {
  const access = await operator();
  if (access.error) return access.error;
  const actorId = new URL(request.url).searchParams.get("actorId")?.trim() ?? "";
  if (!actorId) return errorResponse("INVALID_INPUT", "actorId is required", 400);
  try {
    const result = await readOperatorPendingActorLegalName(actorId, { operatorActorId: access.identity.subject });
    return NextResponse.json({ ...result, canVerify: result.legalName.submittedByActorId !== access.identity.subject }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mapError(error); }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await operator();
  if (access.error) return access.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  if (!body || !actorId) return errorResponse("INVALID_INPUT", "action and actorId are required", 400);
  const context = { operatorActorId: access.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: request.headers.get("Idempotency-Key")?.trim() || randomUUID() };
  try {
    if (action === "submit") {
      const allowed = ["action", "actorId", "givenName", "secondName", "thirdName", "familyName", "evidenceReference"];
      const values = [body.givenName, body.secondName, body.thirdName, body.familyName, body.evidenceReference];
      if (Object.keys(body).some((key) => !allowed.includes(key)) || values.some((value) => typeof value !== "string" || !value.trim())) return errorResponse("INVALID_INPUT", "four legal-name parts and an evidence reference are required", 400);
      const result = await submitOperatorActorLegalName(actorId, { givenName: body.givenName as string, secondName: body.secondName as string, thirdName: body.thirdName as string, familyName: body.familyName as string, evidenceReference: body.evidenceReference as string }, context);
      return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (action === "verify") {
      const allowed = ["action", "actorId", "version", "evidenceReference"];
      const version = typeof body.version === "number" ? body.version : Number(body.version);
      if (Object.keys(body).some((key) => !allowed.includes(key)) || !Number.isInteger(version) || version < 1 || typeof body.evidenceReference !== "string" || !body.evidenceReference.trim()) return errorResponse("INVALID_INPUT", "candidate version and verification evidence are required", 400);
      const result = await verifyOperatorActorLegalName(actorId, version, { evidenceReference: body.evidenceReference }, context);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    return errorResponse("INVALID_INPUT", "supported legal-name actions are submit and verify", 400);
  } catch (error) { return mapError(error); }
}
