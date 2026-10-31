import { NextResponse } from "next/server";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";

const responseHeaders = { "Cache-Control": "no-store" };
const fail = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers: responseHeaders });
async function authorizedActor() {
  const identity = await readOperatorSession();
  if (!identity) return { error: fail(401, "UNAUTHENTICATED") };
  if (identity.role !== "operator" || operatorWorkspacePermissionDenied(identity, "marketing")) {
    return { error: fail(403, "FORBIDDEN") };
  }
  return { actor: identity.subject };
}

export async function GET() {
  const session = await authorizedActor();
  if (session.error) return session.error;
  try {
    const result = await requestDshJson("GET", "/dsh/operator/marketing/studio-draft", undefined, {
      "X-Acting-Actor-ID": session.actor!,
    });
    return NextResponse.json(result.payload, { headers: responseHeaders });
  } catch (error) {
    const code = isDshClientError(error) ? dshErrorPayload(error).code : "INTERNAL_ERROR";
    return fail(isDshClientError(error) ? dshHttpStatus(error) : 500, code);
  }
}

export async function PUT(request: Request) {
  if (!verifySameOrigin(request)) return fail(403, "FORBIDDEN");
  const session = await authorizedActor();
  if (session.error) return session.error;

  if (Number(request.headers.get("Content-Length") ?? "0") > 32 * 1024) return fail(413, "INVALID_INPUT");
  const body = await request.json().catch(() => null) as {
    document?: unknown;
    expectedVersion?: unknown;
    idempotencyKey?: unknown;
  } | null;
  if (!body || typeof body.document !== "object" || body.document === null || Array.isArray(body.document) ||
      !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 ||
      typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 128 ||
      Buffer.byteLength(JSON.stringify(body.document), "utf8") > 24_000) {
    return fail(400, "INVALID_INPUT");
  }

  try {
    const result = await requestDshJson("PUT", "/dsh/operator/marketing/studio-draft", {
      document: body.document,
    }, {
      "X-Acting-Actor-ID": session.actor!,
      "X-Correlation-ID": crypto.randomUUID(),
      "Idempotency-Key": body.idempotencyKey,
      "X-Expected-Version": String(body.expectedVersion),
    });
    return NextResponse.json(result.payload, { headers: responseHeaders });
  } catch (error) {
    const code = isDshClientError(error) ? dshErrorPayload(error).code : "INTERNAL_ERROR";
    return fail(isDshClientError(error) ? dshHttpStatus(error) : 500, code);
  }
}
