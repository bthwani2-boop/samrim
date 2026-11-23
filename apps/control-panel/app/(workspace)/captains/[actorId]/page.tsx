import CaptainStandingDetail from "../../../../src/features/captains/captain-standing-detail";
import WorkspaceUnavailable from "../../../../src/features/operator-shell/workspace-unavailable";
import { currentOperatorAccess } from "../../../../src/server/current-operator-access";

export default async function Page({ params }: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await params;
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("operations")) {
    return <WorkspaceUnavailable title="ملف الكابتن" description="تتطلب مراجعة الكابتن صلاحية العمليات لدى Identity." owner="Identity" />;
  }
  return <CaptainStandingDetail key={JSON.stringify([access.actorId, actorId])}
    actorId={actorId} operatorId={access.actorId} />;
}
