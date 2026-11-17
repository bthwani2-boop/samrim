import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function CaptainMemberships() {
  return <MerchantCapabilityScreen title="الكباتن المرتبطون" message="يحدد DSH أهلية الارتباط والتفويض ولا يمكن استنتاجها من بيانات التطبيق." />;
}
