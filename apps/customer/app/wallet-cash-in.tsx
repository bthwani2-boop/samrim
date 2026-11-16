import CapabilityUnavailableScreen from "../src/components/capability-unavailable-screen";

export default function WalletCashInRoute() {
  return <CapabilityUnavailableScreen title="شحن المحفظة" message="لا نقبل تعليمات شحن أو نعرض نجاح التمويل قبل تحقق WLT من العملية وتسجيلها النهائي." />;
}
