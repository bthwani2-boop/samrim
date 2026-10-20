import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

export async function POST(request: Request, context: {params:Promise<{requestId:string}>}) {
  if (!verifySameOrigin(request)) return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const actor = await readOperatorSession();
  if (!actor) return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
  if(actor.role !== "operator") return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const denied=operatorWorkspacePermissionDenied(actor,"operations");
  if(denied) return denied;
  const {requestId}=await context.params;
  const body=await request.json().catch(()=>null) as {reason?:unknown}|null;
  const reason=typeof body?.reason==="string"?body.reason.trim():"";
  if (!requestId || requestId.length>128 || Array.from(reason).length<12 || Array.from(reason).length>500) return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
  try {
    const response=await requestDshJson("POST",`/dsh/operator/cancellation-requests/${encodeURIComponent(requestId)}/decline`,{reason},{"X-Acting-Actor-ID":actor.subject});
    return NextResponse.json(response.payload,{headers:{"Cache-Control":"no-store"}});
  } catch(error){
    const payload=isDshClientError(error)?dshErrorPayload(error):{code:"INTERNAL_ERROR",message:"decision unknown; refresh request before retry"};
    return NextResponse.json({error:payload},{status:isDshClientError(error)?dshHttpStatus(error):500});
  }
}
