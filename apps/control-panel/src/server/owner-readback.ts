import "server-only";

// Absence of canonical data cannot be represented as zero or an empty successful list.
export type OwnerReadback<T> =
  | { state: "ready"; data: T; source: "Identity" | "DSH" | "WLT" }
  | { state: "unavailable"; source: "Identity" | "DSH" | "WLT" };

export function unavailableOwnerReadback(source: "Identity" | "DSH" | "WLT"): OwnerReadback<never> {
  return { state: "unavailable", source };
}
