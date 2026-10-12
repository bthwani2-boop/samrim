import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, type HREmployee, isDshClientError, readHREmployee, setHREmploymentStatus } from "../../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readManagedIdentityRole, readOperatorSession, setIdentityRoleEnabled } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

type Params = {params:Promise<{employeeId:string}>};
const denied=(status:number,code:string,message:string)=>NextResponse.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request,context:Params){
 if(!verifySameOrigin(request))return denied(403,"FORBIDDEN","cross-site requests prohibited");
 const session=await readOperatorSession();
 if(!session)return denied(401,"UNAUTHENTICATED","sign in required");
 if(session.role!=="operator"||!session.permissions?.includes("hr"))return denied(403,"FORBIDDEN","HR permission required");
 const id=(await context.params).employeeId;
 if(!/^emp_[a-f0-9]{32}$/.test(id))return denied(400,"INVALID_INPUT","invalid employee");
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
 const status=body?.status;
 const reason=typeof body?.reason==="string"?body.reason.trim():"";
 const expectedVersion=body?.expectedVersion;
 const key=request.headers.get("Idempotency-Key")?.trim()??"";
 if(!body||Object.keys(body).some(k=>!["status","reason","expectedVersion"].includes(k))||
   (status!=="active"&&status!=="inactive")||Array.from(reason).length<8||Array.from(reason).length>500||
   !Number.isSafeInteger(expectedVersion)||(expectedVersion as number)<1||key.length<8||key.length>128)
  return denied(400,"INVALID_INPUT","status, reason, expectedVersion and Idempotency-Key required");
 let employee: HREmployee;
 try{
  const result=await readHREmployee(id,{operatorActorId:session.subject});
  employee=result.employee;
 }catch(error){
  if(isDshClientError(error)){const p=dshErrorPayload(error);return denied(dshHttpStatus(error),p.code,p.message)}
  return denied(502,"HR_UNAVAILABLE","HR is unavailable");
 }
 if(employee.version!==expectedVersion && employee.status!==status)
  return denied(409,"CONFLICT","employee changed; reload before changing employment");
 if(employee.operatorActorId&&!session.canManageOperatorPermissions)
  return denied(403,"FORBIDDEN","Root Owner must withdraw operator access before ending active employment");
 if(status==="inactive"&&employee.operatorActorId){
  const actorId=employee.operatorActorId;
  try{
   const role=await readManagedIdentityRole(actorId,"operator");
   if(role.enabled)await setIdentityRoleEnabled(actorId,"operator",false,"HR employee "+id+": "+reason,
    {operatorActorId:session.subject,correlationId:randomUUID(),expectedVersion:role.roleVersion});
  }catch(error){
   const p=identityErrorPayload(error);
   return denied(identityHttpStatus(error),p.code,p.message);
  }
 }
 try{
  const result=await setHREmploymentStatus(id,{status,reason,expectedVersion:expectedVersion as number},
   {operatorActorId:session.subject,correlationId:randomUUID(),idempotencyKey:key});
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(isDshClientError(error)){const p=dshErrorPayload(error);return denied(dshHttpStatus(error),p.code,p.message)}
  return denied(502,"HR_UNAVAILABLE","HR status update did not complete; operator access may already be disabled. Retry with the same key.");
 }
}
