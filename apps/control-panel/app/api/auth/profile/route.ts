import { identityErrorPayload, identityHttpStatus, readOperatorProfile } from "../../../../src/server/identity/identity-bff";

export async function GET() {
  try {
    const profile = await readOperatorProfile();
    if (!profile) {
      return Response.json({ error: { code: "UNAUTHENTICATED", message: "operator session is not active" } }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
