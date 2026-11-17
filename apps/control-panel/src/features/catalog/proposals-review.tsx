import WorkspaceUnavailable from "../operator-shell/workspace-unavailable";

export default function ProposalsReview({ title = "مقترحات الكتالوج" }: Readonly<{ title?: string }>) {
  return <WorkspaceUnavailable title={title} description="مراجعة المقترحات قبل اعتمادها ونشرها لدى المالك." owner="DSH" />;
}
