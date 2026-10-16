import { NextResponse } from "next/server";
import { readOperatorFinancialPolicyRegistry, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
export async function GET() {
 const session=await readOperatorSession();
 if(!session)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(session.role!=="operator"||!session.permissions?.includes("platform_policies"))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 try {
  const value=await readOperatorFinancialPolicyRegistry({operatorActorId:session.subject});
  return NextResponse.json(value,{headers:{"Cache-Control":"no-store"}});
 }catch(e){
  const body=isDshClientError(e)?dshErrorPayload(e):{code:"POLICY_REGISTRY_UNAVAILABLE",message:"Policy registry unavailable"};
  return NextResponse.json({error:body},{status:isDshClientError(e)?dshHttpStatus(e):502});
 }
}
