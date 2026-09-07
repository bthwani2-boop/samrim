import { identityErrorPayload, identityHttpStatus, requestOperatorActivation } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; operatorEnrollmentToken?: unknown; activationCode?: unknown };
    const rawToken = typeof body.operatorEnrollmentToken === "string" ? body.operatorEnrollmentToken : body.activationCode;
    if (typeof body.phone !== "string" || typeof rawToken !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone and operatorEnrollmentToken are required" } }, { status: 400 });
    }
    const challenge = await requestOperatorActivation(body.phone, rawToken);
    return Response.json({ challenge }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
