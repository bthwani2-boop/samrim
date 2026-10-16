import { redirect } from "next/navigation";

// Compatibility only: there is one canonical customer registry under marketing.
export default async function LegacyCustomerDirectory({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const input = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["q", "enabled", "cursor"]) {
    const raw = input[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && value.length <= 512) params.set(key, value);
  }
  redirect(`/marketing/customers${params.size ? `?${params}` : ""}`);
}
