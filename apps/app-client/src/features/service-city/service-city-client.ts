import { createDshMobileClient, type ServiceCity } from "@bthwani/dsh";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl);
}

export function listActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
  return client().listActiveServiceCities();
}
