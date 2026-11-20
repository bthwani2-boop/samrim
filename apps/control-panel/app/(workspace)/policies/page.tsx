import PoliciesWorkspace from "../../../src/features/policies/policies-workspace";
import WorkspaceUnavailable from "../../../src/features/operator-shell/workspace-unavailable";
import { currentOperatorAccess } from "../../../src/server/current-operator-access";

export default async function Page() {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("platform_policies")) {
    return <WorkspaceUnavailable title="السياسات" description="يتطلب تحرير السياسات صلاحية مؤكدة من Identity." owner="Identity" />;
  }
  return <PoliciesWorkspace key={access.actorId} actorId={access.actorId} />;
}
