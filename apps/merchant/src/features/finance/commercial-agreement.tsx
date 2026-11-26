import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import type { CommercialAgreementReview } from "@bthwani/wlt";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import { readMerchantCommercialAgreement } from "./commercial-agreement-transport";

const stateLabels = {
  AWAITING_MERCHANT_CONSENT: "بانتظار موافقة التاجر",
  AWAITING_FINANCE_REVIEW: "بانتظار المراجعة المالية",
  DECLINED: "مرفوض من التاجر",
  FINANCE_REJECTED: "مرفوض ماليًا",
  REVIEW_APPROVED_PENDING_ACTIVATION: "مراجَع، بانتظار التفعيل",
} as const;
const modes = { BTHWANI_CAPTAIN: "كابتن بثواني", PARTNER_CAPTAIN: "كابتن المتجر", CUSTOMER_PICKUP: "استلام العميل" } as const;

function AgreementDetails({ actorId, storeId }: { actorId: string; storeId: string }) {
  const { theme } = useMobileAppearance();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<CommercialAgreementReview | "error" | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry restarts the scoped owner read.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setResult("error"); }, 8000);
    setResult(null);
    void readMerchantCommercialAgreement(actorId, storeId, controller.signal).then(review => {
      if (!controller.signal.aborted) setResult(review);
    }).catch(() => {
      if (!controller.signal.aborted) setResult("error");
    }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [actorId, storeId, attempt]);
  const proposal = result && result !== "error" ? result.proposal : null;
  const line = (value: string) => <Text style={{ color: theme.color }}>{value}</Text>;
  return (
    <View style={{ gap: 10 }} testID="merchant-commercial-agreement">
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>آخر مقترح للاتفاقية المالية</Text>
      {line("المقترح لا يعني اتفاقية نافذة أو رصيدًا مستحقًا.")}
      {result === null ? line("جارٍ التحقق من WLT…") : result === "error" ?
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تعذر التحقق من الاتفاقية أو صلاحية المتجر.</Text> :
        !proposal ? line("لا يوجد مقترح مسجل لهذا المتجر.") : (
          <View style={{ gap: 8 }}>
            {line("الإصدار: " + proposal.version)}
            {line("الحالة: " + stateLabels[proposal.reviewState])}
            {line("العلاقة: " + (proposal.storeRelation === "MARKETPLACE" ? "السوق" : "مباشر"))}
            {line(proposal.feeModel === "COMMISSION" ? "العمولة: " + proposal.commissionBasisPoints / 100 + "%" :
              "الاشتراك: " + proposal.subscriptionAmountYer + " ريال يمني / " + proposal.subscriptionPeriodDays + " يوم")}
            {line("التحصيل: " + (proposal.collector === "PLATFORM_MANAGED" ? "بثواني" : "المتجر"))}
            {line("التنفيذ: " + proposal.fulfillmentModes.map(mode => modes[mode]).join("، "))}
            {line("موعد النفاذ المقترح (UTC): " + proposal.proposedEffectiveAt)}
          </View>
        )}
      <Pressable accessibilityRole="button" disabled={result === null} onPress={() => { setResult(null); setAttempt(value => value + 1); }}
        style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: theme.interactiveText }}>إعادة التحقق</Text>
      </Pressable>
    </View>
  );
}

export default function CommercialAgreement({ actorId = "", storeId = "" }: { actorId?: string; storeId?: string } = {}) {
  if (!actorId || !storeId) return <MerchantCapabilityScreen title="الاتفاقية المالية" message="اختر متجرًا من مساحة التاجر للتحقق من صلاحيتك." />;
  return <AgreementDetails key={JSON.stringify([actorId, storeId])} actorId={actorId} storeId={storeId} />;
}
