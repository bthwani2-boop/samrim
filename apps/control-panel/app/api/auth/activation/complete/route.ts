import { completeOperatorActivation, identityErrorPayload, identityHttpStatus } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; operatorEnrollmentToken?: unknown; verificationCode?: unknown; password?: unknown };
    if (typeof body.phone !== "string" || typeof body.operatorEnrollmentToken !== "string" || typeof body.verificationCode !== "string" || typeof body.password !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone, operatorEnrollmentToken, verificationCode, and password are required" } }, { status: 400 });
    }
    const identity = await completeOperatorActivation(body.phone, body.operatorEnrollmentToken, body.verificationCode, body.password);
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
