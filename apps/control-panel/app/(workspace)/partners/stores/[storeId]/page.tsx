import { StoreWorkspace } from "../../../../../src/features/stores/store-workspace";

export default async function PartnerStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return <StoreWorkspace storeId={storeId} />;
}

export const metadata = { title: "ملف المتجر" };
