import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../../../../src/server/dsh/dsh-bff";
import { currentOperatorAccessTokenForDsh, readOperatorSession } from "../../../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../../../src/server/identity/operator-workspace-access";

const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, context: { params: Promise<{orderId:string; messageId:string}> }) {
  const actor = await readOperatorSession();
  if (!actor || actor.role !== "operator" || operatorWorkspacePermissionDenied(actor, "operations")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "operations permission required" } }, { status: 403, headers: noStore });
  }
  const token=await currentOperatorAccessTokenForDsh();
  if (!token) return NextResponse.json({error:{code:"UNAUTHENTICATED",message:"operator session required"}},{status:401,headers:noStore});
  const {orderId,messageId}=await context.params;
  if (!orderId || !messageId || orderId.length>128 || messageId.length>128) return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400,headers:noStore});
  try {
    const path=`/dsh/orders/${encodeURIComponent(orderId)}/conversation/messages/${encodeURIComponent(messageId)}/media`;
    const result=await requestDshJson("GET",path,undefined,{},token);
    return NextResponse.json(result.payload,{status:result.status,headers:noStore});
  } catch (error) {
    const payload=dshErrorPayload(error);
    return NextResponse.json({error:payload},{status:isDshClientError(error)?dshHttpStatus(error):500,headers:noStore});
  }
}
