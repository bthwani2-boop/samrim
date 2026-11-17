import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function ContentWorkspace({ title = "المحتوى" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="تنظيم دورة مراجعة المحتوى والنشر من مالك المحتوى." owner="DSH" />;
}
