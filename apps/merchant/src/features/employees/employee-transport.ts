import {
  DshPublicError, type EmployeeEndState, type EmployeeRegistration,
  getMerchantEmployee, getMerchantEmployeeRegistrationAudit, isCompanyEmployeeId,
  listMerchantEmployees, parseEmployeeDetail, parseEmployeePage, parseEmployeeRegistrationAudit,
  registerMerchantEmployee, validEmployeeEndState, validEmployeeRegistration,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

type EmployeeRequest =
  | { kind: "list"; cursor: string | undefined; endState: EmployeeEndState | undefined }
  | { kind: "detail"; employeeId: string }
  | { kind: "register"; input: EmployeeRegistration };

function validate(actorId: string, storeId: string, request: EmployeeRequest) {
  if (!actorId || !/^[a-z0-9-]{1,64}$/.test(storeId) ||
    (request.kind === "list" && (
      (request.cursor !== undefined && !isCompanyEmployeeId(request.cursor)) ||
      (request.endState !== undefined && !validEmployeeEndState(request.endState)))) ||
    (request.kind === "detail" && !isCompanyEmployeeId(request.employeeId)) ||
    (request.kind === "register" && !validEmployeeRegistration(request.input))) {
    throw new DshPublicError(400, "EMPLOYEE_QUERY_INVALID");
  }
}

async function webRequest(actorId: string, storeId: string, signal: AbortSignal, request: EmployeeRequest) {
  const writing = request.kind === "register";
  const query = new URLSearchParams({ employees: storeId });
  if (request.kind === "list") {
    if (request.cursor) query.set("cursor", request.cursor);
    if (request.endState) query.set("endState", request.endState);
  } else if (request.kind === "detail") {
    query.set("employeeId", request.employeeId);
  }
  const { document } = await requestMerchantOwnerDocument({
    query, actorId, signal,
    method: writing ? "POST" : "GET",
    change: request.kind === "register" ? request.input : undefined,
    byteLimit: writing ? 64 * 1024 : 256 * 1024,
  });
  const result = object(document[writing ? "employee" : "employees"]);
  if (!result || Object.keys(result).length !== 3 ||
    result.actorId !== actorId || result.storeId !== storeId) {
    throw new DshPublicError(502, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  return result;
}

export async function readEmployees(actorId: string, storeId: string, signal: AbortSignal,
  cursor?: string, endState?: EmployeeEndState) {
  const request = { kind: "list", cursor, endState } as const;
  validate(actorId, storeId, request);
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      listMerchantEmployees(origin, bearer, storeId, cursor, signal, endState), actorId);
  }
  return parseEmployeePage((await webRequest(actorId, storeId, signal, request)).page, cursor, endState);
}

export async function readEmployeeDetail(actorId: string, storeId: string, id: string, signal: AbortSignal) {
  const request = { kind: "detail", employeeId: id } as const;
  validate(actorId, storeId, request);
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, async (bearer, origin) => {
      const employee = await getMerchantEmployee(origin, bearer, storeId, id, signal);
      const audit = await getMerchantEmployeeRegistrationAudit(origin, bearer, storeId, id, signal);
      return { employee, audit };
    }, actorId);
  }
  const detail = object((await webRequest(actorId, storeId, signal, request)).detail);
  if (!detail || Object.keys(detail).length !== 2) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return { employee: parseEmployeeDetail(detail.employee, id), audit: parseEmployeeRegistrationAudit(detail.audit, id) };
}

export async function saveEmployee(actorId: string, storeId: string, input: EmployeeRegistration, signal: AbortSignal) {
  const request = { kind: "register", input } as const;
  validate(actorId, storeId, request);
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    return withNativeMerchantSession(signal, (bearer, origin) =>
      registerMerchantEmployee(origin, bearer, storeId, input, signal), actorId, true);
  }
  const result = await webRequest(actorId, storeId, signal, request);
  if (!isCompanyEmployeeId(result.id)) throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  return result.id;
}
