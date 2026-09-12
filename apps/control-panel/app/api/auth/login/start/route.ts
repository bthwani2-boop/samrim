import { identityErrorPayload, identityHttpStatus, startOperatorLogin } from "../../../../../lib/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; password?: unknown };
    if (typeof body.phone !== "string" || typeof body.password !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone and password are required" } }, { status: 400 });
    }
    const challenge = await startOperatorLogin(body.phone, body.password);
    return Response.json({ challenge }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
