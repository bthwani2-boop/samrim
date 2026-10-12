import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createHRIdentityProfile, dshErrorPayload, dshHttpStatus } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

// DSH owns and verifies the HR claim before its trusted Identity service call.
export async function POST(request: Request, context: { params: Promise<{requestId: string}> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
  if (identity.role !== "operator" || !identity.canManageOperatorPermissions)
    return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const id = (await context.params).requestId;
  if (!/^hreq_[a-f0-9]{32}$/.test(id)) return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
  try {
    const result = await createHRIdentityProfile(id, {
      operatorActorId: identity.subject,
      correlationId: randomUUID(),
      idempotencyKey: `hr-create-profile-${id}`,
    });
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
  }
}
