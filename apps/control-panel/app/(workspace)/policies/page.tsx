import { redirect } from "next/navigation";
import { workspacePolicyResources } from "../../../src/navigation/workspace-registry";

export default function PoliciesPage() {
  redirect(workspacePolicyResources[0].href);
}

export const metadata = { title: "السياسات" };
