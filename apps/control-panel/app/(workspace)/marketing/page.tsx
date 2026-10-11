import { redirect } from "next/navigation";
import { workspaceMarketingResources } from "../../../src/navigation/workspace-registry";

export default function MarketingPage() {
  redirect(workspaceMarketingResources[0].href);
}

export const metadata = { title: "التسويق والمحتوى" };
