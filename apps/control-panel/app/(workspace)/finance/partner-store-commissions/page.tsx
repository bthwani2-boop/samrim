import { redirect } from "next/navigation";

// Compatibility redirect for previously issued Operator finance URLs.
export default function LegacyFinanceRoute() {
  redirect("/finance/merchant-store-commissions");
}
