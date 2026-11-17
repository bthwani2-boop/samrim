import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function PromotionsWorkspace({ title = "العروض الترويجية" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="إدارة العروض بعد التحقق من أهلية التطبيق والعقد القانوني." owner="DSH" />;
}
