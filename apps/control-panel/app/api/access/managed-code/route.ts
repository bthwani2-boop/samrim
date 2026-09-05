import { NextResponse } from "next/server";

import {
  identityErrorPayload,
  identityHttpStatus,
  issueManagedActivationCode,
  readOperatorSession,
} from "../../../../lib/identity-bff";
import type { ManagedActivationRole } from "@bthwani/identity";

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field", "operator"]);

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "platform_owner") return NextResponse.json({ error: { code: "FORBIDDEN", message: "platform owner access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  if (!phone || !managedRoles.has(role as ManagedActivationRole)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and managed role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await issueManagedActivationCode(phone, role as ManagedActivationRole);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
