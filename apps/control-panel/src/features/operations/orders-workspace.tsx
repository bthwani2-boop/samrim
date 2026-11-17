import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function OrdersWorkspace({ title = "العمليات والطلبات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="متابعة الطلبات وحالاتها والبحث والتصفية بعد ربط عقود الطلبات وصلاحيات التشغيل." owner="DSH" />;
}
