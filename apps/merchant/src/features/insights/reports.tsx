import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function Reports() {
  return <MerchantCapabilityScreen title="التقارير التفصيلية" message="يتطلب إعداد التقارير بيانات صالحة ومحددة الصلاحية من المالك." />;
}
