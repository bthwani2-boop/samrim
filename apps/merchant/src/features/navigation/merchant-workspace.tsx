import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

/** Protected workspace presentation; routing and access remain owned by app/(app). */
export default function MerchantWorkspace() {
  return <MerchantCapabilityScreen title="مساحة التاجر" message="لا تُفتح المساحة دون جلسة Identity ومنح DSH موثّق." />;
}
