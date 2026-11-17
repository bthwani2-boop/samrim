import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function CashCustody({ title = "عهدة النقد" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="متابعة عهدة التحصيل وتسوية النقديات من القراءة المعتمدة لدى WLT." owner="WLT" />;
}
