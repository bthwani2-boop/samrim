import type { MerchantInventorySummary } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { readMerchantInventorySummary } from "./catalog-transport";

type SummaryState = { scope: string; summary?: MerchantInventorySummary; error?: boolean };

export default function InventorySummary({ actorId, storeId, onShowStockout }: Readonly<{
  actorId: string; storeId: string; onShowStockout?: () => void;
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
  const metrics = summary ? [
    ["إجمالي العروض", summary.totalOffers],
    ["العروض المنشورة", summary.publishedOffers],
    ["متاحة ضمن الكتالوج", summary.availableOffers],
    ["غير متاحة ضمن المنشورة", summary.unavailableOffers],
    ["نافدة المخزون", summary.stockoutOffers],
  ] as const : [];
  return <View testID="merchant-inventory-summary" style={{
    backgroundColor: theme.surface, borderColor: theme.borderColor,
    borderWidth: 1, borderRadius: 12, padding: 15, gap: 10,
  }}>
    <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 17 }}>ملخص مخزون المتجر</Text>
    <Text style={{ color: theme.colorSecondary }}>يشمل جميع عروض المتجر، وليس الصفحة الحالية. لا تعني إتاحة العرض أن المتجر مفتوح للطلبات.</Text>
    {summary ? <View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}>
      {metrics.map(([label, value]) => <View key={label} style={{ flexGrow: 1, minWidth: 120, gap: 4 }}>
        <Text style={{ color: theme.colorSecondary }}>{label}</Text>
        <Text style={{ color: theme.color, fontSize: 20, fontWeight: "700" }}>{value.toLocaleString("ar-YE")}</Text>
      </View>)}
      {summary.stockoutOffers > 0 && onShowStockout ? (
        <Pressable accessibilityRole="button" onPress={onShowStockout} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: theme.interactiveText }}>عرض العروض النافدة</Text>
        </Pressable>
      ) : null}
    </View> : visible?.error ? <>
      <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تعذّر قراءة ملخص المخزون لدى DSH.</Text>
      <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
      </Pressable>
    </> : <ActivityIndicator accessibilityLabel="جارٍ قراءة ملخص المخزون" />}
  </View>;
}
