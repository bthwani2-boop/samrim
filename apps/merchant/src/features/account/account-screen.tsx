import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function AccountScreen() {
  return <MerchantCapabilityScreen title="حساب التاجر" message="البيانات الشخصية والجلسة والصلاحيات مصدرها Identity فقط." />;
}
