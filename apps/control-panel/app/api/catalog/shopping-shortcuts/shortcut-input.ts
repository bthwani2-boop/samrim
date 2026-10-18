import type { ShoppingShortcutMutationRequest } from "@bthwani/dsh";

export function validateShoppingShortcutPayload(body: unknown, updating: boolean): ShoppingShortcutMutationRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const allowed = ["verticalId", "titleAr", "ordinal", "active", "expectedVersion", "storeTypeIds", "categoryIds", "reason"];
  if (Object.keys(obj).length !== allowed.length || Object.keys(obj).some((key) => !allowed.includes(key))) return null;
  if (typeof obj.verticalId !== "string" || obj.verticalId.trim().length < 2 || obj.verticalId.length > 128 ||
      typeof obj.titleAr !== "string" || obj.titleAr.trim().length < 2 || obj.titleAr.length > 160 ||
      typeof obj.ordinal !== "number" || !Number.isInteger(obj.ordinal) || obj.ordinal < 0 || obj.ordinal > 9999 ||
      typeof obj.active !== "boolean" || typeof obj.expectedVersion !== "number" ||
      !Number.isInteger(obj.expectedVersion) || (updating ? obj.expectedVersion < 1 : obj.expectedVersion !== 0) ||
      !Array.isArray(obj.storeTypeIds) || !Array.isArray(obj.categoryIds) ||
      obj.storeTypeIds.length + obj.categoryIds.length < 1 || obj.storeTypeIds.length + obj.categoryIds.length > 25 ||
      [...obj.storeTypeIds, ...obj.categoryIds].some((id) => typeof id !== "string" || id.length < 2 || id.length > 128) ||
      typeof obj.reason !== "string" || obj.reason.trim().length < 5 || obj.reason.length > 500) return null;
  return { verticalId: obj.verticalId.trim(), titleAr: obj.titleAr.trim(), ordinal: obj.ordinal,
    active: obj.active, expectedVersion: obj.expectedVersion,
    storeTypeIds: obj.storeTypeIds as string[], categoryIds: obj.categoryIds as string[], reason: obj.reason.trim() };
}
