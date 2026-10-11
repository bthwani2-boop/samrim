import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { decideHRAccessRequest, dshErrorPayload, dshHttpStatus, isDshClientError, linkHRAccessRequest, readHRAccessRequest, readHREmployee } from "../../../../../../src/server/dsh/dsh-bff";
import { createOperatorProfile, identityErrorPayload, identityHttpStatus, readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

export async function POST(request: Request, context: {params: Promise<{requestId: string}>}) {
 if (!verifySameOrigin(request)) return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const identity=await readOperatorSession();
 if (!identity) return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if (identity.role !== "operator" || !identity.canManageOperatorPermissions) return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const id=(await context.params).requestId;
 if (!/^hreq_[a-f0-9]{32}$/.test(id)) return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 try {
  const {request: record}=await readHRAccessRequest(id,{operatorActorId:identity.subject});
  if (record.state === "identity_profile_created" && record.operatorProfileId) {
   return NextResponse.json({request:record},{headers:{"Cache-Control":"no-store"}});
  }
  if (!["pending_review","identity_provisioning"].includes(record.state) || !record.phoneE164 || !record.employeeName || !record.jobTitle || !record.department)
   return NextResponse.json({error:{code:"CONFLICT",message:"Employee is not eligible for operator review"}},{status:409});
  if(record.state==="pending_review"){
   const {employee: current}=await readHREmployee(record.employeeId,{operatorActorId:identity.subject});
   if(current.fullNameAr!==record.employeeName || current.phoneE164!==record.phoneE164 ||
      current.department!==record.department || current.jobTitle!==record.jobTitle){
     return NextResponse.json({error:{code:"CONFLICT",message:"Employee details changed after the access request; new review is required."}},{status:409});
   }
   // Claim before crossing services. Rejection cannot race after this claim.
   await decideHRAccessRequest(id,"provision",{expectedVersion:record.version},{
    operatorActorId:identity.subject,correlationId:randomUUID(),idempotencyKey:`hr-provision-${id}`,
   });
  }
  // Retried requests resume the same deterministic Identity operation.
  // Stable idempotency protects a partial failure between Identity and DSH.
  const result=await createOperatorProfile({
    fullNameAr:record.employeeName,phoneE164:record.phoneE164,
    jobTitle:record.jobTitle,department:record.department,
  },{
    operatorActorId:identity.subject,correlationId:randomUUID(),idempotencyKey:`hr-profile-${id}`,
  });
  const linked=await linkHRAccessRequest(id,result.profile.id,{
    operatorActorId:identity.subject,correlationId:randomUUID(),idempotencyKey:`hr-link-${id}`,
  });
  return NextResponse.json({request:linked,profile:result.profile},{headers:{"Cache-Control":"no-store"}});
 } catch(error) {
  if(isDshClientError(error)) return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
  // Identity errors are returned as errors; do not create an alternative operator profile.
  return NextResponse.json({error:identityErrorPayload(error)},{status:identityHttpStatus(error)});
 }
}
