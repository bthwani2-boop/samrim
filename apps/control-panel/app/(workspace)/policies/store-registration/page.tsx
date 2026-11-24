import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import StoreRegistrationPolicyEditor from "../../../../src/features/policies/store-registration-policy-editor";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";
import { loadPolicyCities } from "../../../../src/features/policies/policy-city-directory";

export const dynamic = "force-dynamic";

export default async function Page() {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("platform_policies")) {
    return <WorkspaceUnavailable title="سياسة قبول المتاجر"
      description="يتطلب تعديل قبول المتاجر جلسة مشغّل فعّالة وصلاحية platform_policies مثبتة في Identity."
      owner="Identity" />;
  }
  const directory = await loadPolicyCities();
  return <StoreRegistrationPolicyEditor key={access.actorId} actorId={access.actorId} directory={directory} />;
}
