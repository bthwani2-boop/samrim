import { finishOperatorRecoveryPasskeyRegistration, identityErrorPayload, identityHttpStatus } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ceremonyId?: unknown; credential?: unknown };
    if (typeof body.ceremonyId !== "string" || !body.credential || typeof body.credential !== "object" || Array.isArray(body.credential)) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "ceremonyId and credential are required" } }, { status: 400 });
    }
    const result = await finishOperatorRecoveryPasskeyRegistration(body.ceremonyId, body.credential as Record<string, unknown>);
    return Response.json({ identity: result.tokenPair.identity, recoveryCredential: result.recoveryCredential }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
