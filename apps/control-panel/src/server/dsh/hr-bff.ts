import { type HRAccessRequest as DshHRAccessRequest, type HRAccessRequestInput as DshHRAccessRequestInput, type HRAccessRequestMutationResponse as DshHRAccessRequestMutationResponse, type HRAccessRequestPage as DshHRAccessRequestPage, type HRAccessRequestReadResponse as DshHRAccessRequestReadResponse, type HREmployee as DshHREmployee, type HREmployeePage as DshHREmployeePage, type HRUpdateEmployeeRequest as DshHRUpdateEmployeeRequest, type HRUpdateEmployeeResponse as DshHRUpdateEmployeeResponse, type HRCreateEmployeeRequest } from "@bthwani/dsh";
import { requestDshJson, validateAttributedMutationContext, type DshOperatorReadContext, type JoiningCaseMutationContext } from "./dsh-transport";

export type HREmployee = DshHREmployee;
export type HREmployeeInput = HRCreateEmployeeRequest;
export type HREmployeePage = DshHREmployeePage;
export type HRSummary = Readonly<{
  total: number;
  active: number;
  inactive: number;
  linked: number;
  departments: ReadonlyArray<Readonly<{ name: string; count: number }>>;
}>;
export function readHRSummary(context: DshOperatorReadContext): Promise<HRSummary> {
  return requestDshJson<HRSummary>("GET", "/dsh/hr/summary", undefined, { "X-Acting-Actor-ID": context.operatorActorId }).then((response) => response.payload);
}
export type HRListFilters = Readonly<{ department?: string; jobTitle?: string; status?: string; linked?: string }>;
export function listHREmployees(q: string, cursor: string, context: DshOperatorReadContext, limit = 25, filters: HRListFilters = {}): Promise<HREmployeePage> {
  const search = new URLSearchParams({ q, cursor, limit: String(limit) });
  if (filters.department) search.set("department", filters.department);
  if (filters.jobTitle) search.set("jobTitle", filters.jobTitle);
  if (filters.status) search.set("status", filters.status);
  if (filters.linked) search.set("linked", filters.linked);
  return requestDshJson<HREmployeePage>("GET", `/dsh/hr/employees?${search}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId }).then((response) => response.payload);
}
export function readHREmployee(id: string, context: DshOperatorReadContext): Promise<Readonly<{ employee: HREmployee }>> {
  return requestDshJson<Readonly<{ employee: HREmployee }>>("GET", `/dsh/hr/employees/${encodeURIComponent(id)}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId }).then((response) => response.payload);
}
export function createHREmployee(input: HREmployeeInput, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: Readonly<{ employee: HREmployee; idempotentReplay: boolean }> }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_IDEMPOTENCY_KEY_MISSING");
  return requestDshJson<Readonly<{ employee: HREmployee; idempotentReplay: boolean }>>("POST", "/dsh/hr/employees", input, {
    "X-Acting-Actor-ID": context.operatorActorId,
    "X-Correlation-ID": context.correlationId,
    "Idempotency-Key": context.idempotencyKey,
  });
}

