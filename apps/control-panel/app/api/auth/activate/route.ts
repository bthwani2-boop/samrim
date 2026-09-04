import {
  activateOperator,
  identityErrorPayload,
  identityHttpStatus,
} from "../../../../lib/identity-bff";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { phone?: unknown; code?: unknown };
    if (typeof body.phone !== "string" || typeof body.code !== "string") {
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: "phone and activation code are required" } },
        { status: 400 },
      );
    }
    const identity = await activateOperator(body.phone, body.code);
    return Response.json({ identity }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: identityErrorPayload(error) },
      {
        status: identityHttpStatus(error),
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
