import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function CatalogExport() {
  return <MerchantCapabilityScreen title="تصدير الكتالوج" message="التصدير يتطلب قراءة مصرّحًا بها لبيانات المتجر من DSH." />;
}
