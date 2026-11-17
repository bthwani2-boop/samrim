import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreSetupScreen() {
  return <MerchantCapabilityScreen title="إعداد المتجر" message="لا يمكن إنشاء متجر أو نشره دون التحقق من هوية التاجر وشروط التسجيل وصلاحيات DSH." />;
}
