import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type FavoriteStoreState = Readonly<{ actorId: string; storeId: string; favorite: boolean }>;
export type FavoriteStorePage = Readonly<{ actorId: string; storeIds: string[]; nextCursor?: string }>;
const idRule = /^[a-z0-9-]{1,64}$/;
const bearerRule = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
export function isFavoriteStoreId(value: unknown): value is string { return typeof value === "string" && idRule.test(value); }
function invalid(): never { throw new DshPublicError(502,"OWNER_RESPONSE_INVALID"); }
function validateBearer(bearer: string) {
  if (!bearerRule.test(bearer)) throw new DshPublicError(401,"UNAUTHENTICATED");
}
export function parseFavoriteStoreState(value: unknown, actor: string, id: string, expected?: boolean): FavoriteStoreState {
  if (!obj(value) || !exact(value,["actorId","storeId","favorite"]) || value.actorId !== actor ||
    value.storeId !== id || !isFavoriteStoreId(id) || typeof value.favorite !== "boolean" ||
    (expected !== undefined && value.favorite !== expected)) invalid();
  return {actorId:actor,storeId:id,favorite:value.favorite};
}
export function parseFavoriteStorePage(value: unknown, actor: string, after = ""): FavoriteStorePage {
  if (!obj(value) || !exact(value,value.nextCursor === undefined ? ["actorId","storeIds"] : ["actorId","storeIds","nextCursor"]) ||
    value.actorId !== actor || !Array.isArray(value.storeIds) || value.storeIds.length > 20 ||
    !value.storeIds.every(isFavoriteStoreId)) invalid();
  let previous = after;
  for (const id of value.storeIds) { if (id <= previous) invalid(); previous = id; }
  if (value.nextCursor !== undefined && (value.storeIds.length !== 20 || value.nextCursor !== previous)) invalid();
  return value as FavoriteStorePage;
}
export async function listCustomerFavoriteStores(origin: string,bearer: string,actor: string,after?: string,signal?: AbortSignal) {
  validateBearer(bearer);
  if (after !== undefined && !isFavoriteStoreId(after)) throw new DshPublicError(400,"INVALID_REQUEST");
  const path = dshOperations.listCurrentCustomerFavoriteStores.path;
  return parseFavoriteStorePage(await privateOwnerRequest(origin,after ? path+"?after="+after : path,bearer,"GET",undefined,signal),actor,after);
}
export async function getCustomerFavoriteStore(origin: string,bearer: string,actor: string,id: string,signal?: AbortSignal) {
  validateBearer(bearer);
  if (!isFavoriteStoreId(id)) throw new DshPublicError(400,"INVALID_REQUEST");
  const path = dshOperations.getCurrentCustomerFavoriteStore.path.replace("{storeID}",id);
  return parseFavoriteStoreState(await privateOwnerRequest(origin,path,bearer,"GET",undefined,signal),actor,id);
}
export async function setCustomerFavoriteStore(origin: string,bearer: string,actor: string,id: string,favorite: boolean,signal?: AbortSignal) {
  validateBearer(bearer);
  if (!isFavoriteStoreId(id) || typeof favorite !== "boolean") throw new DshPublicError(400,"INVALID_REQUEST");
  const path = dshOperations.setCurrentCustomerFavoriteStore.path.replace("{storeID}",id);
  try {
    return parseFavoriteStoreState(await privateOwnerRequest(origin,path,bearer,"PUT",{favorite},signal),actor,id,favorite);
  } catch(error) {
    if (error instanceof DshPublicError && [400,401,403,404].includes(error.status)) throw error;
    throw new DshPublicError(503,"OPERATION_RESULT_UNKNOWN");
  }
}
