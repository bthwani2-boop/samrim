import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function Receivables({ title = "الذمم المدينة" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="استعراض الذمم المستحقة وفق دفتر WLT وصلاحيات العمليات المالية." owner="WLT" />;
}
