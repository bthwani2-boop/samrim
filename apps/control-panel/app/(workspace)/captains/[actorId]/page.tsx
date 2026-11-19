import CaptainStandingDetail from "../../../../src/features/captains/captain-standing-detail";

export default async function Page({ params }: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await params;
  return <CaptainStandingDetail actorId={actorId} />;
}
