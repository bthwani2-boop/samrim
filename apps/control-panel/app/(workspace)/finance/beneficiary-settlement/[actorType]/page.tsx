import { notFound } from "next/navigation";
import { BeneficiarySettlementWorkspace, type BeneficiarySettlementInitialQuery } from "../../../../../src/features/finance/beneficiary-settlement-workspace";
import { FinanceWorkspace } from "../../../../../src/features/finance/finance-workspace";
import type { FinanceResourceKey } from "../../../../../src/navigation/workspace-registry";

const resources = {
  partners: { resource: "beneficiary-settlement-partners", actorType: "partner" },
  captains: { resource: "beneficiary-settlement-captains", actorType: "captain" },
  field: { resource: "beneficiary-settlement-field", actorType: "field" },
} as const satisfies Record<string, Readonly<{ resource: FinanceResourceKey; actorType: "partner" | "captain" | "field" }>>;

export default async function FinanceBeneficiarySettlementRegistryPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ actorType: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const [{ actorType }, query] = await Promise.all([params, searchParams]);
  if (!Object.hasOwn(resources, actorType)) notFound();
  const selected = resources[actorType as keyof typeof resources];
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] ?? "" : value ?? "";
  };
  const rawStatus = first("status");
  const rawSort = first("sort");
  const rawView = first("view");
  const batchStatuses = ["DRAFT", "PREPARED", "APPROVED", "FROZEN", "EXECUTION_IN_PROGRESS", "AWAITING_VERIFICATION", "AWAITING_RECONCILIATION", "COMPLETED", "CANCELLED", "EXCEPTION"];
  const initialQuery: BeneficiarySettlementInitialQuery = {
    status: ["", "NO_REQUEST", "HELD", "PREPARED", "APPROVED", "FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION", "CANCELLED"].includes(rawStatus) ? rawStatus as BeneficiarySettlementInitialQuery["status"] : "",
    search: first("search").trim().slice(0, 128),
    sort: ["actor_asc", "actor_desc", "available_asc", "available_desc", "held_asc", "held_desc", "payout_amount_asc", "payout_amount_desc"].includes(rawSort) ? rawSort as BeneficiarySettlementInitialQuery["sort"] : "actor_asc",
    cursor: first("cursor").slice(0, 1024),
    view: ["beneficiaries", "batches", "reconciliation"].includes(rawView) ? rawView as BeneficiarySettlementInitialQuery["view"] : "beneficiaries",
    batchId: first("batchId").trim().slice(0, 128),
    batchStatus: batchStatuses.includes(first("batchStatus")) ? first("batchStatus") : "",
    batchCursor: first("batchCursor").slice(0, 1024),
  };
  return (
    <FinanceWorkspace resource={selected.resource}>
      <BeneficiarySettlementWorkspace actorType={selected.actorType} initialQuery={initialQuery} />
    </FinanceWorkspace>
  );
}
