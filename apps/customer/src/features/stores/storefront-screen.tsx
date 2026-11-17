import PublicStoreDetail from "./store-detail-screen";

export default function StorefrontScreen({ storeId }: Readonly<{ storeId: string }>) {
  return <PublicStoreDetail storeID={storeId} fullPage />;
}
