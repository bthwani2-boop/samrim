import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreSelector() {
  return <MerchantCapabilityScreen title="اختيار المتجر" message="تظهر المتاجر التي يسمح DSH للتاجر بالوصول إليها فقط بعد التحقق من الجلسة." />;
}
