import CaptainCapabilityScreen from "../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../src/features/access/protected-route";

export default function CaptainNotificationsRoute() {
  return <CaptainProtectedRoute><CaptainCapabilityScreen title="الإشعارات" message="إشعارات المهام والمراسلات لا تُعرض حتى ترتبط بالجلسة الحالية وبصلاحيات المهمة لدى Identity وDSH." /></CaptainProtectedRoute>;
}
