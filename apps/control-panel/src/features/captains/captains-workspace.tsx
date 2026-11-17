import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function CaptainsWorkspace({ title = "الكباتن" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="حالة الكابتن ومهامه وعلاقاته التشغيلية بعد التحقق من هوية الممثل." owner="DSH" />;
}
