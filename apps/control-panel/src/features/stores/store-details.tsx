import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function StoreDetails({ title = "ملف المتجر" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="عرض معلومات المتجر والاتفاقيات المرتبطة دون تحويل الشاشة إلى مالك للبيانات." owner="DSH" />;
}
