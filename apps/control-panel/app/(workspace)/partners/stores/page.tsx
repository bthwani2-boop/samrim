import { redirect } from "next/navigation";

// Retain bookmarked store-registry routes while keeping one canonical operator registry.
export default async function LegacyPartnerStoresPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const preserved = new URLSearchParams();
  for (const key of ["state", "q", "sort", "cursor", "inspect", "serviceCityId"]) {
    const value = params[key];
    if (typeof value === "string" && value) preserved.set(key, value);
  }
  redirect(`/partners${preserved.size ? `?${preserved.toString()}` : ""}`);
}

export const metadata = { title: "الشركاء والمتاجر" };
