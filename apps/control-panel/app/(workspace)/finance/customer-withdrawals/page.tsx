import { CustomerWithdrawalQueue, type CustomerWithdrawalQueueQuery } from "../../../../src/features/finance/customer-withdrawal-queue";
import { FinanceWorkspace } from "../../../../src/features/finance/finance-workspace";

type SearchValue = string | string[] | undefined;

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function FinanceCustomerWithdrawalsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, SearchValue>> }>) {
  const query = await searchParams;
  const rawSort = first(query.sort);
  const rawStatus = first(query.status);
  const initialQuery: CustomerWithdrawalQueueQuery = {
    status: ["REQUESTED", "DESTINATION_PENDING", "PAYOUT_HELD", "REJECTED", "COMPLETED"].includes(rawStatus) ? rawStatus : "",
    search: first(query.search).slice(0, 128),
    sort: rawSort === "requested_asc" ? "requested_asc" : "requested_desc",
    cursor: first(query.cursor).slice(0, 1024),
    intakeId: first(query.intakeId).slice(0, 128),
  };
  return <FinanceWorkspace resource="customer-withdrawals"><CustomerWithdrawalQueue initialQuery={initialQuery} /></FinanceWorkspace>;
}
