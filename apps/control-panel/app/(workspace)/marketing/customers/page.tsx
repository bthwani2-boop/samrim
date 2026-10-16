import { CustomerDirectory } from "../../../../src/features/customers/customer-directory";
import { MarketingWorkspace } from "../../../../src/features/marketing/marketing-workspace";

export default function MarketingCustomersPage() {
  return <MarketingWorkspace resource="customers"><CustomerDirectory /></MarketingWorkspace>;
}

export const metadata = { title: "العملاء | التسويق والمحتوى" };
