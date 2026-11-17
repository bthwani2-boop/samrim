import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function QuickPrices() {
  return <MerchantCapabilityScreen title="الأسعار والمخزون" message="لا تتغير الأسعار أو كميات المخزون إلا بعد تحقق DSH وتأكيد الحفظ." />;
}
