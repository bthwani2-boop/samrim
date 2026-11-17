import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function MerchantApplication() {
  return <MerchantCapabilityScreen title="طلب الانضمام" message="يتطلب تقديم الطلب اتصالًا مع DSH والتحقق من هوية مقدم الطلب عبر Identity؛ لا يتم حفظ طلب تجريبي." />;
}
