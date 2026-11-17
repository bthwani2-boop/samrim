import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreProfile() {
  return <MerchantCapabilityScreen title="بيانات المتجر" message="عرض وتعديل بيانات المتجر يتطلبان تفويضًا وحفظًا لدى DSH." />;
}
