import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

export async function GET() {
  const actor = await readOperatorSession();
  if (!actor) return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
  if (actor.role !== "operator") return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const denied = operatorWorkspacePermissionDenied(actor,"operations");
  if (denied) return denied;
  try {
    const response = await requestDshJson("GET","/dsh/operator/cancellation-requests?limit=100",undefined,{"X-Acting-Actor-ID":actor.subject});
    return NextResponse.json(response.payload,{headers:{"Cache-Control":"no-store"}});
  } catch(error){
    const payload=isDshClientError(error) ? dshErrorPayload(error) : {code:"INTERNAL_ERROR",message:"cannot read cancellation inbox"};
    return NextResponse.json({error:payload},{status:isDshClientError(error)?dshHttpStatus(error):500});
  }
}
