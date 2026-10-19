import { NextResponse } from "next/server";
import { convertOperatorSettlementIntake, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function POST(_request: Request, {params}: {params:Promise<{intakeId:string}>}) {
  const identity=await readOperatorSession();
  if (!identity) return NextResponse.json({error:{code:"UNAUTHENTICATED",message:"authentication is required"}},{status:401});
  if (identity.role!=="operator" || !identity.permissions?.includes("finance")) return NextResponse.json({error:{code:"FORBIDDEN",message:"Finance permission is required"}},{status:403});
  const {intakeId}=await params;
  try {
    return NextResponse.json(await convertOperatorSettlementIntake(intakeId,{
      operatorActorId:identity.subject,
      correlationId:crypto.randomUUID(),
      idempotencyKey:"settlement_intake_convert_"+intakeId,
    }),{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (!isDshClientError(error)) return NextResponse.json({error:{code:"INTERNAL_ERROR",message:"settlement request could not be converted"}},{status:500});
    return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
  }
}
