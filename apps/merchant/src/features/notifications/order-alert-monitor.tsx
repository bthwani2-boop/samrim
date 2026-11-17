import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function OrderAlertMonitor() {
  return <MerchantCapabilityScreen title="تنبيهات الطلبات" message="تشغيل التنبيهات يحتاج اشتراكًا مصرحًا به ومنع تكرار الإشعار." />;
}
