export type StoreJoiningModel = "BTHWANI_PARTNER" | "INDEPENDENT_STORE";

export type StoreJoiningPolicy = Readonly<{
  relationModel: StoreJoiningModel;
  enrollmentEnabled: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
  reason: string;
}>;

/** Confirm the exact two DSH-owned enrollment policies before enabling a mutation. */
export function validStoreJoiningPolicyReadback(value: unknown): value is StoreJoiningPolicy[] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const models: readonly StoreJoiningModel[] = ["BTHWANI_PARTNER", "INDEPENDENT_STORE"];
  return models.every((model) => value.filter((entry) => entry?.relationModel === model).length === 1)
    && value.every((entry) => typeof entry.enrollmentEnabled === "boolean"
      && Number.isSafeInteger(entry.version) && entry.version > 0);
}
