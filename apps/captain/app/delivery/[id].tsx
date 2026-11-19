import CaptainCapabilityScreen from "../../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../../src/features/access/protected-route";

export default function CaptainDeliveryDetailRoute() {
  return <CaptainProtectedRoute><CaptainCapabilityScreen title="تفاصيل التوصيل" message="تظهر تفاصيل المهمة وعنوان التسليم للكابتن المكلّف عند تفعيل الخدمة." returnTo="/home" /></CaptainProtectedRoute>;
}
