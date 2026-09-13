import { requestOperatorRecovery, identityErrorPayload, identityHttpStatus } from "../../../../../../src/server/identity/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; recoveryCredential?: unknown };
    if (typeof body.phone !== "string" || typeof body.recoveryCredential !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone and recoveryCredential are required" } }, { status: 400 });
    }
    const challenge = await requestOperatorRecovery(body.phone, body.recoveryCredential);
    return Response.json(challenge, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
