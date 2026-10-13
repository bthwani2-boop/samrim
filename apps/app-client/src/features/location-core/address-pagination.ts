import type { DeliveryAddress } from "@bthwani/dsh";

// Preserve the owner-backed first-page record if a cursor overlaps a newer page.
export function appendDistinctDeliveryAddresses(
  current: ReadonlyArray<DeliveryAddress>,
  incoming: ReadonlyArray<DeliveryAddress>,
): ReadonlyArray<DeliveryAddress> {
  const seen = new Set(current.map((address) => address.id));
  const result = [...current];
  for (const address of incoming) {
    if (seen.has(address.id)) continue;
    seen.add(address.id);
    result.push(address);
  }
  return result;
}
