import { redirect } from "next/navigation";

// Old bookmarks stay valid; there is one operational partner workspace.
export default async function LegacyPartnersQueue({ searchParams }: Readonly<{searchParams: Promise<Record<string, string | string[] | undefined>>}>) {
  const original = await searchParams;
  const params = new URLSearchParams({ view: "joining" });
  for (const key of ["state","q","sort","cursor"]) {
    const value = original[key];
    if (typeof value === "string" && value.length <= 2048 && value) params.set(key, value);
  }
  redirect("/partners?" + params.toString());
}
