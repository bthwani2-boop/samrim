import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function CommercialAgreement() {
  return <MerchantCapabilityScreen title="الاتفاقية المالية" message="تُعرض شروط الاتفاقية المقبولة بعد التحقق من مصدرها القانوني والمالي." />;
}
