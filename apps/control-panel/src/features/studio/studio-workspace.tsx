import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function StudioWorkspace({ title = "استوديو التصميم" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="المسودات والمراجعة والنشر والإرجاع من عقد واحد؛ دون ناشر موازٍ." owner="DSH" />;
}
