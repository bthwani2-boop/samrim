import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function OrderDetailScreen() {
  return <MerchantCapabilityScreen title="تفاصيل الطلب" message="يُتحقق من حق عرض هذا الطلب لدى DSH قبل إظهار معلوماته." />;
}
