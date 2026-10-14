import { NextResponse } from "next/server";

import { downloadOperatorStoreInternalPhoto, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

export async function GET(request: Request, context: { params: Promise<{ storeId: string; photoId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "control operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  try {
    const { storeId, photoId } = await context.params;
    const image = await downloadOperatorStoreInternalPhoto(storeId, photoId, { operatorActorId: identity.subject });
    return new Response(Buffer.from(image.content), { headers: { "Content-Type": image.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (!isDshClientError(error)) return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذر قراءة الصورة الداخلية." } }, { status: 500, headers: { "Cache-Control": "no-store" } });
    const payload = dshErrorPayload(error);
    return NextResponse.json({ error: payload }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
