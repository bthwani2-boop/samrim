import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function OrderConversation() {
  return <MerchantCapabilityScreen title="محادثة الطلب" message="تبادل الرسائل يتطلب تحقق الطرفين وعزل المحادثة لكل طلب." />;
}
