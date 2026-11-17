import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function EffectivePolicyEditor({ title = "سياسات أزمنة المراحل" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="قراءة السياسات الفعالة من مالكها القانوني لا من قيم ثابتة في الواجهة." owner="متعددة" />;
}
