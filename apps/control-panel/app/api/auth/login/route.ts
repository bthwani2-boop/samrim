import { identityErrorPayload, identityHttpStatus, loginOperator } from "../../../../lib/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "username and password are required" } }, { status: 400 });
    }
    const identity = await loginOperator(body.username, body.password);
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
