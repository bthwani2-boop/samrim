import { DshPublicError, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

const employeeId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function isCompanyEmployeeId(id: unknown): id is string {
  return typeof id === "string" && employeeId.test(id);
}

export interface EmployeeRecord {
  id: string;
  displayName: string;
  department: string;
  jobTitle: string;
  startDate: string;
  endDate: string | null;
}

export type EmployeeRegistration = Omit<EmployeeRecord, "id" | "endDate"> & { operationId: string };
// Retain the existing Operator client type names for source compatibility.
export type CompanyEmployee = EmployeeRecord;
export type CompanyEmployeeRegistration = EmployeeRegistration;

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

async function listEmployees(
  owner: string, bearer: string, path: string, cursor?: string, signal?: AbortSignal,
): Promise<{ items: CompanyEmployee[]; nextCursor: string | null }> {
  if (cursor !== undefined && !isCompanyEmployeeId(cursor)) throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const result = await privateOwnerRequest(owner, path + query, bearer, "GET", undefined, signal);
  return parseEmployeePage(result,cursor);
}

export function parseEmployeePage(result: unknown,cursor?: string): {items: CompanyEmployee[]; nextCursor: string | null} {
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

async function getEmployee(
  owner: string, bearer: string, operationPath: string, id: string, signal?: AbortSignal,
): Promise<CompanyEmployee> {
  if (!isCompanyEmployeeId(id)) throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  const path = operationPath.replace("{id}", encodeURIComponent(id));
  const result = await privateOwnerRequest(owner, path, bearer, "GET", undefined, signal);
  return parseEmployeeDetail(result,id);
}

export function parseEmployeeDetail(result:unknown,id:string): EmployeeRecord {
  if (!isEmployee(result) || result.id !== id) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return result;
}

export interface CompanyEmployeeRegistrationAudit {
  employeeId: string;
  registeredByActorId: string;
  recordedAt: string;
}

async function getEmployeeRegistrationAudit(
  owner: string, bearer: string, operationPath: string, id: string, signal?: AbortSignal,
): Promise<CompanyEmployeeRegistrationAudit> {
  if (!isCompanyEmployeeId(id)) throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  const path = operationPath.replace("{id}", encodeURIComponent(id));
  const result = await privateOwnerRequest(owner, path, bearer, "GET", undefined, signal);
  return parseEmployeeRegistrationAudit(result,id);
}

export function parseEmployeeRegistrationAudit(result:unknown,id:string): CompanyEmployeeRegistrationAudit {
  if (!isCompanyEmployeeId(id) || !object(result) || !onlyKeys(result, ["employeeId", "registeredByActorId", "recordedAt"]) ||
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

export function validEmployeeRegistration(input: unknown): input is CompanyEmployeeRegistration {
  return object(input) && onlyKeys(input, ["operationId", "displayName", "department", "jobTitle", "startDate"]) &&
    isCompanyEmployeeId(input.operationId) && validText(input.displayName,120) &&
    validText(input.department,80) && validText(input.jobTitle,80) && validDate(input.startDate) &&
    [input.displayName,input.department,input.jobTitle].every(value => !/\p{Cc}|\uFFFD/u.test(value));
}

async function registerEmployee(
  owner: string, bearer: string, path: string, input: CompanyEmployeeRegistration, signal?: AbortSignal,
): Promise<string> {
  if (!validEmployeeRegistration(input)) {
    throw new DshPublicError(400, "EMPLOYEE_REGISTRATION_INVALID");
  }
  const result = await privateOwnerRequest(owner, path, bearer, "POST", input, signal);
  if (!object(result) || !onlyKeys(result, ["id"]) || !isCompanyEmployeeId(result.id)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result.id;
}


export const listCompanyEmployees = (owner: string,bearer: string,cursor?: string,signal?: AbortSignal) =>
  listEmployees(owner,bearer,dshOperations.listCompanyEmployees.path,cursor,signal);
export const getCompanyEmployee = (owner: string,bearer: string,id: string,signal?: AbortSignal) =>
  getEmployee(owner,bearer,dshOperations.getCompanyEmployee.path,id,signal);
export const getCompanyEmployeeRegistrationAudit = (owner: string,bearer: string,id: string,signal?: AbortSignal) =>
  getEmployeeRegistrationAudit(owner,bearer,dshOperations.getCompanyEmployeeRegistrationAudit.path,id,signal);
export const registerCompanyEmployee = (owner: string,bearer: string,input: CompanyEmployeeRegistration,signal?: AbortSignal) =>
  registerEmployee(owner,bearer,dshOperations.registerCompanyEmployee.path,input,signal);

function merchantEmployeePath(path: string,storeId: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(400,"EMPLOYEE_QUERY_INVALID");
  return path.replace("{storeID}",storeId);
}

export async function listMerchantEmployees(owner: string,bearer: string,storeId: string,cursor?: string,signal?: AbortSignal) {
  return listEmployees(owner,bearer,merchantEmployeePath(dshOperations.listMerchantEmployees.path,storeId),cursor,signal);
}
export async function getMerchantEmployee(owner: string,bearer: string,storeId: string,id: string,signal?: AbortSignal) {
  return getEmployee(owner,bearer,merchantEmployeePath(dshOperations.getMerchantEmployee.path,storeId),id,signal);
}
export async function getMerchantEmployeeRegistrationAudit(owner: string,bearer: string,storeId: string,id: string,signal?: AbortSignal) {
  return getEmployeeRegistrationAudit(owner,bearer,merchantEmployeePath(dshOperations.getMerchantEmployeeRegistrationAudit.path,storeId),id,signal);
}
export async function registerMerchantEmployee(owner: string,bearer: string,storeId: string,input: CompanyEmployeeRegistration,signal?: AbortSignal) {
  return registerEmployee(owner,bearer,merchantEmployeePath(dshOperations.registerMerchantEmployee.path,storeId),input,signal);
}
