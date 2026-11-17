import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function InsightsScreen() {
  return <MerchantCapabilityScreen title="الأداء والتقارير" message="التقارير مشتقة من بيانات الطلبات الفعلية في DSH دون أرقام مصطنعة." />;
}
