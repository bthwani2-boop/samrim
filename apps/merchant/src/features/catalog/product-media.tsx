import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function ProductMedia() {
  return <MerchantCapabilityScreen title="وسائط المنتجات" message="إضافة الصور تعتمد على صلاحية المتجر ومسار التخزين المعتمد." />;
}
