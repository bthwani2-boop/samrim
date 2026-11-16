import CapabilityUnavailableScreen from "../../src/components/capability-unavailable-screen";

export default function CheckoutRoute() {
  return <CapabilityUnavailableScreen title="تأكيد الطلب" message="إنشاء الطلب والدفع محجوبان حتى تكتمل عروض الأسعار المؤكدة من DSH وتفويض المدفوعات من WLT." />;
}
