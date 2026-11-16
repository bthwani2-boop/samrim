import CapabilityUnavailableScreen from "../src/components/capability-unavailable-screen";

export default function MultiStoreCheckoutRoute() {
  return <CapabilityUnavailableScreen title="الطلب من عدة متاجر" message="تأكيد الطلبات المتعددة يتطلب معالجة مستقلة وآمنة لكل متجر عبر DSH وWLT؛ لم تُفعّل هذه العمليات بعد." />;
}
