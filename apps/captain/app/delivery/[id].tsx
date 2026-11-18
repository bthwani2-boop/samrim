import CaptainCapabilityScreen from "../../src/components/captain-capability-screen";
import CaptainProtectedRoute from "../../src/features/access/protected-route";

export default function CaptainDeliveryDetailRoute() {
  return <CaptainProtectedRoute><CaptainCapabilityScreen title="تفاصيل التوصيل" message="لا يُكشف عنوان العميل ولا تفاصيل المهمة إلا للكابتن المكلّف بعد تحقق DSH من الجلسة والإسناد. إثبات الاستلام والتسليم يحتاج تأكيد الخدمة المالكة ولا يعتمد على زر محلي." /></CaptainProtectedRoute>;
}
