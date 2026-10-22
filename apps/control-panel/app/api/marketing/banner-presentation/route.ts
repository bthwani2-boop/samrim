import { NextResponse } from "next/server";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";
import { requestDshJson, isDshClientError, dshErrorPayload, dshHttpStatus } from "../../../../src/server/dsh/dsh-bff";

const failure = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
async function authorize() {
  const identity = await readOperatorSession();
  if (!identity) return { error: failure(401, "UNAUTHENTICATED") };
  if (identity.role !== "operator" || operatorWorkspacePermissionDenied(identity, "marketing")) return { error: failure(403, "FORBIDDEN") };
  return { actor: identity.subject };
}
export async function GET() {
  const session = await authorize();
  if (session.error) return session.error;
  try {
    const result = await requestDshJson("GET", "/dsh/operator/marketing/banner-presentation", undefined, { "X-Acting-Actor-ID": session.actor! });
    return NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "INTERNAL_ERROR" };
    return failure(isDshClientError(error) ? dshHttpStatus(error) : 500, payload.code);
  }
}
export async function PUT(request: Request) {
  if (!verifySameOrigin(request)) return failure(403, "FORBIDDEN");
  const session = await authorize();
  if (session.error) return session.error;
  const input = await request.json().catch(() => null) as { mode?: unknown; intervalSeconds?: unknown; expectedVersion?: unknown } | null;
  if (!input || !["STATIC", "CINEMATIC", "CROSSFADE"].includes(String(input.mode)) || !Number.isInteger(input.intervalSeconds) || Number(input.intervalSeconds) < 3 || Number(input.intervalSeconds) > 10 || !Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) return failure(400, "INVALID_INPUT");
  try {
    const result = await requestDshJson("PUT", "/dsh/operator/marketing/banner-presentation", { mode: input.mode, intervalSeconds: input.intervalSeconds }, {
      "X-Acting-Actor-ID": session.actor!,
      "X-Correlation-ID": crypto.randomUUID(),
      "Idempotency-Key": crypto.randomUUID(),
      "X-Expected-Version": String(input.expectedVersion),
    });
    return NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "INTERNAL_ERROR" };
    return failure(isDshClientError(error) ? dshHttpStatus(error) : 500, payload.code);
  }
}
