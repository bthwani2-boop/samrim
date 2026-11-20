import type { StoreOperationalAvailability } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { readMerchantAvailability } from "../access/admission-transport";

type State = Readonly<{
  storeId: string;
  snapshot?: StoreOperationalAvailability;
  loading: boolean;
  error?: string;
}>;
const weekdays = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
function pauseTime(snapshot: StoreOperationalAvailability): string {
  if (!snapshot.pausedUntil) return "لا يوجد إيقاف مؤقت مسجل";
  try {
    return new Intl.DateTimeFormat("ar", { timeZone: snapshot.timezone,
      numberingSystem: "latn", hourCycle: "h23", dateStyle: "medium", timeStyle: "short" })
      .format(new Date(snapshot.pausedUntil));
  } catch { return "تعذّر عرض وقت الإيقاف المسجل"; }
}

/** Read-only DSH projection within the currently verified Merchant workspace. */
export default function StoreAvailability({ storeId = "" }: Readonly<{ storeId?: string }> = {}) {
  const { theme } = useMobileAppearance();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ storeId: "", loading: false });
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry reloads the same selected Store from DSH.
  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    setState({ storeId, loading: true });
    void readMerchantAvailability(storeId, controller.signal).then(snapshot => {
      if (!controller.signal.aborted) setState({ storeId, loading: false, snapshot });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ storeId, loading: false,
        error: error && typeof error === "object" && "status" in error &&
          (error.status === 401 || error.status === 403) ? "DENIED" : "UNAVAILABLE" });
    });
    return () => controller.abort();
  }, [storeId, retry]);

  const visible: State = state.storeId === storeId ? state : { storeId, loading: true };
  const text = { color: theme.color };
  const secondary = { color: theme.colorSecondary };
  if (!storeId) return <Text style={secondary}>اختر متجرًا من متاجري لعرض إتاحته التشغيلية.</Text>;
  return (
    <View testID="merchant-store-availability" style={{
      padding: 16, gap: 12, borderRadius: 14, borderWidth: 1,
      borderColor: theme.borderColor, backgroundColor: theme.surface,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Text accessibilityRole="header" style={{ ...text, fontSize: 20, fontWeight: "700" }}>ساعات العمل والإيقاف المؤقت</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="تحديث إتاحة المتجر"
          disabled={visible.loading} onPress={() => setRetry(value => value + 1)}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12,
            borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
          <Text style={{ color: theme.interactiveText }}>تحديث</Text>
        </Pressable>
      </View>
      {visible.loading ? <ActivityIndicator accessibilityLabel="جارٍ قراءة إتاحة المتجر" color={theme.interactiveText} /> : null}
      {visible.error ? <Text testID="merchant-availability-error" accessibilityRole="alert" style={{ color: theme.dangerText }}>
        {visible.error === "DENIED" ? "لا تتوفر صلاحية قراءة إتاحة هذا المتجر. أعد التحقق من حسابك ومتاجرك."
          : "تعذّر تأكيد إتاحة المتجر. حاول التحديث مجددًا."}
      </Text> : null}
      {visible.snapshot ? <View testID="merchant-availability-snapshot" style={{ gap: 10 }}>
        <Text style={secondary}>الأوقات حسب المنطقة الزمنية للمتجر: {visible.snapshot.timezone}</Text>
        <Text style={text}>مدة التجهيز: {visible.snapshot.weekly === null ? "لم تُحدد بعد" : `${visible.snapshot.preparationMinutes} دقيقة`}</Text>
        <Text style={text}>الإيقاف المؤقت حتى: {pauseTime(visible.snapshot)}</Text>
        {visible.snapshot.weekly === null ? <Text style={secondary}>لم يُحدد جدول أسبوعي.</Text>
          : visible.snapshot.weekly.length === 0 ? <Text style={text}>مغلق طوال الأسبوع حسب الجدول المسجل.</Text>
          : visible.snapshot.weekly.map(period => <View key={`${period.weekday}-${period.opens}-${period.closes}`}
            style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <Text style={text}>{weekdays[period.weekday]}</Text>
            <Text style={text}>{clock(period.opens)} – {clock(period.closes)}{period.closes <= period.opens ? " (اليوم التالي)" : ""}</Text>
          </View>)}
        <Text style={secondary}>إصدار السجل: {visible.snapshot.version}</Text>
        {visible.snapshot.reason ? <Text style={secondary}>سبب آخر تعديل: {visible.snapshot.reason}</Text> : null}
        <Text style={secondary}>هذا جدول التشغيل المسجل؛ قبول الطلبات يعتمد أيضًا على جاهزية المتجر والخدمة لدى DSH.</Text>
      </View> : null}
    </View>
  );
}
