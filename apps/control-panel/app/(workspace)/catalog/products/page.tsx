import PublishedOffers from "../../../../src/features/catalog/published-offers";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  return <PublishedOffers searchParams={searchParams} pathname="/catalog/products" />;
}
