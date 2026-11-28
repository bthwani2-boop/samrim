import type { MerchantCatalogDraftHistoryPage } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { readMerchantCatalogDraftHistory } from "./catalog-transport";

type PageRequest = { beforeVersion?: string };
type Result = { scope: string; request: PageRequest; page?: MerchantCatalogDraftHistoryPage; error?: true };

export default function CatalogDraftHistory({ actorId, storeId, offerId }: Readonly<{
  actorId: string;
  storeId: string;
  offerId: string;
}>) {
  const { theme } = useMobileAppearance();
  const [request, setRequest] = useState<PageRequest>({});
  const [result, setResult] = useState<Result>();
  const scope = JSON.stringify([actorId, storeId, offerId]);

  useEffect(() => {
    const controller = new AbortController();
    void readMerchantCatalogDraftHistory(storeId, offerId, actorId, controller.signal, request.beforeVersion)
      .then(page => {
        if (!controller.signal.aborted) setResult({ scope, request, page });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ scope, request, error: true });
      });
    return () => controller.abort();
  }, [actorId, storeId, offerId, scope, request]);

  const current = result?.scope === scope && result.request === request ? result : undefined;
  const cursor = current?.page?.nextBeforeVersion;
  const actionStyle = { minHeight: 44, justifyContent: "center" as const, alignSelf: "flex-start" as const };
  return <View testID="merchant-catalog-draft-history" style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700" }}>تعديلات المسودة</Text>
    <Text style={{ color: theme.colorSecondary }}>السعر والكمية المسجلان في المسودة لدى DSH. مواعيد التسجيل بتوقيت UTC.</Text>
    {!current ? <ActivityIndicator accessibilityLabel="جارٍ قراءة تعديلات المسودة" /> : null}
    {current?.error ? <>
      <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تعذّر التحقق من تعديلات هذه المسودة.</Text>
      <Pressable accessibilityRole="button" style={actionStyle} onPress={() => setRequest({ ...request })}>
        <Text style={{ color: theme.interactiveText }}>إعادة محاولة قراءة السجل</Text>
      </Pressable>
    </> : null}
    {current?.page?.entries.length === 0 ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
      لا توجد تعديلات مسجلة في هذه الصفحة.
    </Text> : null}
    {current?.page?.entries.map(entry => <View key={entry.version}
      style={{ borderTopWidth: 1, borderColor: theme.borderColor, paddingTop: 8, gap: 4 }}>
      <Text style={{ color: theme.color, fontWeight: "700" }}>الإصدار {entry.version.toLocaleString("ar-YE")}</Text>
      <Text style={{ color: theme.colorSecondary }}>
        السعر من {BigInt(entry.previousPriceYer).toLocaleString("ar-YE")} إلى {BigInt(entry.priceYer).toLocaleString("ar-YE")} ريال يمني
      </Text>
      <Text style={{ color: theme.colorSecondary }}>
        الكمية من {entry.previousStockUnits.toLocaleString("ar-YE")} إلى {entry.stockUnits.toLocaleString("ar-YE")}
      </Text>
      <Text style={{ color: theme.colorSecondary }}>
        {entry.committedAt}
      </Text>
    </View>)}
    {cursor ? <Pressable accessibilityRole="button" style={actionStyle}
      onPress={() => setRequest(previous => previous === request ? { beforeVersion: cursor } : previous)}>
      <Text style={{ color: theme.interactiveText }}>التعديلات الأقدم</Text>
    </Pressable> : null}
    {request.beforeVersion ? <Pressable accessibilityRole="button" style={actionStyle} onPress={() => setRequest({})}>
      <Text style={{ color: theme.interactiveText }}>العودة إلى الأحدث</Text>
    </Pressable> : null}
  </View>;
}
