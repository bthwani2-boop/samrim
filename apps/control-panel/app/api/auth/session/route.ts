import { identityErrorPayload, identityHttpStatus, readOperatorSession } from "../../../../lib/identity-bff";

export async function GET() {
  try {
    const identity = await readOperatorSession();
    if (!identity) {
      return Response.json({ error: { code: "UNAUTHENTICATED", message: "operator session is not active" } }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
