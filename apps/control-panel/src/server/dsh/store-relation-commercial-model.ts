import { dshOperationPaths, type StoreRelationCommercialModelDefaultsResponse, type StoreRelationCommercialModelUpdate, type StoreRelationCommercialModelUpdateResponse } from "@bthwani/dsh";
import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, validateAttributedMutationContext } from "./dsh-transport";



export async function readOperatorStoreRelationCommercialModelDefaults(context: DshOperatorReadContext): Promise<StoreRelationCommercialModelDefaultsResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_STORE_RELATION_MODEL_READ_ACTOR_REQUIRED");
  return (await requestDshJson<StoreRelationCommercialModelDefaultsResponse>(dshOperationPaths.readOperatorStoreRelationCommercialModelDefaults.method, dshOperationPaths.readOperatorStoreRelationCommercialModelDefaults.path, undefined, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(),
  })).payload;
}

export async function updateOperatorStoreRelationCommercialModelDefault(input: StoreRelationCommercialModelUpdate, context: JoiningCaseMutationContext) {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_RELATION_MODEL_IDEMPOTENCY_REQUIRED");
  return requestDshJson<StoreRelationCommercialModelUpdateResponse>(dshOperationPaths.updateOperatorStoreRelationCommercialModelDefault.method, dshOperationPaths.updateOperatorStoreRelationCommercialModelDefault.path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(),
    "X-Correlation-ID": context.correlationId.trim(),
    "Idempotency-Key": context.idempotencyKey.trim(),
  });
}
