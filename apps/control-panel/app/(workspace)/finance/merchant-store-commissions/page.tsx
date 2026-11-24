import CommercialAgreementReviewPage from "../../../../src/features/finance/commercial-agreement-review";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  return <CommercialAgreementReviewPage title="عمولات المتاجر والاشتراكات" query={await searchParams} />;
}
