import { type CatalogActivityPage } from "@bthwani/dsh";
import { requestDshJson, type DshOperatorReadContext } from "./dsh-transport";

export type CatalogActivityQuery = Readonly<{
  q?: string; kind?: string; action?: string; storeId?: string;
  from?: string; to?: string; cursor?: string; limit?: string;
}>;

export async function listOperatorCatalogActivity(filters: CatalogActivityQuery, context: DshOperatorReadContext): Promise<CatalogActivityPage> {
  if (!context.operatorActorId.trim()) throw new Error("CATALOG_ACTIVITY_ACTOR_REQUIRED");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) params.set(key, value.trim());
  }
  return (await requestDshJson<CatalogActivityPage>(
    "GET", `/dsh/operator/catalog-activity?${params}`, undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  )).payload;
}
