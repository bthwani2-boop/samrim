import { isMediaProvenanceInputValid, type MediaProvenanceInput } from "@bthwani/dsh";
import { appendMediaProvenance, type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, requestDshMultipart, type StorePublicationMutationContext, validateAttributedMutationContext, validateVersionedMutationContext } from "./dsh-transport";




export type WalletProvider = Readonly<{ key: string; displayNameAr: string; active: boolean; version: number; logoUri: string }>;
export type WalletProviderListResponse = Readonly<{ walletProviders: ReadonlyArray<WalletProvider> }>;
type WalletProviderResponse = Readonly<{ walletProvider: WalletProvider }>;

export async function listOperatorWalletProviders(includeInactive: boolean, context: DshOperatorReadContext): Promise<WalletProviderListResponse> {
  const query = includeInactive ? "?includeInactive=true" : "";
  return (await requestDshJson<WalletProviderListResponse>("GET", `/dsh/wallet-providers${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorWalletProvider(input: Readonly<{ displayNameAr: string; active: boolean }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: WalletProviderResponse }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_IDEMPOTENCY_KEY_MISSING");
  return requestDshJson<WalletProviderResponse>("POST", "/dsh/wallet-providers", input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateOperatorWalletProvider(providerKey: string, input: Readonly<{ displayNameAr: string; active: boolean }>, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: WalletProviderResponse }>> {
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_IDEMPOTENCY_KEY_MISSING");
  const key = providerKey.trim();
  if (!key || key.length > 128) throw new Error("DSH_WALLET_PROVIDER_KEY_INVALID");
  return requestDshJson<WalletProviderResponse>("PATCH", `/dsh/wallet-providers/${encodeURIComponent(key)}`, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadOperatorWalletProviderLogo(providerKey: string,file: File,provenance: MediaProvenanceInput,context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{status:number;payload:WalletProviderResponse}>> {
 if(!providerKey.trim() || file.size<1 || file.size>10*1024*1024 || !["image/jpeg","image/png"].includes(file.type) || !isMediaProvenanceInputValid(provenance)) throw new Error("WALLET_PROVIDER_LOGO_INVALID");
 validateVersionedMutationContext(context);
 const body=new FormData();
 body.set("file",file,file.name || "wallet-logo");
 appendMediaProvenance(body,provenance);
 return requestDshMultipart<WalletProviderResponse>("POST","/dsh/wallet-providers/"+encodeURIComponent(providerKey.trim())+"/logo/upload",body,{"X-Acting-Actor-ID":context.operatorActorId.trim(),"X-Correlation-ID":context.correlationId.trim(),"X-Expected-Version":String(context.expectedVersion),"Idempotency-Key":context.idempotencyKey.trim()});
}
