import { identityErrorPayload, identityHttpStatus, loginOperatorWithDevelopmentPassword } from "../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const input: unknown = await request.json().catch(() => null);
    const password = input && typeof input === "object" && "password" in input
      ? (input as { password?: unknown }).password
      : undefined;
    if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
      return Response.json({ error: { code: "INVALID_INPUT", message: "أدخل كلمة المرور." } }, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const identity = await loginOperatorWithDevelopmentPassword(password);
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: identityErrorPayload(error) }, {
      status: identityHttpStatus(error),
      headers: { "Cache-Control": "no-store" },
    });
  }
}
