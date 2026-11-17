import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function HrWorkspace({ title = "الإدارة والموظفون" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="إدارة السجلات الوظيفية لدى DSH دون إصدار هويات وصلاحيات." owner="DSH" />;
}
