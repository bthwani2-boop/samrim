import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function OrderDetail({ title = "تفاصيل الطلب" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="عرض تفاصيل الطلب واستثناءاته بعد تحقق صلاحيات المشغّل ونطاق البيانات." owner="DSH" />;
}
