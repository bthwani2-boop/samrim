import CaptainCapabilityScreen from "../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../src/features/access/protected-route";

export default function CaptainOffersRoute() {
  return <CaptainProtectedRoute><CaptainCapabilityScreen title="عروض التوصيل" message="ستظهر العروض المرسلة إليك هنا عند تفعيل الخدمة." returnTo="/home" /></CaptainProtectedRoute>;
}
