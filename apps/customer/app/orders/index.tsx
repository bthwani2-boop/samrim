import CapabilityUnavailableScreen from "../../src/components/capability-unavailable-screen";

export default function OrdersRoute() {
  return <CapabilityUnavailableScreen title="طلباتي" message="سجل الطلبات لا يظهر إلا بعد جلسة Identity صحيحة وتحقق DSH من ملكية الطلبات." />;
}
