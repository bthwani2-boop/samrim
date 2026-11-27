import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export interface MerchantStoreProfile {
  storeId: string; actorId: string; name: string; description: string; published: boolean; version: number;
}
export interface MerchantStoreProfileChange {
  operationId: string; expectedVersion: number; name: string; description: string;
}
export interface MerchantStoreProfileResult { profile: MerchantStoreProfile; replay: boolean }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value === value.trim() && Array.from(value).length >= min &&
    Array.from(value).length <= max && !/[\p{Cc}\p{Cs}]/u.test(value);
}
function version(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}
export function validMerchantStoreProfileChange(value: unknown): value is MerchantStoreProfileChange {
  const c = record(value);
  return c !== null && exact(c, ["operationId","expectedVersion","name","description"]) &&
    typeof c.operationId === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(c.operationId) &&
    version(c.expectedVersion) && c.expectedVersion < Number.MAX_SAFE_INTEGER &&
    validText(c.name,1,120) && validText(c.description,0,1000);
}
export function parseMerchantStoreProfile(value: unknown, storeId: string, actorId: string): MerchantStoreProfile {
  const p=record(value);
  if (!p || !exact(p,["storeId","actorId","name","description","published","version"]) ||
      p.storeId!==storeId || p.actorId!==actorId || !validText(p.name,1,120) ||
      !validText(p.description,0,1000) || typeof p.published!=="boolean" || !version(p.version)) {
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  }
  return p as unknown as MerchantStoreProfile;
}
export function confirmMerchantStoreProfileResult(value: unknown, storeId: string, actorId: string, change: MerchantStoreProfileChange): MerchantStoreProfileResult {
  try {
    const result=record(value);
    if (!result || !exact(result,["profile","replay"]) || typeof result.replay!=="boolean") throw new Error("invalid receipt");
    const p=parseMerchantStoreProfile(result.profile,storeId,actorId);
    if (p.published || p.version!==change.expectedVersion+1 || p.name!==change.name || p.description!==change.description) throw new Error("mismatched receipt");
    return {profile:p,replay:result.replay};
  } catch { throw new DshPublicError(502,"OPERATION_RESULT_UNKNOWN"); }
}
function pathFor(path: string, storeId: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(400,"STORE_ID_INVALID");
  return path.replace("{storeID}",storeId);
}
export async function getMerchantStoreProfile(origin:string,storeId:string,actorId:string,bearer:string,signal?:AbortSignal):Promise<MerchantStoreProfile> {
  const body=await privateOwnerRequest(origin,pathFor(dshOperations.getMerchantStoreProfile.path,storeId),bearer,"GET",undefined,signal);
  return parseMerchantStoreProfile(body,storeId,actorId);
}
export async function changeMerchantStoreProfile(origin:string,storeId:string,actorId:string,bearer:string,change:MerchantStoreProfileChange,signal?:AbortSignal):Promise<MerchantStoreProfileResult> {
  if (!validMerchantStoreProfileChange(change)) throw new DshPublicError(400,"INVALID_STORE_PROFILE");
  const body=await privateOwnerRequest(origin,pathFor(dshOperations.changeMerchantStoreProfile.path,storeId),bearer,"PATCH",change,signal);
  return confirmMerchantStoreProfileResult(body,storeId,actorId,change);
}
