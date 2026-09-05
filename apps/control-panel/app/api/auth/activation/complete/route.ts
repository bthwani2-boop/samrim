import { completeOperatorActivation, identityErrorPayload, identityHttpStatus } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; activationCode?: unknown; verificationCode?: unknown };
    if (typeof body.phone !== "string" || typeof body.activationCode !== "string" || typeof body.verificationCode !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone, activationCode, and verificationCode are required" } }, { status: 400 });
    }
    const identity = await completeOperatorActivation(body.phone, body.activationCode, body.verificationCode);
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
