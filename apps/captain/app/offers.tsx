import CaptainCapabilityScreen from "../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../src/features/access/protected-route";

export default function CaptainOffersRoute() {
  return <CaptainProtectedRoute><CaptainCapabilityScreen title="عروض التوصيل" message="العروض لا تعني إسنادًا ناجحًا. القبول والرفض وتوقيت انتهاء العرض يحدده DSH، ولا يظهر موقع التسليم التفصيلي قبل فوز الكابتن بإسناد صالح." /></CaptainProtectedRoute>;
}