export type HRUpdateEmployeeInput = DshHRUpdateEmployeeRequest;
export async function updateHREmployee(id: string, input: HRUpdateEmployeeInput, context: JoiningCaseMutationContext): Promise<DshHRUpdateEmployeeResponse> {
 validateAttributedMutationContext(context);
 const response=await requestDshJson<DshHRUpdateEmployeeResponse>("PATCH",`/dsh/hr/employees/${encodeURIComponent(id)}`,input,{
  "X-Acting-Actor-ID":context.operatorActorId,"X-Correlation-ID":context.correlationId,"Idempotency-Key":context.idempotencyKey,
 });
 return response.payload;
}
export async function readHREmployeeByOperatorActor(actorId:string,context:DshOperatorReadContext):Promise<Readonly<{employee:HREmployee}>> {
 return (await requestDshJson<Readonly<{employee:HREmployee}>>("GET",
  `/dsh/hr/operator-employees/${encodeURIComponent(actorId)}`,undefined,
  {"X-Acting-Actor-ID":context.operatorActorId})).payload;
}
export type HREmployeeEvent = Readonly<{eventType:"created"|"updated"|"status_changed";actingActorId:string;reason?:string;createdAt:string}>;
export type HREmployeeEventsPage = Readonly<{items:readonly HREmployeeEvent[];nextCursor?:string}>;
export async function listHREmployeeEvents(id:string,cursor:string,context:DshOperatorReadContext):Promise<HREmployeeEventsPage>{
 const params=new URLSearchParams({limit:"25",cursor});
 return (await requestDshJson<HREmployeeEventsPage>("GET",
  `/dsh/hr/employees/${encodeURIComponent(id)}/events?${params}`,undefined,
  {"X-Acting-Actor-ID":context.operatorActorId})).payload;
}
export type HRAttendanceStatus = "present" | "absent" | "late" | "leave";
export type HRAttendanceInput = Readonly<{date:string;status:HRAttendanceStatus;note:string;checkInAt?:string;checkOutAt?:string;expectedVersion:number}>;
export type HRAttendanceRecord = Readonly<{employeeId:string;date:string;status:HRAttendanceStatus;note:string;checkInAt?:string;checkOutAt?:string;version:number;recordedByActorId:string;recordedAt:string}>;
export type HRAttendancePage = Readonly<{items:readonly HRAttendanceRecord[]}>;
export async function listHRAttendance(id:string,from:string,to:string,context:DshOperatorReadContext):Promise<HRAttendancePage>{
 const qs=new URLSearchParams({from,to});
 return (await requestDshJson<HRAttendancePage>("GET",`/dsh/hr/employees/${encodeURIComponent(id)}/attendance?${qs}`,undefined,
 {"X-Acting-Actor-ID":context.operatorActorId})).payload;
}
export async function recordHRAttendance(id:string,input:HRAttendanceInput,context:JoiningCaseMutationContext):Promise<Readonly<{record:HRAttendanceRecord;idempotentReplay:boolean}>>{
 validateAttributedMutationContext(context);
 return (await requestDshJson<Readonly<{record:HRAttendanceRecord;idempotentReplay:boolean}>>("POST",
 `/dsh/hr/employees/${encodeURIComponent(id)}/attendance`,input,
 {"X-Acting-Actor-ID":context.operatorActorId,"X-Correlation-ID":context.correlationId,
 "Idempotency-Key":context.idempotencyKey})).payload;
}
export type HREmploymentStatusInput = Readonly<{status:"active"|"inactive";reason:string;expectedVersion:number}>;
export async function setHREmploymentStatus(id:string,input:HREmploymentStatusInput,context:JoiningCaseMutationContext):Promise<Readonly<{employee:HREmployee;idempotentReplay:boolean}>> {
 validateAttributedMutationContext(context);
 const response=await requestDshJson<Readonly<{employee:HREmployee;idempotentReplay:boolean}>>("POST",
  `/dsh/hr/employees/${encodeURIComponent(id)}/employment-status`,input,
  {"X-Acting-Actor-ID":context.operatorActorId,"X-Correlation-ID":context.correlationId,"Idempotency-Key":context.idempotencyKey});
 return response.payload;
}
export type HRAccessRequest = DshHRAccessRequest;
export type HRAccessRequestInput = DshHRAccessRequestInput;
export type HRAccessRequestPage = DshHRAccessRequestPage;
export async function listHRAccessRequests(context: DshOperatorReadContext, employeeId = "", cursor = ""): Promise<HRAccessRequestPage> {
  const params = new URLSearchParams({ employeeId, cursor, limit: "25" });
  const response = await requestDshJson<HRAccessRequestPage>("GET", `/dsh/hr/access-requests?${params}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId });
  return response.payload;
}
export async function readHRAccessRequestByProfile(profileId: string, context: DshOperatorReadContext): Promise<DshHRAccessRequestReadResponse> {
  return (await requestDshJson<DshHRAccessRequestReadResponse>("GET",
    "/dsh/hr/access-requests/by-profile/" + encodeURIComponent(profileId), undefined,
    { "X-Acting-Actor-ID": context.operatorActorId })).payload;
}

export async function admitHROperator(requestId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ employee: HREmployee; request: HRAccessRequest; idempotentReplay: boolean }>> {
  validateAttributedMutationContext(context);
  return (await requestDshJson<Readonly<{ employee: HREmployee; request: HRAccessRequest; idempotentReplay: boolean }>>("POST",
    "/dsh/hr/access-requests/" + encodeURIComponent(requestId) + "/admit", {}, {
      "X-Acting-Actor-ID": context.operatorActorId,
      "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey,
    })).payload;
}

export async function readHRAccessRequest(id: string, context: DshOperatorReadContext): Promise<DshHRAccessRequestReadResponse> {
  const response = await requestDshJson<DshHRAccessRequestReadResponse>("GET", `/dsh/hr/access-requests/${encodeURIComponent(id)}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId });
  return response.payload;
}
export async function createHRAccessRequest(input: HRAccessRequestInput, context: JoiningCaseMutationContext): Promise<HRAccessRequest> {
  validateAttributedMutationContext(context);
  const response = await requestDshJson<DshHRAccessRequestMutationResponse>("POST", "/dsh/hr/access-requests", input, {
    "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey,
  });
  return response.payload.request;
}
export async function decideHRAccessRequest(id: string, operation: "reject" | "provision", input: {expectedVersion:number;reason?:string}, context: JoiningCaseMutationContext): Promise<HRAccessRequest> {
 validateAttributedMutationContext(context);
 const response=await requestDshJson<DshHRAccessRequestMutationResponse>("POST",`/dsh/hr/access-requests/${encodeURIComponent(id)}/${operation}`,input,{
  "X-Acting-Actor-ID":context.operatorActorId,"X-Correlation-ID":context.correlationId,"Idempotency-Key":context.idempotencyKey,
 });
 return response.payload.request;
}
export async function createHRIdentityProfile(id: string, context: JoiningCaseMutationContext): Promise<Readonly<{request: HRAccessRequest; profile?: Readonly<{id: string}>}>> {
  validateAttributedMutationContext(context);
  const response = await requestDshJson<Readonly<{request: HRAccessRequest; profile?: Readonly<{id: string}>}>>("POST",
    `/dsh/hr/access-requests/${encodeURIComponent(id)}/create-profile`, {}, {
      "X-Acting-Actor-ID": context.operatorActorId,
      "X-Correlation-ID": context.correlationId,
      "Idempotency-Key": context.idempotencyKey,
    });
  return response.payload;
}
