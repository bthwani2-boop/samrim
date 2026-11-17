import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function StoresWorkspace({ title = "الشركاء والمتاجر" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="إدارة Store منفصل عن حساب Merchant وعرض العلاقة وحالة النشر." owner="DSH" />;
}
