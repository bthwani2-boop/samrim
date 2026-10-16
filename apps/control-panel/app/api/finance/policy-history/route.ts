import { NextResponse } from "next/server";
import { listOperatorPolicyHistory, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
export async function GET(request:Request){
 const identity=await readOperatorSession();
 if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(identity.role!=="operator"||!identity.permissions?.includes("platform_policies"))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const qs=new URL(request.url).searchParams;
 const key=qs.get("key")??"";
 const scope=qs.get("scopeId")??"";
 if(key==="partner-financial-terms"&&!identity.permissions?.includes("finance"))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 if(!["service-cities","wallet-providers","delivery-fees","field-acquisition","partner-financial-terms","captain-minimum-balance"].includes(key)||scope.length>128)
  return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 try{
  const result=await listOperatorPolicyHistory(key,scope,{operatorActorId:identity.subject});
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(e){
  const body=isDshClientError(e)?dshErrorPayload(e):{code:"HISTORY_UNAVAILABLE",message:"History unavailable"};
  return NextResponse.json({error:body},{status:isDshClientError(e)?dshHttpStatus(e):502});
 }
}
