import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import StoreRegistrationPolicyEditor from "../../../../src/features/policies/store-registration-policy-editor";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";

export default async function Page() {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("platform_policies")) {
    return <WorkspaceUnavailable title="سياسة قبول المتاجر"
      description="يتطلب تعديل قبول المتاجر جلسة مشغّل فعّالة وصلاحية platform_policies مثبتة في Identity."
      owner="Identity" />;
  }
  return <StoreRegistrationPolicyEditor key={access.actorId} actorId={access.actorId} />;
}
