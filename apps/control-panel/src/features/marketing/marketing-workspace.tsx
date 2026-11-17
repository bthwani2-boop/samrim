import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function MarketingWorkspace({ title = "التسويق والتحليلات" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="تحليلات ومؤشرات التسويق ذات مصدر وفترة قياس موثّقين." owner="DSH" />;
}
