import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function ProductEditor() {
  return <MerchantCapabilityScreen title="تحرير المنتج" message="إنشاء المنتجات وتعديلها يتطلبان عقد DSH وصلاحيات المتجر." />;
}
