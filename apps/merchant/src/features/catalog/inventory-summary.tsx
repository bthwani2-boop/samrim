import type { MerchantCatalogStatus, MerchantInventorySummary } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { readMerchantInventorySummary } from "./catalog-transport";

type SummaryState = { scope: string; summary?: MerchantInventorySummary; error?: boolean };

const formatPercent = new Intl.NumberFormat("ar-YE", { style: "percent", maximumFractionDigits: 1 });

export default function InventorySummary({ actorId, storeId, onShowStatus }: Readonly<{
  actorId: string;
  storeId: string;
  onShowStatus?: (status: MerchantCatalogStatus | undefined) => void;
}>) {
  const { theme } = useMobileAppearance();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SummaryState>({ scope: "" });
  const scope = JSON.stringify([actorId, storeId, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ scope });
    void readMerchantInventorySummary(storeId, actorId, controller.signal)
      .then(summary => {
        if (!controller.signal.aborted) setState({ scope, summary });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ scope, error: true });
      });
    return () => controller.abort();
  }, [actorId, storeId, scope]);

  const visible = state.scope === scope ? state : undefined;
  const summary = visible?.summary;
  const metrics: ReadonlyArray<{
    label: string; count: number; action?: string; status?: MerchantCatalogStatus;
  }> = summary ? [
    { label: "إجمالي العروض", count: summary.totalOffers, action: "عرض جميع العروض" },
    { label: "العروض المنشورة", count: summary.publishedOffers, action: "عرض العروض المنشورة", status: "published" },
    { label: "العروض غير المنشورة", count: summary.totalOffers - summary.publishedOffers, action: "عرض العروض غير المنشورة", status: "unpublished" },
    { label: "متاحة ضمن الكتالوج", count: summary.availableOffers, action: "عرض العروض المتاحة", status: "available" },
    { label: "غير متاحة ضمن المنشورة", count: summary.unavailableOffers, action: "عرض العروض غير المتاحة", status: "unavailable" },
    { label: "نافدة المخزون", count: summary.stockoutOffers, action: "عرض العروض النافدة", status: "stockout" },
    { label: "غير متاحة لأسباب غير النفاد", count: summary.unavailableOffers - summary.stockoutOffers },
  ] : [];
  const ratios = summary ? [
    { label: "نسبة النشر", numerator: summary.publishedOffers, denominator: summary.totalOffers },
    { label: "نسبة التوافر ضمن المنشورة", numerator: summary.availableOffers, denominator: summary.publishedOffers },
  ] : [];

  return <View testID="merchant-inventory-summary" style={{
    backgroundColor: theme.surface, borderColor: theme.borderColor,
    borderWidth: 1, borderRadius: 12, padding: 15, gap: 10,
  }}>
    <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 17 }}>ملخص مخزون المتجر</Text>
    <Text style={{ color: theme.colorSecondary }}>يشمل جميع عروض المتجر، وليس الصفحة الحالية. لا تعني إتاحة العرض أن المتجر مفتوح للطلبات.</Text>
    {summary ? <>
      <View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}>
        {ratios.map(({ label, numerator, denominator }) => <View key={label} accessibilityLabel={label}
          style={{ flexGrow: 1, minWidth: 140, gap: 4 }}>
          <Text style={{ color: theme.colorSecondary }}>{label}</Text>
          <Text style={{ color: theme.color, fontSize: 20, fontWeight: "700" }}>
            {denominator === 0 ? "لا ينطبق" : formatPercent.format(numerator / denominator)}
          </Text>
          <Text style={{ color: theme.colorSecondary }}>
            {numerator.toLocaleString("ar-YE")} من {denominator.toLocaleString("ar-YE")}
          </Text>
        </View>)}
      </View>
      <View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}>
        {metrics.map(({ label, count, action, status }) => <View key={label}
          style={{ flexGrow: 1, minWidth: 120, gap: 4 }}>
          <Text style={{ color: theme.colorSecondary }}>{label}</Text>
          <Text style={{ color: theme.color, fontSize: 20, fontWeight: "700" }}>{count.toLocaleString("ar-YE")}</Text>
          {count > 0 && action && onShowStatus ? <Pressable accessibilityRole="button"
            accessibilityLabel={action} onPress={() => onShowStatus(status)}
            style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: theme.interactiveText }}>{action}</Text>
          </Pressable> : null}
        </View>)}
      </View>
    </> : visible?.error ? <>
      <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تعذّر قراءة ملخص المخزون لدى DSH.</Text>
      <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}
        style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
      </Pressable>
    </> : <ActivityIndicator accessibilityLabel="جارٍ قراءة ملخص المخزون" />}
  </View>;
}
