import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function EmployeesWorkspace({ title = "الموظفون" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="استعراض سجلات الموظفين والارتباطات القانونية دون انتحال دور Identity." owner="DSH" />;
}
