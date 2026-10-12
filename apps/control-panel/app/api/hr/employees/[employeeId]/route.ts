import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, type HRUpdateEmployeeInput, isDshClientError, readHREmployee, updateHREmployee } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

export async function GET(_request: Request, context: {params: Promise<{employeeId: string}>}) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
  if (identity.role !== "operator" || !identity.permissions?.includes("hr"))
    return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const id = (await context.params).employeeId;
  if (!/^emp_[a-f0-9]{32}$/.test(id))
    return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
  try {
    const result = await readHREmployee(id,{operatorActorId:identity.subject});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (!isDshClientError(error))
      return NextResponse.json({error:{code:"HR_UNAVAILABLE"}},{status:502});
    return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error),headers:{"Cache-Control":"no-store"}});
  }
}

export async function PATCH(request: Request, context: {params: Promise<{employeeId: string}>}) {
 if(!verifySameOrigin(request))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const identity=await readOperatorSession();
 if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(identity.role!=="operator"||!identity.permissions?.includes("hr"))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const id=(await context.params).employeeId;
 if(!/^emp_[a-f0-9]{32}$/.test(id))return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 const input=await request.json().catch(()=>null) as Record<string,unknown>|null;
 const allowed=["fullNameAr","phoneE164","department","jobTitle","managerEmployeeId","startDate","workLocation","expectedVersion"];
 if(!input||Object.keys(input).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(input,k))||
  typeof input.fullNameAr!=="string"||typeof input.phoneE164!=="string"||typeof input.department!=="string"||
  typeof input.jobTitle!=="string"||typeof input.managerEmployeeId!=="string"||typeof input.startDate!=="string"||
  typeof input.workLocation!=="string"||!Number.isInteger(input.expectedVersion)||(input.expectedVersion as number)<1)
   return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 const key=request.headers.get("Idempotency-Key")?.trim()??"";
 if(key.length<8||key.length>128)return NextResponse.json({error:{code:"INVALID_INPUT",message:"idempotency key required"}},{status:400});
 try{
  const result=await updateHREmployee(id,input as HRUpdateEmployeeInput,{
   operatorActorId:identity.subject,correlationId:randomUUID(),idempotencyKey:key,
  });
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(!isDshClientError(error))return NextResponse.json({error:{code:"HR_UNAVAILABLE"}},{status:502});
  return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
 }
}
