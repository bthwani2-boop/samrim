import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function WalletScreen() {
  return <MerchantCapabilityScreen title="المالية" message="لا تُعرض الأرصدة أو المستحقات إلا من WLT بعد إثبات صلاحية التاجر." />;
}
