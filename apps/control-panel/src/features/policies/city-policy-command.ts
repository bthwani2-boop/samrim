export type CityPolicy = {
  cityId: string;
  version: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  changedByActor: string;
  changeReason: string;
  updatedAt: string;
};

export type CityPolicyChange = {
  operationId: string;
  expectedVersion: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  reason: string;
};

export function parseCityPolicy(value: unknown, cityId: string): CityPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const policy = value as Partial<CityPolicy>;
  if (policy.cityId !== cityId || typeof policy.version !== "number" ||
      !Number.isSafeInteger(policy.version) || policy.version < 1 ||
      !Number.isSafeInteger(policy.maxPauseSeconds) ||
      !Number.isSafeInteger(policy.maxPreparationMinutes) ||
      typeof policy.changedByActor !== "string" || typeof policy.changeReason !== "string" ||
      typeof policy.updatedAt !== "string") return null;
  return policy as CityPolicy;
}

type CommandResult =
  | { status: "confirmed"; current: CityPolicy; replay: boolean; superseded: boolean }
  | { status: "conflict" | "denied" | "rejected" | "unknown" };

export async function reconcileCityPolicy(
  endpoint: string, city: string, change: CityPolicyChange,
): Promise<CommandResult> {
  try {
    const response = await fetch(endpoint, {
      method: "PATCH", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    if (response.status === 409) return { status: "conflict" };
    if (response.status === 401 || response.status === 403) return { status: "denied" };
    if (response.status === 400) return { status: "rejected" };
    if (!response.ok) return { status: "unknown" };

    const result = await response.json() as { policy?: unknown; replay?: unknown } | null;
    const committed = parseCityPolicy(result?.policy, city);
    if (!committed || typeof result?.replay !== "boolean" ||
        committed.version !== change.expectedVersion + 1 ||
        committed.maxPauseSeconds !== change.maxPauseSeconds ||
        committed.maxPreparationMinutes !== change.maxPreparationMinutes) {
      return { status: "unknown" };
    }

    const verify = await fetch(endpoint, {
      method: "GET", credentials: "same-origin", cache: "no-store",
    });
    const current = verify.ok ? parseCityPolicy(await verify.json(), city) : null;
    if (!current || current.version < committed.version ||
        (current.version === committed.version &&
         (current.maxPauseSeconds !== committed.maxPauseSeconds ||
          current.maxPreparationMinutes !== committed.maxPreparationMinutes))) {
      return { status: "unknown" };
    }
    return { status: "confirmed", current, replay: result.replay,
      superseded: current.version > committed.version };
  } catch {
    return { status: "unknown" };
  }
}
