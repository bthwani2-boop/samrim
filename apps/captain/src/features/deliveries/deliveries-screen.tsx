import CaptainCapabilityScreen from "../../components/captain-capability-screen";
/** Read actual assigned tasks only through an authenticated DSH Captain endpoint. */
export default function DeliveriesScreen() {
  return <CaptainCapabilityScreen title="التوصيلات" message="لا يمكن عرض قائمة التوصيلات حتى تتوفر جلسة كابتن موثقة وواجهة DSH للمهام المصرح بها." />;
}
