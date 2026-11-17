import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreRelationChoice() {
  return <MerchantCapabilityScreen title="طريقة عمل المتجر" message="يحدد DSH طريقة عمل المتجر وإتاحة التسجيل. لا يمكن اعتماد اختيار قبل التحقق من السياسة الحالية." />;
}
