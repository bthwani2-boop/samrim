import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function AccessWorkspace({ title = "الوصول والصلاحيات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="فحص الصلاحيات الفعالة من Identity قبل أي عملية منح أو إلغاء." owner="Identity" />;
}
