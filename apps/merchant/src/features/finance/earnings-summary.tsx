import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function EarningsSummary() {
  return <MerchantCapabilityScreen title="ملخص المستحقات" message="الملخص المالي يجب أن يتطابق مع سجل WLT دون أرقام تقديرية." />;
}
