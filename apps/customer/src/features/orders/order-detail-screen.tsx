import CapabilityUnavailableScreen from "../../components/capability-unavailable-screen";
import OrderConversation from "./order-conversation";
import OrderTracking from "./order-tracking";

export default function OrderDetailScreen() {
  return <><OrderTracking /><OrderConversation /><CapabilityUnavailableScreen title="تفاصيل الطلب" message="التتبع والمحادثة وتحديث الحالة تحتاج تحقق DSH من ملكية الطلب وصلاحيات المشاركين."  /></>;
}
