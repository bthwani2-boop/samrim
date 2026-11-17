import MerchantCapabilityScreen from "../../components/merchant-capability-screen";

// Presentation only. Owner contracts are not yet connected; no local business mutation.
export default function PayoutRecipients() {
  return <MerchantCapabilityScreen title="مستفيدو التحويل" message="تعديل حسابات الاستلام يحتاج تفويضًا ماليًا وتحققًا لدى المالك المعتمد." />;
}
