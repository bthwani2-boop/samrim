import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function StoreReview({ title = "طلبات انضمام المتاجر" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="مراجعة حالة طلب الانضمام ونطاق المستندات من مالك المتجر." owner="DSH" />;
}
