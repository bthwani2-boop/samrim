import { identityErrorPayload, identityHttpStatus, startOperatorLogin } from "../../../../../lib/identity-bff";
import type { ControlPanelRole } from "@bthwani/identity";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; password?: unknown; role?: unknown };
    const role = body.role === "platform_owner" ? "platform_owner" : body.role === "operator" ? "operator" : "";
    if (typeof body.phone !== "string" || typeof body.password !== "string" || !role) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone, password, and role are required" } }, { status: 400 });
    }
    const challenge = await startOperatorLogin(body.phone, body.password, role as ControlPanelRole);
    return Response.json({ challenge }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
