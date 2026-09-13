import { beginOperatorPasskeyAuthentication, identityErrorPayload, identityHttpStatus } from "../../../../../src/server/identity/identity-bff";

export async function POST() {
  try {
    const options = await beginOperatorPasskeyAuthentication();
    return Response.json(options, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
