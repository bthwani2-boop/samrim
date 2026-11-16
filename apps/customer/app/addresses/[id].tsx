import CapabilityUnavailableScreen from "../../src/components/capability-unavailable-screen";

export default function AddressDetailRoute() {
  return <CapabilityUnavailableScreen title="تعديل العنوان" message="لا يُسمح بعرض أو تعديل عنوان خاص دون تحقق DSH من ملكيته للحساب الحالي." />;
}
