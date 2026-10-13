import { PartnerDetailWorkspace } from "../../../../../src/features/partners/partner-detail-workspace";

export default async function PartnerDetailPage({ params }: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await params;
  return <PartnerDetailWorkspace actorId={actorId} />;
}

export const metadata = { title: "ملف الشريك" };
