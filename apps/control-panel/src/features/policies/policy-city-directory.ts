import { listPublicCities } from "@bthwani/dsh";
import { resolvePublicDshOrigin } from "../stores/public-store-query";

export type PolicyCityDirectory = Readonly<{
  cities: readonly { value: string; label: string }[];
  status: "current" | "unavailable";
}>;

// The public DSH city directory contains active cities only. Historical policy
// reads remain independently authorized at the policy BFF.
export async function loadPolicyCities(): Promise<PolicyCityDirectory> {
  const origin = resolvePublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN, process.env.NODE_ENV);
  if (!origin) return { cities: [], status: "unavailable" };
  const cities = new Set<string>();
  const seen = new Set<string>();
  const signal = AbortSignal.timeout(5000);
  let cursor: string | undefined;
  let revision: number | undefined;
  try {
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await listPublicCities(origin, {
        limit: 50, signal, ...(cursor ? { cursor } : {}),
      });
      if (revision !== undefined && page.revision !== revision) throw new Error("City revision changed");
      revision = page.revision;
      for (const city of page.items) {
        if (cities.has(city)) throw new Error("Repeated city");
        cities.add(city);
      }
      if (!page.nextCursor) return {
        cities: [...cities].map(value => ({ value, label: policyCityLabel(value) })), status: "current",
      };
      if (seen.has(page.nextCursor)) throw new Error("Repeated cursor");
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  } catch {
    // Never present a partial or failed directory as an authoritative empty list.
  }
  return { cities: [], status: "unavailable" };
}

export function policyCityLabel(city: string): string {
  // Presentation labels only; the owner directory supplies all eligible IDs.
  if (city === "sanaa") return "صنعاء";
  if (city === "aden") return "عدن";
  return city;
}
