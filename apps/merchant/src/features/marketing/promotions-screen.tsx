import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function PromotionsScreen() {
  return <MerchantCapabilityScreen title="العروض" message="إنشاء العروض أو نشرها يخضع لصلاحيات DSH وشروط العرض." />;
}
