import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function CatalogImport() {
  return <MerchantCapabilityScreen title="استيراد الكتالوج" message="الاستيراد يتطلب تحقق الملف والتحويل والحفظ لدى DSH." />;
}
