import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function InventorySummary() {
  return <MerchantCapabilityScreen title="ملخص المخزون" message="المخزون الحقيقي يُقرأ من DSH ولا تُنشأ كميات محلية افتراضية." />;
}
