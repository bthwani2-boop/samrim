import { CaptainDetailWorkspace } from "../../../../src/features/captain/captain-detail-workspace";

export default async function CaptainDetailPage({ params }: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await params;
  return <CaptainDetailWorkspace actorId={actorId} />;
}
export const metadata = { title: "ملف الكابتن" };
