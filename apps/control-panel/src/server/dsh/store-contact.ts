import type { StorePublicContactResponse } from "@bthwani/dsh";
import { requestDshJson, type DshOperatorReadContext } from "./dsh-transport";

export async function readOperatorStorePublicContact(storeId: string, context: DshOperatorReadContext): Promise<StorePublicContactResponse> {
  const id = storeId.trim();
  const actor = context.operatorActorId.trim();
  if (!id || id.length > 128 || !actor) throw new Error("DSH_STORE_CONTACT_SCOPE_INVALID");
  return (await requestDshJson<StorePublicContactResponse>("GET",
    "/dsh/operator/stores/" + encodeURIComponent(id) + "/contact",
    undefined, { "X-Acting-Actor-ID": actor })).payload;
}
