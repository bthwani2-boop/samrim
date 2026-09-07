import { identityErrorPayload, identityHttpStatus, logoutOperator } from "../../../../lib/identity-bff";

export async function POST() {
  try {
    await logoutOperator();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
