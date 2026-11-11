import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, validateVersionedMutationContext } from "./dsh-transport";



export type StoreTrashItem = Readonly<{ id: string; name: string; partnerActorId: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
export type StoreTrashPage = Readonly<{ stores: ReadonlyArray<StoreTrashItem>; nextCursor: string }>;
export async function listArchivedStores(cursor: string, context: DshOperatorReadContext): Promise<StoreTrashPage> {
  if (!context.operatorActorId.trim() || cursor.length > 512) throw new Error("DSH_STORE_TRASH_READ_INVALID");
  const params = new URLSearchParams({ limit: "25" });
  if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<StoreTrashPage>("GET", "/dsh/operator/stores/trash?" + params.toString(), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function mutateStoreTrash(storeId: string, action: "trash" | "restore", expectedVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: { store: StoreTrashItem; idempotentReplay: boolean } }>> {
  if (!storeId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_STORE_TRASH_INPUT_INVALID");
  validateVersionedMutationContext({ ...context, expectedVersion });
  return requestDshJson("POST", "/dsh/operator/stores/" + encodeURIComponent(storeId) + "/" + action, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
export type CatalogTrashCategory = Readonly<{ id: string; verticalId: string; nameAr: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
export type CatalogTrashCategoryPage = Readonly<{ categories: ReadonlyArray<CatalogTrashCategory>; nextCursor: string }>;
export async function listDeletedCatalogCategories(cursor: string, context: DshOperatorReadContext): Promise<CatalogTrashCategoryPage> {
  if (!context.operatorActorId.trim() || cursor.length > 512) throw new Error("DSH_CATEGORY_TRASH_READ_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CatalogTrashCategoryPage>("GET", "/dsh/catalog/category-trash?" + params.toString(), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function mutateCatalogCategoryTrash(categoryId: string, action: "trash" | "restore", expectedVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: { category: CatalogTrashCategory; idempotentReplay: boolean } }>> {
  if (!categoryId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_CATEGORY_TRASH_INPUT_INVALID");
  validateVersionedMutationContext({ ...context, expectedVersion });
  return requestDshJson("POST", "/dsh/catalog/categories/" + encodeURIComponent(categoryId) + "/" + action, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
export type CatalogTrashProduct = Readonly<{ id: string; canonicalName: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
export type CatalogTrashPage = Readonly<{ products: ReadonlyArray<CatalogTrashProduct>; nextCursor: string }>;
export async function listDeletedCatalogProducts(cursor: string, context: DshOperatorReadContext): Promise<CatalogTrashPage> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_TRASH_READ_INPUT_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CatalogTrashPage>("GET", "/dsh/catalog/trash?" + params.toString(), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function mutateCatalogProductTrash(productId: string, action: "trash" | "restore", expectedVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: { product: CatalogTrashProduct; idempotentReplay: boolean } }>> {
  if (!productId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_TRASH_INPUT_INVALID");
  validateVersionedMutationContext({ ...context, expectedVersion });
  return requestDshJson("POST", "/dsh/catalog/products/" + encodeURIComponent(productId) + "/" + action, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
