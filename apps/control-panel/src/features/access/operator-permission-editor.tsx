import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function OperatorPermissionEditor({ title = "صلاحيات المشغّل" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="التحقق من التفويض الحالي قبل عرض سجل المنح والمراجعة." owner="Identity" />;
}
