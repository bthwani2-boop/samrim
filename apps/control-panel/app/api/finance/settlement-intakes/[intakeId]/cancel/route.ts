import { NextResponse } from "next/server";
import { cancelOperatorSettlementIntake, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
export async function POST(request: Request,{params}:{params:Promise<{intakeId:string}>}) {
  const identity=await readOperatorSession();
  if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED",message:"authentication required"}},{status:401});
  if(identity.role!=="operator" || !identity.permissions?.includes("finance"))return NextResponse.json({error:{code:"FORBIDDEN",message:"Finance permission required"}},{status:403});
  const {intakeId}=await params;
  const body=await request.json().catch(()=>null) as {reason?:unknown}|null;
  if(typeof body?.reason!=="string" || !body.reason.trim() || body.reason.trim().length>512)return NextResponse.json({error:{code:"INVALID_INPUT",message:"cancellation reason is required"}},{status:400});
  try{
    return NextResponse.json(await cancelOperatorSettlementIntake(intakeId,body.reason,{
      operatorActorId:identity.subject,correlationId:crypto.randomUUID(),idempotencyKey:"settlement_intake_cancel_"+intakeId,
    }),{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(!isDshClientError(error))return NextResponse.json({error:{code:"INTERNAL_ERROR",message:"could not cancel intake"}},{status:500});
    return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
  }
}
