import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function DispatchOversight({ title = "متابعة الإسناد" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="مراقبة التوزيع على الكباتن وحالات السباق والاستثناءات من مصدر التوزيع القانوني." owner="DSH" />;
}
