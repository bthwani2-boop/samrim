import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function CustomersWorkspace({ title = "العملاء" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="البيانات الخاصة بالعملاء تتطلب نطاقًا واضحًا وصلاحيات قائمة على الدور." owner="Identity" />;
}
