import CaptainCapabilityScreen from "../../components/captain-capability-screen";
/** Show only inbox events scoped to the signed-in Captain from their owning service. */
export default function NotificationsInbox() {
  return <CaptainCapabilityScreen title="إشعارات الكابتن" message="صندوق الإشعارات ينتظر هوية كابتن موثقة ومصدر أحداث مصرحًا به من Identity وDSH." />;
}
