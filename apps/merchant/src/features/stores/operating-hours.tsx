import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function OperatingHours() {
  return <MerchantCapabilityScreen title="ساعات العمل" message="ساعات العمل المحفوظة والحالات التشغيلية مصدرها DSH." />;
}
