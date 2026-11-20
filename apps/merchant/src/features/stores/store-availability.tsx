import type { StoreOperationalAvailability, StoreOperationalChange } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { readMerchantAvailability, saveMerchantAvailability } from "../access/admission-transport";

type State = Readonly<{
  storeId: string;
  actorId: string;
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

export default function StoreAvailability({ storeId = "", actorId = "" }: Readonly<{
  storeId?: string;
  actorId?: string;
}> = {}) {
  const { theme } = useMobileAppearance();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ storeId: "", actorId: "", loading: false });
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<StoreOperationalChange | null>(null);
  const [notice, setNotice] = useState("");
  const scope = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!storeId || !actorId) return;
    const controller = new AbortController();
    scope.current = controller;
    inFlight.current = false;
    setMinutes("");
    setReason("");
    setSaving(false);
    setPending(null);
    setNotice("");
    return () => controller.abort();
  }, [storeId, actorId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry reloads the same selected Store from DSH.
  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    setState({ storeId, actorId, loading: true });
    void readMerchantAvailability(storeId, controller.signal, actorId || undefined).then(snapshot => {
      if (!controller.signal.aborted) setState({ storeId, actorId, loading: false, snapshot });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ storeId, actorId, loading: false,
        error: error && typeof error === "object" && "status" in error &&
          (error.status === 401 || error.status === 403) ? "DENIED" : "UNAVAILABLE" });
    });
    return () => controller.abort();
  }, [storeId, actorId, retry]);

  const visible: State = state.storeId === storeId && state.actorId === actorId
    ? state : { storeId, actorId, loading: true };
  const snapshot = visible.snapshot;
  const paused = Boolean(snapshot?.pausedUntil && Date.parse(snapshot.pausedUntil) > Date.now());
  const asciiMinutes = minutes.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
  const duration = Number(asciiMinutes);
  const validDuration = /^\d{1,6}$/.test(asciiMinutes) && duration > 0;
  const canSave = !saving && Boolean(pending || (reason.trim() && (paused || validDuration)));
  const text = { color: theme.color };
  const secondary = { color: theme.colorSecondary };
  const control = { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 };

  async function savePause() {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted || inFlight.current || !canSave || !snapshot?.weekly) return;
    const attempt = pending ?? {
      operationId: randomUUID(),
      expectedVersion: snapshot.version,
      weekly: snapshot.weekly,
      preparationMinutes: snapshot.preparationMinutes,
      pausedUntil: paused ? null : new Date(Date.now() + duration * 60000).toISOString(),
      reason: reason.trim(),
    };
    inFlight.current = true;
    setPending(attempt);
    setSaving(true);
    setNotice("");
    try {
      await saveMerchantAvailability(storeId, actorId, attempt, signal);
      if (signal.aborted) return;
      setPending(null);
      setReason("");
      setMinutes("");
      // A replay may return the historical result. Display the current owner read.
      setState({ storeId, actorId, loading: true });
      setRetry(value => value + 1);
    } catch (error) {
      if (signal.aborted) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 400) {
        setPending(null);
        setNotice("رفض DSH التغيير. راجع المدة والسبب وسياسة المدينة.");
      } else if (status === 401 || status === 403 || status === 404 || status === 409) {
        setPending(null);
        setState({ storeId, actorId, loading: true });
        setNotice(status === 409 ? "تغيّر سجل الإتاحة أو سياسته. تحقّق من بيانات المتجر المُحدّثة قبل الحفظ."
          : "تعذّر حفظ التغيير بصلاحية الحساب الحالية.");
        setRetry(value => value + 1);
      } else {
        setNotice("تعذّر تأكيد نتيجة الحفظ. أعد المحاولة للتحقق من العملية نفسها.");
      }
    } finally {
      if (!signal.aborted) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }

  if (!storeId) return <Text style={secondary}>اختر متجرًا من متاجري لعرض إتاحته التشغيلية.</Text>;
  return (
    <View testID="merchant-store-availability" style={{
      padding: 16, gap: 12, borderRadius: 14, borderWidth: 1,
      borderColor: theme.borderColor, backgroundColor: theme.surface,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Text accessibilityRole="header" style={{ ...text, fontSize: 20, fontWeight: "700" }}>ساعات العمل والإيقاف المؤقت</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="تحديث إتاحة المتجر"
          disabled={visible.loading || saving || pending !== null} onPress={() => setRetry(value => value + 1)}
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
      {notice ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{notice}</Text> : null}
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
        {actorId && snapshot?.weekly !== null ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ ...text, fontWeight: "700" }}>{paused ? "إنهاء الإيقاف المؤقت" : "إيقاف استقبال الطلبات مؤقتًا"}</Text>
            {!paused ? (
              <TextInput value={minutes} onChangeText={setMinutes} editable={!pending}
                accessibilityLabel="مدة الإيقاف بالدقائق" placeholder="مدة الإيقاف بالدقائق"
                keyboardType="number-pad" maxLength={6} placeholderTextColor={theme.colorSecondary} style={{ ...control, ...text }} />
            ) : null}
            <TextInput value={reason} onChangeText={setReason} editable={!pending}
              accessibilityLabel="سبب التغيير" placeholder="سبب التغيير" maxLength={300}
              placeholderTextColor={theme.colorSecondary} style={{ ...control, ...text }} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave, busy: saving }}
              disabled={!canSave} onPress={savePause} style={{ ...control, justifyContent: "center",
                alignSelf: "flex-start", backgroundColor: theme.actionBackground, opacity: canSave ? 1 : 0.6 }}>
              <Text style={{ color: theme.onAction }}>{saving ? "جارٍ التحقق…" : pending ? "إعادة التحقق من الحفظ" : paused ? "إنهاء الإيقاف" : "تأكيد الإيقاف المؤقت"}</Text>
            </Pressable>
          </View>
        ) : null}
      </View> : null}
    </View>
  );
}
