import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function HomeDashboard({ title = "الرئيسية والمؤشرات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="لوحة متابعة موحدة لمؤشرات الطلبات والشركاء والمالية ذات النطاق والزمن المتطابقين." owner="متعددة" />;
}
