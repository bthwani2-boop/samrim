import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function OrderExceptions({ title = "استثناءات العمليات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="مراجعة الاستثناءات مع سجل تدقيق وصلاحيات مستقلة لأي إجراء." owner="DSH" />;
}
