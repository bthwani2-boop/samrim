import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreScope() {
  return <MerchantCapabilityScreen title="نطاق المتجر" message="لا يمكن عرض متجر أو تبديل نطاقه دون جلسة Identity ومنح DSH ساري المفعول." />;
}
