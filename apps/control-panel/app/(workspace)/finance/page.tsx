import { FinanceCenterWorkspace } from "../../../src/features/finance/finance-center-workspace";

export default async function FinancePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  return <FinanceCenterWorkspace initialQuery={await searchParams} />;
}

export const metadata = { title: "المالية" };
