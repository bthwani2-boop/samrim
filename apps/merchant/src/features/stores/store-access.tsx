import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreAccess() {
  return <MerchantCapabilityScreen title="صلاحيات المتجر" message="Identity يثبت الهوية وDSH يقرر صلاحيات المتجر المحدد." />;
}
