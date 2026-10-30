import { dshOperationPaths, type PartnerStoreOperationalAvailabilityMutationResponse, type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest, type ShoppingShortcutListResponse, type ShoppingShortcutMutationRequest, type ShoppingShortcutMutationResponse } from "@bthwani/dsh";
import { requestDshJson, validateAttributedMutationContext, type DshOperatorReadContext, type JoiningCaseMutationContext } from "./dsh-transport";

export async function readOperatorStoreAvailability(storeId: string, context: DshOperatorReadContext): Promise<PartnerStoreOperationalAvailabilityResponse> {
  if (!storeId.trim() || storeId.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_STORE_AVAILABILITY_INPUT_INVALID");
  return (await requestDshJson<PartnerStoreOperationalAvailabilityResponse>(
    "GET", `/dsh/operations/stores/${encodeURIComponent(storeId.trim())}/operational-availability`, undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() }
  )).payload;
}
export async function updateOperatorStoreAvailability(storeId: string, input: StoreOperationalAvailabilityRequest,
  context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerStoreOperationalAvailabilityMutationResponse }>> {
  validateAttributedMutationContext(context);
  if (!storeId.trim() || storeId.length > 128 || !context.idempotencyKey.trim()) throw new Error("DSH_STORE_AVAILABILITY_INPUT_INVALID");
  return requestDshJson<PartnerStoreOperationalAvailabilityMutationResponse>(
    "PATCH", `/dsh/operations/stores/${encodeURIComponent(storeId.trim())}/operational-availability`, input,
    { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() }
  );
}

// Shopping shortcuts are catalog-owned presentation definitions, not commercial types.



export async function listShoppingShortcuts(context: DshOperatorReadContext, verticalId: string): Promise<ShoppingShortcutListResponse> {
  if (!context.operatorActorId.trim() || !verticalId.trim()) throw new Error("DSH_SHOPPING_SHORTCUT_READ_INVALID");
  const q = new URLSearchParams({ verticalId: verticalId.trim() });
  return (await requestDshJson<ShoppingShortcutListResponse>(dshOperationPaths.listShoppingShortcuts.method,
    `${dshOperationPaths.listShoppingShortcuts.path}?${q}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function mutateShoppingShortcut(input: ShoppingShortcutMutationRequest, context: JoiningCaseMutationContext, id = ""): Promise<Readonly<{ status: number; payload: ShoppingShortcutMutationResponse }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_SHOPPING_SHORTCUT_IDEMPOTENCY_INVALID");
  const update = Boolean(id);
  const operation = update ? dshOperationPaths.updateShoppingShortcut : dshOperationPaths.createShoppingShortcut;
  const path = update ? operation.path.replace("{shortcutId}", encodeURIComponent(id.trim())) : operation.path;
  return requestDshJson<ShoppingShortcutMutationResponse>(operation.method, path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(),
  });
}
