import { DshPublicError, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

const employeeId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function isCompanyEmployeeId(id: unknown): id is string {
  return typeof id === "string" && employeeId.test(id);
}

export interface CompanyEmployee {
  id: string;
  displayName: string;
  department: string;
  jobTitle: string;
  startDate: string;
  endDate: string | null;
}

export type CompanyEmployeeRegistration = Omit<CompanyEmployee, "id" | "endDate"> & { operationId: string };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !dateOnly.test(value) || value.startsWith("0000-")) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isEmployee(value: unknown): value is CompanyEmployee {
  return object(value) && onlyKeys(value, ["id", "displayName", "department", "jobTitle", "startDate", "endDate"]) &&
    isCompanyEmployeeId(value.id) && validText(value.displayName, 120) && validText(value.department, 80) &&
    validText(value.jobTitle, 80) && validDate(value.startDate) &&
    (value.endDate === null || (validDate(value.endDate) && value.endDate >= value.startDate));
}

export async function listCompanyEmployees(
  owner: string, bearer: string, cursor?: string, signal?: AbortSignal,
): Promise<{ items: CompanyEmployee[]; nextCursor: string | null }> {
  if (cursor !== undefined && !isCompanyEmployeeId(cursor)) throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const result = await privateOwnerRequest(owner, dshOperations.listCompanyEmployees.path + query, bearer, "GET", undefined, signal);
  if (!object(result) || !onlyKeys(result, ["items", "nextCursor"]) || !Array.isArray(result.items) ||
    result.items.length > 30 || !result.items.every(isEmployee) ||
    (result.nextCursor !== null && (!isCompanyEmployeeId(result.nextCursor) ||
      result.items.length !== 30 || result.nextCursor !== result.items.at(-1)?.id))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const items: CompanyEmployee[] = result.items;
  if (items.some((item, index) => item.id <= (items[index - 1]?.id ?? cursor ?? ""))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return { items, nextCursor: result.nextCursor };
}

export async function getCompanyEmployee(
  owner: string, bearer: string, id: string, signal?: AbortSignal,
): Promise<CompanyEmployee> {
  if (!isCompanyEmployeeId(id)) throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  const path = dshOperations.getCompanyEmployee.path.replace("{id}", encodeURIComponent(id));
  const result = await privateOwnerRequest(owner, path, bearer, "GET", undefined, signal);
  if (!isEmployee(result) || result.id !== id) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return result;
}

export interface CompanyEmployeeRegistrationAudit {
  employeeId: string;
  registeredByActorId: string;
  recordedAt: string;
}

export async function getCompanyEmployeeRegistrationAudit(
  owner: string, bearer: string, id: string, signal?: AbortSignal,
): Promise<CompanyEmployeeRegistrationAudit> {
  if (!isCompanyEmployeeId(id)) throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  const path = dshOperations.getCompanyEmployeeRegistrationAudit.path.replace("{id}", encodeURIComponent(id));
  const result = await privateOwnerRequest(owner, path, bearer, "GET", undefined, signal);
  if (!object(result) || !onlyKeys(result, ["employeeId", "registeredByActorId", "recordedAt"]) ||
    result.employeeId !== id || !validText(result.registeredByActorId, 128) ||
    /\p{Cc}/u.test(result.registeredByActorId) ||
    typeof result.recordedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result.recordedAt) ||
    !validDate(result.recordedAt.slice(0, 10)) || !Number.isFinite(Date.parse(result.recordedAt)) ||
    new Date(result.recordedAt).toISOString().slice(0, 19) !== result.recordedAt.slice(0, 19)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return { employeeId: id, registeredByActorId: result.registeredByActorId, recordedAt: result.recordedAt };
}

export async function registerCompanyEmployee(
  owner: string, bearer: string, input: CompanyEmployeeRegistration, signal?: AbortSignal,
): Promise<string> {
  if (!isCompanyEmployeeId(input.operationId) || !validText(input.displayName, 120) ||
      !validText(input.department, 80) || !validText(input.jobTitle, 80) || !validDate(input.startDate)) {
    throw new DshPublicError(400, "EMPLOYEE_REGISTRATION_INVALID");
  }
  const result = await privateOwnerRequest(owner, dshOperations.registerCompanyEmployee.path, bearer, "POST", input, signal);
  if (!object(result) || !onlyKeys(result, ["id"]) || !isCompanyEmployeeId(result.id)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result.id;
}
