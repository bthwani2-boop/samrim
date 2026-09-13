import { beginOperatorRecoveryPasskeyRegistration, identityErrorPayload, identityHttpStatus } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; recoveryCredential?: unknown; verificationCode?: unknown };
    if (typeof body.phone !== "string" || typeof body.recoveryCredential !== "string" || typeof body.verificationCode !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone, recoveryCredential, and verificationCode are required" } }, { status: 400 });
    }
    const options = await beginOperatorRecoveryPasskeyRegistration(body.phone, body.recoveryCredential, body.verificationCode);
    return Response.json(options, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
