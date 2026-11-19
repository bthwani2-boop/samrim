import CaptainCapabilityScreen from "../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../src/features/access/protected-route";

export default function CaptainNotificationsRoute() {
  return <CaptainProtectedRoute><CaptainCapabilityScreen title="الإشعارات" message="ستجد إشعارات مهامك ومراسلاتك هنا عند تفعيل الخدمة." returnTo="/home" /></CaptainProtectedRoute>;
}
