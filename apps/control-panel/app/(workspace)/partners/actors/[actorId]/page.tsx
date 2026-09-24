import { PartnerDetailWorkspace } from "../../../../../src/features/partner-onboarding/partner-detail-workspace";

export default async function PartnerDetailPage({ params }: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await params;
  return <PartnerDetailWorkspace actorId={actorId} />;
}
