import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function StoreBanners() {
  return <MerchantCapabilityScreen title="لافتات المتجر" message="النشر والتعديل يتطلبان تحقق DSH ومراجعة الصور." />;
}
