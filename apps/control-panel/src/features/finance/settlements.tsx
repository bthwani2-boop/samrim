import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function Settlements({ title = "تسوية المستفيدين" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="مراجعة التسويات والعمولات من مالك الالتزامات المالية." owner="WLT" />;
}
