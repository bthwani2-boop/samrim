import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createOperatorProfile, identityErrorPayload, identityHttpStatus, listOperatorProfiles, readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const noStore = { "Cache-Control": "no-store" };

function denied(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}

async function operatorAdministrator() {
  const identity = await readOperatorSession();
  if (!identity) return { response: denied(401, "UNAUTHENTICATED", "authentication is required") } as const;
  if (identity.role !== "operator" || !identity.canManageOperatorPermissions) return { response: denied(403, "FORBIDDEN", "operator profile administration is restricted to the authorized administrator") } as const;
  return { identity } as const;
}

export async function GET(request: Request) {
  const access = await operatorAdministrator();
  if ("response" in access) return access.response;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const state = params.get("state") ?? "all";
  const sort = params.get("sort") ?? "created_desc";
  const query = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !["all", "pending_review", "approved", "admitted"].includes(state) || !["created_asc", "created_desc"].includes(sort) || query.trim().length > 100 || cursor.length > 1024) return denied(400, "INVALID_INPUT", "valid profile search, state, sort, limit, and cursor are required");
  try {
    const page = await listOperatorProfiles(query, state, sort as "created_asc" | "created_desc", limit, cursor, { operatorActorId: access.identity.subject, correlationId: randomUUID() });
    return NextResponse.json(page, { headers: noStore });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return denied(identityHttpStatus(error), payload.code, payload.message);
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return denied(403, "FORBIDDEN", "cross-site requests are forbidden");
  const access = await operatorAdministrator();
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fullNameAr = typeof body?.fullNameAr === "string" ? body.fullNameAr.trim() : "";
  const phoneE164 = typeof body?.phoneE164 === "string" ? body.phoneE164.replace(/\s+/g, "") : "";
  if (!body || Object.keys(body).some((key) => !["fullNameAr", "phoneE164"].includes(key)) || Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120 || !/^\+[1-9][0-9]{7,14}$/.test(phoneE164)) return denied(400, "INVALID_INPUT", "a full Arabic name and valid E.164 phone number are required");
  const context = { operatorActorId: access.identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };
  try {
    const result = await createOperatorProfile({ fullNameAr, phoneE164 }, context);
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201, headers: noStore });
  } catch (error) {
    const payload = identityErrorPayload(error);
    return denied(identityHttpStatus(error), payload.code, payload.message);
  }
}
