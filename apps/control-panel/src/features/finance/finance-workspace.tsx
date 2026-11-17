import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function FinanceWorkspace({ title = "المالية" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="عرض الحالة المالية دون حساب أرصدة أو إعادة بناء دفتر الحسابات داخل اللوحة." owner="WLT" />;
}
