import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";

export default function AddressEditor(_props: Readonly<{ onSelect?: (pin: { latitude: number; longitude: number }) => void }> = {}) {
  return <CapabilityUnavailableScreen title="تعديل العنوان" message="لا يُسمح بعرض أو تعديل عنوان خاص دون تحقق DSH من ملكيته للحساب الحالي." />;
}
