import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type CustomerAddress = Readonly<{ id: string; cityId: string; label: string; details: string;
  latitude: number; longitude: number; version: number }>;
export type CustomerAddressChange = Readonly<Omit<CustomerAddress,"id"|"version"> & { expectedVersion: number }>;
export type CustomerAddressPage = Readonly<{ actorId: string; items: CustomerAddress[]; nextCursor?: string }>;
export type CustomerAddressRead = Readonly<{ actorId: string; address: CustomerAddress }>;
export type CustomerAddressResult = Readonly<{ actorId: string; address: CustomerAddress; replay: boolean }>;
const idRule = /^addr-[a-f0-9]{32}$/;
const cityRule = /^[a-z0-9-]{1,64}$/;
const bearerRule = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const obj = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string,unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const text = (v: unknown,max: number): v is string => typeof v === "string" && v.trim().length > 0 &&
  [...v].length <= max && !/[\p{Cc}\uD800-\uDFFF]/u.test(v);
const coordinate = (v: unknown,max: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
const version = (v: unknown,min: number,max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const common = (v: Record<string,unknown>) => typeof v.cityId === "string" && cityRule.test(v.cityId) &&
  text(v.label,80) && text(v.details,300) && coordinate(v.latitude,90) && coordinate(v.longitude,180);
export function isCustomerAddressId(id: string): boolean { return idRule.test(id); }
export function validCustomerAddressChange(v: unknown): v is CustomerAddressChange {
  return obj(v) && exact(v,["cityId","label","details","latitude","longitude","expectedVersion"]) &&
    common(v) && version(v.expectedVersion,0,Number.MAX_SAFE_INTEGER-1);
}
function validAddress(v: unknown): v is CustomerAddress {
  return obj(v) && exact(v,["id","cityId","label","details","latitude","longitude","version"]) &&
    typeof v.id === "string" && idRule.test(v.id) && common(v) && version(v.version,1);
}
export function parseCustomerAddressPage(v: unknown, actor: string, after = ""): CustomerAddressPage {
  if (!obj(v) || !exact(v,v.nextCursor === undefined ? ["actorId","items"] : ["actorId","items","nextCursor"]) ||
    v.actorId !== actor || !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(validAddress)) {
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  }
  let previous = after;
  for (const item of v.items) {
    if (item.id <= previous) throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
    previous = item.id;
  }
  if (v.nextCursor !== undefined && (v.items.length !== 20 || v.nextCursor !== previous)) {
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  }
  return v as CustomerAddressPage;
}
export function parseCustomerAddressResult(v: unknown, actor: string, id: string, change: CustomerAddressChange): CustomerAddressResult {
  if (!obj(v) || !exact(v,["actorId","address","replay"]) || v.actorId !== actor || typeof v.replay !== "boolean" ||
    !validAddress(v.address) || v.address.id !== id || v.address.version !== change.expectedVersion+1 ||
    v.address.cityId !== change.cityId || v.address.label !== change.label.trim() ||
    v.address.details !== change.details.trim() || v.address.latitude !== change.latitude || v.address.longitude !== change.longitude) {
    throw new DshPublicError(502,"OPERATION_RESULT_UNKNOWN");
  }
  return v as CustomerAddressResult;
}
export function parseCustomerAddress(v: unknown, actor: string, id: string): CustomerAddressRead {
  if (!obj(v) || !exact(v,["actorId","address"]) || v.actorId !== actor || !validAddress(v.address) || v.address.id !== id) {
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  }
  return { actorId:actor, address:v.address };
}
export async function listCustomerAddresses(origin: string,bearer: string,actor: string,after?: string,signal?: AbortSignal) {
  if (!bearerRule.test(bearer)) throw new DshPublicError(401,"UNAUTHENTICATED");
  if (after !== undefined && !idRule.test(after)) throw new DshPublicError(400,"INVALID_REQUEST");
  const path = dshOperations.listCurrentCustomerAddresses.path;
  return parseCustomerAddressPage(await privateOwnerRequest(origin,after ? `${path}?after=${after}` : path,
    bearer,"GET",undefined,signal),actor,after);
}
export async function saveCustomerAddress(origin: string,bearer: string,actor: string,id: string,change: CustomerAddressChange,signal?: AbortSignal) {
  if (!bearerRule.test(bearer)) throw new DshPublicError(401,"UNAUTHENTICATED");
  if (!idRule.test(id) || !validCustomerAddressChange(change)) throw new DshPublicError(400,"INVALID_REQUEST");
  const path = dshOperations.saveCurrentCustomerAddress.path.replace("{addressID}",id);
  return parseCustomerAddressResult(await privateOwnerRequest(origin,path,bearer,"PUT",change,signal),actor,id,change);
}
export async function getCustomerAddress(origin: string,bearer: string,actor: string,id: string,signal?: AbortSignal) {
  if (!bearerRule.test(bearer)) throw new DshPublicError(401,"UNAUTHENTICATED");
  if (!idRule.test(id)) throw new DshPublicError(400,"INVALID_REQUEST");
  const path = dshOperations.getCurrentCustomerAddress.path.replace("{addressID}",id);
  return parseCustomerAddress(await privateOwnerRequest(origin,path,bearer,"GET",undefined,signal),actor,id);
}


export type DeliveryServiceability = Readonly<{
  actorId: string; storeId: string; addressId: string;
  status: "SERVICEABLE" | "UNSERVICEABLE" | "UNAVAILABLE";
  evidence?: Readonly<{storeCityId:string;addressCityId:string;addressVersion:number;policyVersion:number;radiusMetres:number;distanceMetres:number}>;
}>;
export function parseDeliveryServiceability(v: unknown, actor:string,store:string,address:string):DeliveryServiceability {
  const invalid=()=>new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  if (!obj(v)||v.actorId!==actor||v.storeId!==store||v.addressId!==address) throw invalid();
  if (v.status==="UNAVAILABLE") {
    if (!exact(v,["actorId","storeId","addressId","status"])) throw invalid();
  } else {
    const ev=v.evidence;
    if ((v.status!=="SERVICEABLE"&&v.status!=="UNSERVICEABLE")||
      !exact(v,["actorId","storeId","addressId","status","evidence"])||!obj(ev)||
      !exact(ev,["storeCityId","addressCityId","addressVersion","policyVersion","radiusMetres","distanceMetres"])||
      typeof ev.storeCityId!=="string"||!cityRule.test(ev.storeCityId)||
      typeof ev.addressCityId!=="string"||!cityRule.test(ev.addressCityId)||
      !version(ev.addressVersion,1)||!version(ev.policyVersion,1)||!version(ev.radiusMetres,1,2147483647)||
      typeof ev.distanceMetres!=="number"||!Number.isFinite(ev.distanceMetres)||ev.distanceMetres<0||
      ((ev.storeCityId===ev.addressCityId&&ev.distanceMetres<=ev.radiusMetres)!==(v.status==="SERVICEABLE"))) throw invalid();
  }
  return v as DeliveryServiceability;
}
export async function evaluateDeliveryServiceability(origin:string,bearer:string,actor:string,store:string,address:string,signal?:AbortSignal) {
  if (!bearerRule.test(bearer)) throw new DshPublicError(401,"UNAUTHENTICATED");
  if (!cityRule.test(store)||!idRule.test(address)) throw new DshPublicError(400,"INVALID_REQUEST");
  const path=dshOperations.evaluateCurrentCustomerDeliveryAddress.path.replace("{storeID}",store);
  return parseDeliveryServiceability(await privateOwnerRequest(origin,`${path}?addressId=${address}`,bearer,"GET",undefined,signal),actor,store,address);
}
