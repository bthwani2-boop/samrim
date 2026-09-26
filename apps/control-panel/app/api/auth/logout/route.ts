import { identityErrorPayload, identityHttpStatus, logoutOperator } from "../../../../src/server/identity/identity-bff";

export async function POST() {
  try {
    await logoutOperator();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("CONTROL_PANEL_OPERATOR_LOGOUT_FAILED", {
      status: identityHttpStatus(error),
      code: identityErrorPayload(error).code,
    });
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
