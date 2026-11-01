import type { CatalogInventorySummaryResponse } from "@bthwani/dsh";
import { requestDshJson, type DshOperatorReadContext } from "./dsh-transport";

export async function readOperatorStoreInventorySummary(storeId: string, context: DshOperatorReadContext): Promise<CatalogInventorySummaryResponse> {
 const id=storeId.trim();
 const actor=context.operatorActorId.trim();
 if (!id || id.length>128 || !actor) throw new Error("DSH_STORE_INVENTORY_SCOPE_INVALID");
 return (await requestDshJson<CatalogInventorySummaryResponse>("GET", "/dsh/operator/stores/"+encodeURIComponent(id)+"/inventory-summary", undefined, {"X-Acting-Actor-ID":actor})).payload;
}
