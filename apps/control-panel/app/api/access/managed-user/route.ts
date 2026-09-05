import { NextResponse } from "next/server";

import type { ManagedActivationRole } from "@bthwani/identity";
import {
  identityErrorPayload,
  identityHttpStatus,
  issueManagedActivationCode,
  provisionOperator,
  readOperatorSession,
} from "../../../../lib/identity-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError, provisionManagedRole } from "../../../../lib/dsh-bff";

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field", "operator"]);

export async function POST(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "platform_owner") return NextResponse.json({ error: { code: "FORBIDDEN", message: "platform owner access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const body = (await request.json().catch(() => null)) as { phone?: unknown; role?: unknown; password?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!phone || !managedRoles.has(role as ManagedActivationRole)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "phone and managed role are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (role === "operator" && (password.length < 12 || password.length > 128)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "operator password must be between 12 and 128 characters" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (role === "operator") {
      await provisionOperator(phone, password);
    } else {
      await provisionManagedRole(phone, role as "partner" | "captain" | "field");
    }
    const result = await issueManagedActivationCode(phone, role as ManagedActivationRole);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
