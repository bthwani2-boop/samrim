import { NextResponse } from "next/server";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { readBoundedJson } from "../../../../src/server/security/read-bounded-json";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";

const headers = { "Cache-Control": "no-store" };
const fail = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers });
async function operator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: fail(401, "UNAUTHENTICATED") };
  if (identity.role !== "operator" || operatorWorkspacePermissionDenied(identity, "marketing")) {
    return { error: fail(403, "FORBIDDEN") };
  }
  return { actor: identity.subject };
}

export async function GET(request: Request) {
  const session = await operator();
  if (session.error) return session.error;
  const history = new URL(request.url).searchParams.get("history") === "1";
  try {
    const path = history
      ? "/dsh/operator/marketing/studio-layout/history"
      : "/dsh/operator/marketing/studio-layout";
    const result = await requestDshJson("GET", path, undefined, {
      "X-Acting-Actor-ID": session.actor!,
    });
    return NextResponse.json(result.payload, { headers });
  } catch (error) {
    const code = isDshClientError(error) ? dshErrorPayload(error).code : "INTERNAL_ERROR";
    return fail(isDshClientError(error) ? dshHttpStatus(error) : 500, code);
  }
}

export async function PUT(request: Request) {
  if (!verifySameOrigin(request)) return fail(403, "FORBIDDEN");
  const session = await operator();
  if (session.error) return session.error;
  const decoded = await readBoundedJson(request, 4096);
  if (!decoded.ok) return fail(decoded.status, "INVALID_INPUT");
  if (!decoded.value || typeof decoded.value !== "object" || Array.isArray(decoded.value)) return fail(400, "INVALID_INPUT");
  const body = decoded.value as Record<string, unknown>;
  if (!["ACTIVATE_DRAFT", "RESTORE_DEFAULTS", "ROLLBACK"].includes(String(body.action)) ||
      !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 ||
      !Number.isInteger(body.expectedDraftVersion) || Number(body.expectedDraftVersion) < 0 ||
      !Number.isInteger(body.targetPublicationVersion) || Number(body.targetPublicationVersion) < 0 ||
      typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 128) {
    return fail(400, "INVALID_INPUT");
  }
  const draftVersion = Number(body.expectedDraftVersion);
  const target = Number(body.targetPublicationVersion);
  const expected = Number(body.expectedVersion);
  if ((body.action === "ACTIVATE_DRAFT" && (draftVersion < 1 || target !== 0)) ||
      (body.action === "RESTORE_DEFAULTS" && (draftVersion !== 0 || target !== 0)) ||
      (body.action === "ROLLBACK" && (draftVersion !== 0 || target < 1 || target >= expected))) {
    return fail(400, "INVALID_INPUT");
  }
  try {
    const result = await requestDshJson("PUT", "/dsh/operator/marketing/studio-layout", {
      action: body.action,
      expectedDraftVersion: draftVersion,
      targetPublicationVersion: target,
    }, {
      "X-Acting-Actor-ID": session.actor!,
      "X-Correlation-ID": crypto.randomUUID(),
      "Idempotency-Key": body.idempotencyKey,
      "X-Expected-Version": String(expected),
    });
    return NextResponse.json(result.payload, { headers });
  } catch (error) {
    const code = isDshClientError(error) ? dshErrorPayload(error).code : "INTERNAL_ERROR";
    return fail(isDshClientError(error) ? dshHttpStatus(error) : 500, code);
  }
}
