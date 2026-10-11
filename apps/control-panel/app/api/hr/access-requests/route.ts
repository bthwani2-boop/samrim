import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createHRAccessRequest, dshErrorPayload, dshHttpStatus, isDshClientError, listHRAccessRequests } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

export async function GET(request: Request) {
 const identity=await readOperatorSession();
 if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(identity.role!=="operator"||!identity.permissions?.includes("hr"))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const employeeId=new URL(request.url).searchParams.get("employeeId")??"";
 if(!/^emp_[a-f0-9]{32}$/.test(employeeId))return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 try{
  const page=await listHRAccessRequests({operatorActorId:identity.subject},employeeId);
  return NextResponse.json(page,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(!isDshClientError(error))return NextResponse.json({error:{code:"UNAVAILABLE"}},{status:502});
  return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
 }
}

export async function POST(request: Request) {
 if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site request" } }, { status: 403 });
 const identity = await readOperatorSession();
 if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "sign in required" } }, { status: 401 });
 if (identity.role !== "operator" || !identity.permissions?.includes("hr")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "HR permission required" } }, { status: 403 });
 const body = await request.json().catch(() => null) as Record<string, unknown> | null;
 const permitted = ["operations","partners","catalog","marketing","finance","platform_policies","hr"];
 if (!body || Object.keys(body).some((v) => !["employeeId","reason","requestedPermissions"].includes(v)) ||
  typeof body.employeeId !== "string" || typeof body.reason !== "string" ||
  !Array.isArray(body.requestedPermissions) || body.requestedPermissions.length > 7 ||
  body.requestedPermissions.some((v) => typeof v !== "string" || !permitted.includes(v))) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "invalid access request" } }, { status: 400 });
 }
 const key=request.headers.get("Idempotency-Key")?.trim() ?? "";
 if (key.length < 8 || key.length > 128) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "idempotency key required" } }, { status: 400 });
 try {
  const value=await createHRAccessRequest({ employeeId: body.employeeId, reason: body.reason, requestedPermissions: body.requestedPermissions as string[] }, {
    operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: key,
  });
  return NextResponse.json({ request: value }, { status: 201, headers: { "Cache-Control": "no-store" } });
 } catch(error) {
  if (!isDshClientError(error)) return NextResponse.json({ error: { code: "UNAVAILABLE", message: "HR is unavailable" } }, { status: 502 });
  return NextResponse.json({ error: dshErrorPayload(error) }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
 }
}
