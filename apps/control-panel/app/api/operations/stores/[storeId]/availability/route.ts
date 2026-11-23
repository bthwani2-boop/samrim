import { DshPublicError, type StoreOperationalChange, updateStoreOperationalAvailability } from "@bthwani/dsh";
import { cookies } from "next/headers";
import { isolatedPublicDshOrigin } from "../../../../../../src/features/stores/public-store-query";
import { currentOperatorAccess } from "../../../../../../src/server/current-operator-access";
import {
  boundedRequestBody, isTrustedOperatorRequest, OPERATOR_COOKIE, resolveIsolatedOperatorConfig,
} from "../../../../../../src/server/operator-passkey-bff";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const failure = (status: number, code: string) => Response.json({ code }, { status, headers: privateHeaders });

function parseCommand(raw: string | null): StoreOperationalChange | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > 16 * 1024) return null;
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const keys = ["operationId", "expectedVersion", "weekly", "preparationMinutes", "pausedUntil", "reason"];
    if (Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key))) return null;
    const command = body as StoreOperationalChange;
    return command.pausedUntil === null || typeof command.pausedUntil === "string" ? command : null;
  } catch {
    return null;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const options = resolveIsolatedOperatorConfig(process.env);
  const owner = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!options || !owner) return failure(503, "OWNER_UNAVAILABLE");
  if (!isTrustedOperatorRequest(request, options, "PATCH")) return failure(403, "FORBIDDEN");
  const { storeId } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) ||
      request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return failure(400, "INVALID_REQUEST");
  }
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer) return failure(401, "UNAUTHENTICATED");
  const access = await currentOperatorAccess();
  if (!access) return failure(401, "UNAUTHENTICATED");
  if (!access.grants.includes("operations") ||
      request.headers.get("X-BThwani-Operator") !== encodeURIComponent(access.actorId)) {
    return failure(403, "FORBIDDEN");
  }
  const command = parseCommand(await boundedRequestBody(request));
  if (!command) return failure(400, "INVALID_REQUEST");
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    await updateStoreOperationalAvailability(owner, storeId, bearer, command, signal);
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    if (error instanceof DshPublicError && [400, 401, 403, 404, 409].includes(error.status)) {
      return failure(error.status, error.code);
    }
    return failure(503, "OPERATION_RESULT_UNKNOWN");
  }
}
