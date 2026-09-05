import { completeOperatorLogin, identityErrorPayload, identityHttpStatus } from "../../../../../lib/identity-bff";
import type { ControlPanelRole } from "@bthwani/identity";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; code?: unknown; role?: unknown };
    const role = body.role === "platform_owner" ? "platform_owner" : body.role === "operator" ? "operator" : "";
    if (typeof body.phone !== "string" || typeof body.code !== "string" || !role) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "phone, code, and role are required" } }, { status: 400 });
    }
    const identity = await completeOperatorLogin(body.phone, body.code, role as ControlPanelRole);
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
