import { requestDshJson, validateAttributedMutationContext, type DshOperatorReadContext, type JoiningCaseMutationContext } from "./dsh-transport";
import { type PartnerStoreOperationalAvailabilityMutationResponse, type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";

export type CaptainMinimumBalancePolicy = Readonly<{
  id: string;
  version: number;
  minimumAvailableMinor: number;
  currency: "YER";
  state: "ACTIVE" | "RETIRED";
  createdBy: string;
  changeReason: string;
  createdAt: string;
  retiredAt: string | null;
}>;
export type CaptainMinimumBalanceResponse = Readonly<{ policy: CaptainMinimumBalancePolicy; idempotentReplay?: boolean }>;
export async function readOperatorCaptainMinimumBalancePolicy(context: DshOperatorReadContext): Promise<CaptainMinimumBalanceResponse> {
  return (await requestDshJson<CaptainMinimumBalanceResponse>("GET", "/dsh/operator/captain-minimum-balance-policy", undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function listOperatorCaptainMinimumBalanceHistory(context: DshOperatorReadContext): Promise<Readonly<{ items: readonly CaptainMinimumBalancePolicy[] }>> {
  return (await requestDshJson<Readonly<{ items: readonly CaptainMinimumBalancePolicy[] }>>("GET", "/dsh/operator/captain-minimum-balance-policy/history", undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function createOperatorCaptainMinimumBalancePolicy(input: Readonly<{ minimumAvailableMinor: number; expectedVersion: number; reason: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainMinimumBalanceResponse }>> {
  if (!Number.isSafeInteger(input.minimumAvailableMinor) || input.minimumAvailableMinor <= 0 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("INVALID_CAPTAIN_MINIMUM_BALANCE");
  validateAttributedMutationContext(context);
  return requestDshJson<CaptainMinimumBalanceResponse>("POST", "/dsh/operator/captain-minimum-balance-policy", input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(),
  });
}

export type OperatorFinancialPolicyRegistry = Readonly<{
 deliveryFees: readonly Readonly<{ id: string; name: string; distanceBands: readonly DistanceFeeBand[]; policyVersion: string; version: number; createdAt: string; createdBy: string }>[];
 fieldRewards: readonly Readonly<{ id: string; name: string; rewardMinor: number; version: number; createdAt: string; createdBy: string }>[];
 deliveryTotal: number;
 fieldTotal: number;
}>;
export async function readOperatorFinancialPolicyRegistry(context: DshOperatorReadContext): Promise<OperatorFinancialPolicyRegistry> {
 return (await requestDshJson<OperatorFinancialPolicyRegistry>("GET", "/dsh/operator/policy-registry", undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorPolicyChange = Readonly<{id:string;scopeId:string;version:number;actorId:string;createdAt:string;reason:string;field:string;before:string;after:string}>;
export async function listOperatorPolicyHistory(key:string,scopeId:string,context:DshOperatorReadContext):Promise<Readonly<{items:readonly OperatorPolicyChange[]}>>{
  if(!["service-cities","wallet-providers","delivery-fees","partner-financial-terms","captain-minimum-balance"].includes(key)||scopeId.length>128)throw new Error("POLICY_HISTORY_INPUT_INVALID");
  const qs=new URLSearchParams({key,scopeId});
  return (await requestDshJson<Readonly<{items:readonly OperatorPolicyChange[]}>>("GET","/dsh/operator/policy-history?"+qs.toString(),undefined,{"X-Acting-Actor-ID":context.operatorActorId.trim()})).payload;
}

export type DistanceFeeBand = Readonly<{upToMeters:number|null;ratePerKmMinor:number}>;
export type DistanceFeePolicy = Readonly<{id:string;serviceCityId:string;policyVersion:string;state:"ACTIVE"|"RETIRED";distanceBands:readonly DistanceFeeBand[]|null;version:number;createdBy:string;createdAt:string;retiredAt:string|null}>;
export type DistanceFeePolicyResponse = Readonly<{policy:DistanceFeePolicy;idempotentReplay?:boolean}>;
export async function readOperatorDistanceFeePolicy(serviceCityId:string,context:DshOperatorReadContext):Promise<DistanceFeePolicyResponse>{
  if(serviceCityId.length>128)throw new Error("DISTANCE_FEE_SCOPE_INVALID");
  return (await requestDshJson<DistanceFeePolicyResponse>("GET","/dsh/operator/distance-band-fee-policy?serviceCityId="+encodeURIComponent(serviceCityId),undefined,{"X-Acting-Actor-ID":context.operatorActorId.trim()})).payload;
}
export async function createOperatorDistanceFeePolicy(input:Readonly<{serviceCityId:string;distanceBands:readonly DistanceFeeBand[];expectedVersion:number;reason:string}>,context:JoiningCaseMutationContext):Promise<Readonly<{status:number;payload:DistanceFeePolicyResponse}>>{
 validateAttributedMutationContext(context);
 return requestDshJson<DistanceFeePolicyResponse>("POST","/dsh/operator/distance-band-fee-policy",input,{"X-Acting-Actor-ID":context.operatorActorId.trim(),"X-Correlation-ID":context.correlationId.trim(),"Idempotency-Key":context.idempotencyKey.trim()});
}
