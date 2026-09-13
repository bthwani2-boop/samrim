import { createDshMobileClient, type PublicStoreView } from "@bthwani/dsh";

function dshBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(dshBaseUrl());

export async function listPublishedStores(): Promise<ReadonlyArray<PublicStoreView>> {
  return client().listPublishedStores();
}

export async function readPublishedStore(storeID: string): Promise<PublicStoreView> {
  return client().readPublishedStore(storeID);
}
