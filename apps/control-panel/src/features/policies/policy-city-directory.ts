import { listPublicCities } from "@bthwani/dsh";
import { isolatedPublicDshOrigin } from "../stores/public-store-query";

export type PolicyCityDirectory = Readonly<{
  cities: readonly { value: string; label: string }[];
  status: "current" | "unavailable";
}>;

const pageLimit = 50;
const pageBudget = 10;

// The owner determines active identities, ordering and opaque continuation.
// A directory is published only after a complete, live, single-revision read.
export async function loadPolicyCities(): Promise<PolicyCityDirectory> {
  const unavailable: PolicyCityDirectory = { cities: [], status: "unavailable" };
  const origin = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!origin) return unavailable;

  const signal = AbortSignal.timeout(5000);
  const cities = new Map<string, { value: string; label: string }>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let revision: number | undefined;

  try {
    for (let remaining = pageBudget; remaining > 0; remaining--) {
      signal.throwIfAborted();
      const page = await listPublicCities(origin, {
        limit: pageLimit, signal, ...(cursor === undefined ? {} : { cursor }),
      });
      signal.throwIfAborted();
      if (revision !== undefined && page.revision !== revision) return unavailable;
      revision = page.revision;

      // The owner uses LIMIT + 1 to advertise a continuation. A continuation
      // from a short page, or an empty page after one, is inconsistent.
      if ((page.nextCursor !== undefined && page.items.length !== pageLimit) ||
          (cursor !== undefined && page.items.length === 0)) return unavailable;
      for (const value of page.items) {
        if (cities.has(value)) return unavailable;
        cities.set(value, { value, label: policyCityLabel(value) });
      }
      if (page.nextCursor === undefined) return { cities: [...cities.values()], status: "current" };
      if (cursors.has(page.nextCursor)) return unavailable;
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  } catch {
    // A failed or abandoned read cannot be presented as a current empty directory.
    return unavailable;
  }
  return unavailable;
}

function policyCityLabel(city: string): string {
  if (city === "sanaa") return "صنعاء";
  if (city === "aden") return "عدن";
  return city;
}
