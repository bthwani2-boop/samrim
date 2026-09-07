import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { identityErrorPayload, identityHttpStatus, readOperatorSession, resetOperatorPasswordByPhone } from "../../../../../lib/identity-bff";
import { verifySameOrigin } from "../../../../../lib/csrf";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) {
    return jsonError("FORBIDDEN", "cross-site requests are forbidden", 403);
  }

  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "platform_owner") return jsonError("FORBIDDEN", "platform owner access is required", 403);

  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
    password?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;

  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const rawExpectedVersion = body?.expectedVersion;

  if (!phone || !password || reason.length < 5 || reason.length > 500) {
    return jsonError("INVALID_INPUT", "phone, password, and a reason of 5 to 500 characters are required", 400);
  }

  if (rawExpectedVersion === undefined || rawExpectedVersion === null) {
    return jsonError("PRECONDITION_REQUIRED", "expectedVersion is required for concurrency safety", 428);
  }
  let expectedVersion: number;
  if (typeof rawExpectedVersion === "number") {
    expectedVersion = rawExpectedVersion;
  } else if (typeof rawExpectedVersion === "string" && /^[1-9]\d*$/.test(rawExpectedVersion.trim())) {
    expectedVersion = Number(rawExpectedVersion.trim());
  } else {
    return jsonError("INVALID_INPUT", "expectedVersion must be a positive integer >= 1", 400);
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return jsonError("INVALID_INPUT", "expectedVersion must be a positive integer >= 1", 400);
  }

  try {
    const correlationId = randomUUID();
    const mutationOptions = {
      operatorActorId: identity.subject,
      expectedVersion,
      correlationId,
    };
    await resetOperatorPasswordByPhone(phone, password, mutationOptions);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: identityErrorPayload(error) }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
