import { redirect } from "next/navigation";

// Compatibility for existing customer links; the canonical customer registry
// now lives in the marketing center alongside campaigns and analytics.
export default async function MarketingCustomersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const raw = await searchParams;
  const params = new URLSearchParams({ section: "customers" });
  for (const key of ["q", "enabled", "cursor", "customer", "tab"]) {
    const value = raw[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (text && text.length <= 512) params.set(key, text);
  }
  redirect("/marketing?" + params);
}

export const metadata = { title: "العملاء والجمهور | التسويق والمحتوى" };
