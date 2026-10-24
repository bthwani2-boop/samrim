import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorPartnerTeam } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
const headers={"Cache-Control":"private, no-store"};
function fail(code:string,status:number){return NextResponse.json({error:{code,message:"تعذر قراءة فريق الشريك."}},{status,headers});}
export async function GET(request:Request,context:{params:Promise<{actorId:string}>}){
 const identity=await readOperatorSession();
 if(!identity)return fail("UNAUTHENTICATED",401);
 if(identity.role!=="operator")return fail("FORBIDDEN",403);
 const denied=operatorWorkspacePermissionDenied(identity,"partners");
 if(denied)return denied;
 const {actorId}=await context.params;
 const q=new URL(request.url).searchParams;
 const storeId=q.get("storeId")??"",cursor=q.get("cursor")??"",raw=q.get("limit")??"25";
 const limit=/^\d+$/.test(raw)?Number(raw):NaN;
 if(!actorId||actorId.length>128||storeId.length>128||cursor.length>512||!Number.isInteger(limit)||limit<1||limit>50)return fail("INVALID_INPUT",400);
 try{
  const page=await listOperatorPartnerTeam(actorId,storeId,limit,cursor,{operatorActorId:identity.subject});
  if(!Array.isArray(page.items)||page.items.length>limit||!page.counts||page.counts.total<page.items.length)return fail("DSH_VERSION_MISMATCH",502);
  return NextResponse.json(page,{headers});
 }catch(error){
  if(isDshClientError(error)){const payload=dshErrorPayload(error);return NextResponse.json({error:payload},{status:dshHttpStatus(error),headers});}
  return fail("INTERNAL_ERROR",500);
 }
}
