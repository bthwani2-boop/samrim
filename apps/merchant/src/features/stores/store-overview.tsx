import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreOverview() {
  return <MerchantCapabilityScreen title="لوحة المتجر" message="بيانات المتجر وحالته تعتمد على قراءة موثقة من DSH." />;
}
