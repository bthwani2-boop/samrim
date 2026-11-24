import { DshPublicError, type EmployeeRegistration, getMerchantEmployee, getMerchantEmployeeRegistrationAudit, isCompanyEmployeeId, listMerchantEmployees, parseEmployeeDetail, parseEmployeePage, parseEmployeeRegistrationAudit, registerMerchantEmployee, validEmployeeRegistration } from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

function object(value: unknown): Record<string,unknown> | null {
  return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : null;
}
async function request(actorId: string,storeId: string,signal: AbortSignal,cursor?: string,input?: EmployeeRegistration,employeeId?:string) {
  const writing=!!input;
  if (!actorId || !/^[a-z0-9-]{1,64}$/.test(storeId) || (cursor!==undefined && !isCompanyEmployeeId(cursor)) ||
    (input && !validEmployeeRegistration(input)) || (employeeId!==undefined && (!isCompanyEmployeeId(employeeId)||writing||cursor!==undefined))) throw new DshPublicError(400,"EMPLOYEE_QUERY_INVALID");
  signal.throwIfAborted();
  const query=new URLSearchParams({employees:storeId});
  if(cursor)query.set("cursor",cursor);
  if(employeeId)query.set("employeeId",employeeId);
  let reply: Response;
  try {
    reply=await fetch("/api/admission?"+query,{method:writing?"POST":"GET",signal,
      credentials:"same-origin",cache:"no-store",redirect:"error",
      headers:{"X-Merchant-Context":actorId,...(writing?{"Content-Type":"application/json"}:{})},
      ...(writing?{body:JSON.stringify(input)}:{})});
  } catch {
    throw new DshPublicError(0,writing?"OPERATION_RESULT_UNKNOWN":"OWNER_UNAVAILABLE");
  }
  let payload:unknown;
  try{payload=await reply.json();}catch{throw new DshPublicError(502,writing?"OPERATION_RESULT_UNKNOWN":"OWNER_RESPONSE_INVALID");}
  if(signal.aborted)throw new DshPublicError(0,writing?"OPERATION_RESULT_UNKNOWN":"OWNER_RESPONSE_STALE");
  const body=object(payload);
  if(!reply.ok)throw new DshPublicError(reply.status,writing&&reply.status>=500?"OPERATION_RESULT_UNKNOWN":
    typeof body?.code==="string"?body.code:"OWNER_UNAVAILABLE");
  const result=object(body?.[writing?"employee":"employees"]);
  if(reply.status!==200 || reply.headers.get("Cache-Control")?.toLowerCase().split(",").map(x=>x.trim()).includes("no-store")!==true ||
    !result || Object.keys(result).length!==3 || result.actorId!==actorId || result.storeId!==storeId) {
    throw new DshPublicError(502,writing?"OPERATION_RESULT_UNKNOWN":"OWNER_RESPONSE_INVALID");
  }
  return result;
}
export async function readEmployees(actorId:string,storeId:string,signal:AbortSignal,cursor?:string) {
  if(Platform.OS!=="web")return withNativeMerchantSession(signal,(bearer,origin)=>
    listMerchantEmployees(origin,bearer,storeId,cursor,signal),actorId);
  return parseEmployeePage((await request(actorId,storeId,signal,cursor)).page,cursor);
}
export async function readEmployeeDetail(actorId:string,storeId:string,id:string,signal:AbortSignal) {
  if(!isCompanyEmployeeId(id))throw new DshPublicError(400,"EMPLOYEE_QUERY_INVALID");
  if(Platform.OS!=="web")return withNativeMerchantSession(signal,async(bearer,origin)=>{
    const employee=await getMerchantEmployee(origin,bearer,storeId,id,signal);
    const audit=await getMerchantEmployeeRegistrationAudit(origin,bearer,storeId,id,signal);
    return {employee,audit};
  },actorId);
  const detail=object((await request(actorId,storeId,signal,undefined,undefined,id)).detail);
  if(!detail || Object.keys(detail).length!==2)throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  return {employee:parseEmployeeDetail(detail.employee,id),audit:parseEmployeeRegistrationAudit(detail.audit,id)};
}
export async function saveEmployee(actorId:string,storeId:string,input:EmployeeRegistration,signal:AbortSignal) {
  if(Platform.OS!=="web")return withNativeMerchantSession(signal,(bearer,origin)=>
    registerMerchantEmployee(origin,bearer,storeId,input,signal),actorId,true);
  const result=await request(actorId,storeId,signal,undefined,input);
  if(!isCompanyEmployeeId(result.id))throw new DshPublicError(502,"OPERATION_RESULT_UNKNOWN");
  return result.id;
}
