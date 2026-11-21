import { changeOriginalOperatorPermission, IdentityClientError, isOperatorActorId } from "@bthwani/identity";
import { cookies } from "next/headers";
import { isOperatorPermission } from "../../../../../../../src/features/session/operator-permissions";
import { currentOriginalOperatorPermissions } from "../../../../../../../src/server/current-operator-access";
import {
  boundedRequestBody, isTrustedOperatorRequest, OPERATOR_COOKIE, resolveIsolatedOperatorConfig,
} from "../../../../../../../src/server/operator-passkey-bff";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const failure = (status: number, code: string) => Response.json({ code }, { status, headers: privateHeaders });
const commandFields = ["state", "expectedVersion", "operationId", "reason"] as const;

export async function PATCH(request: Request, { params }: {
  params: Promise<{ operatorId: string; permission: string }>;
}) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return failure(503, "OWNER_UNAVAILABLE");
  if (!isTrustedOperatorRequest(request, config, "PATCH")) return failure(403, "FORBIDDEN");
  const { operatorId, permission } = await params;
  if (!isOperatorActorId(operatorId) || !isOperatorPermission(permission) ||
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded") {
    return failure(400, "INVALID_REQUEST");
  }
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer) return failure(401, "UNAUTHORIZED");
  const original = await currentOriginalOperatorPermissions();
  if (!original || original.actorId === operatorId ||
      request.headers.get("x-bthwani-operator") !== encodeURIComponent(original.actorId)) {
    return failure(403, "FORBIDDEN");
  }

  const raw = await boundedRequestBody(request, 8192);
  if (raw === null) return failure(400, "INVALID_REQUEST");
  const fields = new URLSearchParams(raw);
  if (fields.size !== commandFields.length || commandFields.some(field => fields.getAll(field).length !== 1)) {
    return failure(400, "INVALID_REQUEST");
  }
  const state = fields.get("state");
  const expectedVersion = fields.get("expectedVersion");
  if ((state !== "ACTIVE" && state !== "REVOKED") ||
      expectedVersion === null || !/^(0|[1-9][0-9]{0,15})$/.test(expectedVersion)) {
    return failure(400, "INVALID_REQUEST");
  }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const result = await changeOriginalOperatorPermission(config.identityOrigin, bearer, operatorId, permission, {
      state,
      expectedVersion: Number(expectedVersion),
      operationId: fields.get("operationId") ?? "",
      reason: fields.get("reason") ?? "",
    }, signal);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof IdentityClientError && [400, 401, 403, 404, 409].includes(error.status)) {
      return failure(error.status, error.code);
    }
    return failure(503, "OPERATION_RESULT_UNKNOWN");
  }
}
