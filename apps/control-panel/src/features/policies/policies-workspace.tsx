import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function PoliciesWorkspace({ title = "محرر السياسات الموحد" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="تغيير السياسات بعقد DSH أو WLT ذي نسخة وتدقيق معتمدين." owner="متعددة" />;
}
