import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreAvailability() {
  return <MerchantCapabilityScreen title="إتاحة المتجر" message="الإتاحة لا تتغير محليًا؛ لا بد من اعتماد الحالة لدى DSH." />;
}
