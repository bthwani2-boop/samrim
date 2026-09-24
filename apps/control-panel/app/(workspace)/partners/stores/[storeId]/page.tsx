import { StoreWorkspace } from "../../../../../src/features/partner-onboarding/store-workspace";

export default async function PartnerStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return <StoreWorkspace storeId={storeId} />;
}
