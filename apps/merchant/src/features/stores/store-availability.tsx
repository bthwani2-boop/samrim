import type { StoreOperationalAvailability, StoreOperationalChange, StoreWeeklyWindow } from "@bthwani/dsh";
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

const latinDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));

type ScheduleDraft = {
  periods: { id: string; weekday: number; opens: string; closes: string }[];
  preparation: string;
  closedWeek: boolean;
};

function parseClock(value: string, allowsMidnight: boolean): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(latinDigits(value).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0 && allowsMidnight) return 1440;
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function scheduleFields(draft: ScheduleDraft): Pick<StoreOperationalChange, "weekly" | "preparationMinutes"> | null {
  const preparation = latinDigits(draft.preparation).trim();
  if (!/^\d{1,4}$/.test(preparation) || Number(preparation) > 1440) return null;
  if (draft.periods.length === 0 && !draft.closedWeek) return null;
  const weekly: StoreWeeklyWindow[] = [];
  for (const period of draft.periods) {
    const opens = parseClock(period.opens, false);
    const closes = parseClock(period.closes, true);
    if (opens === null || closes === null || opens === closes) return null;
    weekly.push({ weekday: period.weekday, opens, closes });
  }
  return { preparationMinutes: Number(preparation), weekly };
}

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
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);
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
    setSchedule(null);
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
  const asciiMinutes = latinDigits(minutes);
  const duration = Number(asciiMinutes);
  const validDuration = /^\d{1,6}$/.test(asciiMinutes) && duration > 0;
  const newSchedule = schedule ? scheduleFields(schedule) : null;
  const canSave = !saving && Boolean(pending || (reason.trim() && (schedule ? newSchedule : paused || validDuration)));
  const text = { color: theme.color };
  const secondary = { color: theme.colorSecondary };
  const control = { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 };

  function editSchedule(current: StoreOperationalAvailability) {
    setSchedule({
      periods: (current.weekly ?? []).map(period => ({
        id: randomUUID(), weekday: period.weekday, opens: clock(period.opens), closes: clock(period.closes),
      })),
      preparation: current.weekly === null ? "" : String(current.preparationMinutes),
      closedWeek: current.weekly?.length === 0,
    });
    setReason("");
    setNotice("");
  }

  async function saveAvailability() {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted || inFlight.current || !canSave || !snapshot) return;
    const fields = schedule ? newSchedule : snapshot.weekly === null ? null : {
      weekly: snapshot.weekly,
      preparationMinutes: snapshot.preparationMinutes,
    };
    if (!fields) return;
    const attempt = pending ?? {
      operationId: randomUUID(),
      expectedVersion: snapshot.version,
      ...fields,
      pausedUntil: schedule ? (paused ? snapshot.pausedUntil ?? null : null)
        : paused ? null : new Date(Date.now() + duration * 60000).toISOString(),
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
      setSchedule(null);
      // A replay may return the historical result. Display the current owner read.
      setState({ storeId, actorId, loading: true });
      setRetry(value => value + 1);
    } catch (error) {
      if (signal.aborted) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 400) {
        setPending(null);
        setNotice(schedule ? "رفض DSH التغيير. راجع تداخل الفترات ومدة التجهيز وسياسة المدينة."
          : "رفض DSH التغيير. راجع المدة والسبب وسياسة المدينة.");
      } else if (status === 401 || status === 403 || status === 404 || status === 409) {
        setPending(null);
        setSchedule(null);
        setReason("");
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
          disabled={visible.loading || saving || pending !== null || schedule !== null} onPress={() => setRetry(value => value + 1)}
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
        {actorId && snapshot && !schedule ? (
          <Pressable accessibilityRole="button" disabled={saving || pending !== null}
            onPress={() => editSchedule(snapshot)} style={{ ...control, alignSelf: "flex-start", justifyContent: "center" }}>
            <Text style={{ color: theme.interactiveText }}>{snapshot.weekly === null ? "إعداد الدوام" : "تعديل الدوام والتجهيز"}</Text>
          </Pressable>
        ) : null}
        {actorId && schedule ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ ...text, fontWeight: "700" }}>الدوام الأسبوعي</Text>
            <Text style={secondary}>أدخل الأوقات بصيغة ٢٤ ساعة. حدّد الإغلاق إذا لم تكن هناك أي فترات عمل.</Text>
            {weekdays.map((day, weekday) => (
              <View key={day} style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderColor: theme.borderColor }}>
                <Text style={{ ...text, fontWeight: "600" }}>{day}</Text>
                {schedule.periods.filter(period => period.weekday === weekday).map((period, index) => (
                  <View key={period.id} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {(["opens", "closes"] as const).map(field => {
                      const label = field === "opens" ? "الفتح" : "الإغلاق";
                      return <TextInput key={field} editable={!pending} value={period[field]}
                        accessibilityLabel={`وقت ${label} يوم ${day} للفترة ${index + 1}`}
                        placeholder={label + " ٠٠:٠٠"} placeholderTextColor={theme.colorSecondary}
                        maxLength={5} onChangeText={value => setSchedule(current => current && ({
                          ...current, periods: current.periods.map(item => item.id === period.id
                            ? { ...item, [field]: value } : item),
                        }))} style={{ ...control, ...text, minWidth: 115 }} />;
                    })}
                    <Pressable accessibilityRole="button" accessibilityLabel={`حذف الفترة ${index + 1} يوم ${day}`}
                      disabled={pending !== null} onPress={() => setSchedule(current => current && ({
                        ...current, periods: current.periods.filter(item => item.id !== period.id),
                      }))} style={{ ...control, justifyContent: "center" }}>
                      <Text style={{ color: theme.dangerText }}>حذف</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable accessibilityRole="button" accessibilityLabel={`إضافة فترة يوم ${day}`}
                  disabled={pending !== null} onPress={() => {
                    const period = { id: randomUUID(), weekday, opens: "", closes: "" };
                    setSchedule(current => current && ({
                      ...current, periods: [...current.periods, period], closedWeek: false,
                    }));
                  }} style={{ ...control, alignSelf: "flex-start", justifyContent: "center" }}>
                  <Text style={{ color: theme.interactiveText }}>إضافة فترة</Text>
                </Pressable>
              </View>
            ))}
            {schedule.periods.length === 0 ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: schedule.closedWeek }}
                disabled={pending !== null} onPress={() => setSchedule(current => current && ({
                  ...current, closedWeek: !current.closedWeek,
                }))} style={{ ...control, alignSelf: "flex-start", justifyContent: "center" }}>
                <Text style={text}>{schedule.closedWeek ? "✓ " : ""}إغلاق طوال الأسبوع</Text>
              </Pressable>
            ) : null}
            <TextInput editable={!pending} value={schedule.preparation} keyboardType="number-pad" maxLength={4}
              accessibilityLabel="مدة التجهيز بالدقائق" placeholder="مدة التجهيز بالدقائق"
              placeholderTextColor={theme.colorSecondary}
              onChangeText={value => setSchedule(current => current && ({ ...current, preparation: value }))}
              style={{ ...control, ...text }} />
          </View>
        ) : null}
        {actorId && snapshot && (schedule || snapshot.weekly !== null) ? (
          <View style={{ gap: 8 }}>
            {!schedule ? <Text accessibilityRole="header" style={{ ...text, fontWeight: "700" }}>
              {paused ? "إنهاء الإيقاف المؤقت" : "إيقاف استقبال الطلبات مؤقتًا"}
            </Text> : null}
            {!schedule && !paused ? (
              <TextInput value={minutes} onChangeText={setMinutes} editable={!pending}
                accessibilityLabel="مدة الإيقاف بالدقائق" placeholder="مدة الإيقاف بالدقائق"
                keyboardType="number-pad" maxLength={6} placeholderTextColor={theme.colorSecondary} style={{ ...control, ...text }} />
            ) : null}
            <TextInput value={reason} onChangeText={setReason} editable={!pending}
              accessibilityLabel="سبب التغيير" placeholder="سبب التغيير" maxLength={300}
              placeholderTextColor={theme.colorSecondary} style={{ ...control, ...text }} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave, busy: saving }}
              disabled={!canSave} onPress={saveAvailability} style={{ ...control, justifyContent: "center",
                alignSelf: "flex-start", backgroundColor: theme.actionBackground, opacity: canSave ? 1 : 0.6 }}>
              <Text style={{ color: theme.onAction }}>{saving ? "جارٍ التحقق…" : pending ? "إعادة التحقق من الحفظ"
                : schedule ? "حفظ الدوام والتجهيز" : paused ? "إنهاء الإيقاف" : "تأكيد الإيقاف المؤقت"}</Text>
            </Pressable>
            {schedule && !pending ? <Pressable accessibilityRole="button" onPress={() => {
              setSchedule(null);
              setReason("");
              setNotice("");
            }} style={{ ...control, alignSelf: "flex-start", justifyContent: "center" }}>
              <Text style={{ color: theme.interactiveText }}>إلغاء تعديل الدوام</Text>
            </Pressable> : null}
          </View>
        ) : null}
      </View> : null}
    </View>
  );
}
