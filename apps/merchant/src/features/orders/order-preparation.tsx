import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function OrderPreparation() {
  return <MerchantCapabilityScreen title="تحضير الطلب" message="تحديث حالة التحضير يحتاج أمرًا موثقًا من DSH ولا يُعتمد محليًا." />;
}
