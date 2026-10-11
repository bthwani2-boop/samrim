import { redirect } from "next/navigation";
import { workspaceFinanceResources } from "../../../src/navigation/workspace-registry";

export default function FinancePage() {
  redirect(workspaceFinanceResources[0].href);
}

export const metadata = { title: "المالية" };
