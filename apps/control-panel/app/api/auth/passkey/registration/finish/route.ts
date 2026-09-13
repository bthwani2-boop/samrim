import { finishOperatorPasskeyRegistration, identityErrorPayload, identityHttpStatus } from "../../../../../../src/server/identity/identity-bff";
import { normalizePasskeyFinishPayload } from "../../../../../../src/server/identity/passkey-request";

export async function POST(request: Request) {
  try {
    const input = normalizePasskeyFinishPayload(await request.json());
    const result = await finishOperatorPasskeyRegistration(input.ceremonyId, input.credential);
    return Response.json({ identity: result.tokenPair.identity, recoveryCredential: result.recoveryCredential }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
