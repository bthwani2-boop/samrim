export type {
  CityStoreOperationalPolicy as CityPolicy, CityStoreOperationalPolicyChange as CityPolicyChange,
} from "@bthwani/dsh";

import type {
  CityStoreOperationalPolicy as CityPolicy, CityStoreOperationalPolicyChange as CityPolicyChange,
} from "@bthwani/dsh";
import { type CityStoreOperationalPolicyHistoryPage, isCityStoreOperationalPolicyHistoryPage } from "@bthwani/dsh";

export function parseCityPolicy(value: unknown, cityId: string): CityPolicy | null {
  // The current policy and each audit entry share the exact owner schema.
  const page = { cityId, entries: [value] };
  return isCityStoreOperationalPolicyHistoryPage(page, cityId, 1) ? page.entries[0] ?? null : null;
}

type CommandResult =
  | { status: "confirmed"; current: CityPolicy; replay: boolean; superseded: boolean }
  | { status: "conflict" | "denied" | "rejected" | "unknown" };

export async function reconcileCityPolicy(
  endpoint: string, city: string, actorId: string, change: CityPolicyChange,
): Promise<CommandResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(city) || endpoint !== "/api/policies/cities/" + city ||
      !actorId.trim()) return { status: "rejected" };
  try {
    const binding = { "X-BThwani-Operator": encodeURIComponent(actorId) };
    const response = await fetch(endpoint, {
      method: "PATCH", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { ...binding, "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    if (response.status === 409) return { status: "conflict" };
    if (response.status === 401 || response.status === 403) return { status: "denied" };
    if (response.status === 400) return { status: "rejected" };
    if (!response.ok) return { status: "unknown" };

    const result = await response.json() as { policy?: unknown; replay?: unknown } | null;
    const committed = parseCityPolicy(result?.policy, city);
    if (!committed || committed.changedByActor !== actorId || typeof result?.replay !== "boolean" ||
        committed.version !== change.expectedVersion + 1 ||
        committed.maxPauseSeconds !== change.maxPauseSeconds ||
        committed.maxPreparationMinutes !== change.maxPreparationMinutes ||
        committed.changeReason !== change.reason.trim()) {
      return { status: "unknown" };
    }

    const verify = await fetch(endpoint, {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: binding,
    });
    const current = verify.ok ? parseCityPolicy(await verify.json(), city) : null;
    if (!current || current.version < committed.version ||
        (current.version === committed.version &&
         (current.maxPauseSeconds !== committed.maxPauseSeconds ||
          current.maxPreparationMinutes !== committed.maxPreparationMinutes ||
          current.changedByActor !== committed.changedByActor ||
          current.changeReason !== committed.changeReason ||
          current.updatedAt !== committed.updatedAt))) {
      return { status: "unknown" };
    }
    return { status: "confirmed", current, replay: result.replay,
      superseded: current.version > committed.version };
  } catch {
    return { status: "unknown" };
  }
}

export async function readCityPolicyHistory(
  endpoint: string, city: string, actorId: string, beforeVersion?: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicyHistoryPage> {
  if (!/^[a-z0-9-]{1,64}$/.test(city) || endpoint !== "/api/policies/cities/" + city ||
      (beforeVersion !== undefined && (!/^[1-9][0-9]{0,15}$/.test(beforeVersion) ||
       !Number.isSafeInteger(Number(beforeVersion))))) throw new Error("INVALID_HISTORY_SCOPE");
  const query = new URLSearchParams({ history: "1", limit: "10" });
  if (beforeVersion) query.set("beforeVersion", beforeVersion);
  const response = await fetch(endpoint + "?" + query.toString(), {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "X-BThwani-Operator": encodeURIComponent(actorId) }, signal: signal ?? null,
  });
  if (!response.ok || signal?.aborted) throw new Error("HISTORY_UNAVAILABLE");
  const data: unknown = await response.json();
  if (signal?.aborted || !isCityStoreOperationalPolicyHistoryPage(data, city, 10, beforeVersion)) {
    throw new Error("INVALID_HISTORY_RESPONSE");
  }
  return data;
}
