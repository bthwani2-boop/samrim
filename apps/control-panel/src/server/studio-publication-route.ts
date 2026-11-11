import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "./dsh/dsh-transport";
import { readOperatorSession } from "./identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "./identity/operator-workspace-access";
import { verifySameOrigin } from "./security/csrf";
import { readBoundedJson } from "./security/read-bounded-json";

type StudioPublication = "studio-theme" | "studio-layout";

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

function studioFailure(error: unknown) {
  if (!isDshClientError(error)) return fail(500, "INTERNAL_ERROR");
  return fail(dshHttpStatus(error), dshErrorPayload(error).code);
}

export async function readStudioPublication(kind: StudioPublication, request: Request) {
  const session = await operator();
  if (session.error) return session.error;
  const history = new URL(request.url).searchParams.get("history") === "1";
  const path = `/dsh/operator/marketing/${kind}${history ? "/history" : ""}`;
  try {
    const result = await requestDshJson("GET", path, undefined, {
      "X-Acting-Actor-ID": session.actor,
    });
    return NextResponse.json(result.payload, { headers });
  } catch (error) {
    return studioFailure(error);
  }
}

export async function writeStudioPublication(kind: StudioPublication, request: Request) {
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
    const result = await requestDshJson("PUT", `/dsh/operator/marketing/${kind}`, {
      action: body.action,
      expectedDraftVersion: draftVersion,
      targetPublicationVersion: target,
    }, {
      "X-Acting-Actor-ID": session.actor,
      "X-Correlation-ID": crypto.randomUUID(),
      "Idempotency-Key": body.idempotencyKey,
      "X-Expected-Version": String(expected),
    });
    return NextResponse.json(result.payload, { headers });
  } catch (error) {
    return studioFailure(error);
  }
}
