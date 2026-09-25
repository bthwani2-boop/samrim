import { redirect } from "next/navigation";

export default async function FinanceBeneficiarySettlementPage({ searchParams }: Readonly<{ searchParams: Promise<{ batchId?: string | string[] }> }>) {
  const { batchId } = await searchParams;
  const query = typeof batchId === "string" && batchId.trim() ? `?batchId=${encodeURIComponent(batchId.trim())}` : "";
  redirect(`/finance/beneficiary-settlement/partners${query}`);
}
