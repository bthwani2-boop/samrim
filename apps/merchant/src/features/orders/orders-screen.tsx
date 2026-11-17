import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function OrdersScreen() {
  return <MerchantCapabilityScreen title="الطلبات" message="عرض الطلبات مرتبط بمتجر مصرح به، وتصدر تفاصيل الطلب من DSH." />;
}
