import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function NotificationsWorkspace({ title = "الإشعارات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="أحداث الإشعارات ومصادرها وفق عقد موثق وصلاحيات وصول." owner="متعددة" />;
}
