export type FinanceReferenceRow = Readonly<{
  key: string; source: "custody" | "commissions" | "batches" | "withdrawals";
  id: string; subject: string; reference: string; category: string; state: string;
  amount: string; amountMinor?: number; priority: number; nextStep: string; date?: string;
}>;
export type FinanceReferenceWorkflow = "custody" | "commissions" | "batches" | "withdrawals" | "settlement-partner" | "settlement-captain" | "agreements";
export type FinanceReferenceTab = "command" | "wallets" | "activity" | "collection" | "settlements" | "reconcile" | "pending" | "reports";
