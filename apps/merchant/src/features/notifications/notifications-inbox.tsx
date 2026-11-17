import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function NotificationsInbox() {
  return <MerchantCapabilityScreen title="الإشعارات" message="تُعرض الإشعارات الخاصة بالتاجر بعد التحقق من هوية المستلم ونطاق المتجر." />;
}
