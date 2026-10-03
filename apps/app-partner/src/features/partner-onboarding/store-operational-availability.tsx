import { borders, radius, spacing, toAsciiDigits, type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse, StoreFulfillmentMode, StoreOperationalAvailability, StoreOperationalAvailabilityRequest, StoreScheduleWindow } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { readOwnStoreOperationalAvailability, updateOwnStoreOperationalAvailability } from "./store-readback-client";

type AvailabilityState = { kind: "loading" } | { kind: "ready"; value: PartnerStoreOperationalAvailabilityResponse } | { kind: "error" };
type WindowDraft = Readonly<{ dayOfWeek: number; opensAt: string; closesAt: string }>;
type AvailabilityDraft = Readonly<{
  scheduleMode: "ALWAYS_OPEN" | "WEEKLY";
  weeklySchedule: ReadonlyArray<WindowDraft>;
  paused: boolean;
  pauseReason: string;
  pauseUntil: string | null;
  preparationMinutes: string;
  unavailableFulfillmentModes: ReadonlyArray<StoreFulfillmentMode>;
}>;
type PendingAttempt = Readonly<{
  input: StoreOperationalAvailabilityRequest;
  idempotencyKey: string;
  correlationID: string;
}>;

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "17:00";

function minuteLabel(value: number): string {
  const hour = Math.floor(value / 60).toString().padStart(2, "0");
  const minute = (value % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function availabilityDraft(value: StoreOperationalAvailability): AvailabilityDraft {
  const pauseStillActive = value.paused && (!value.pauseUntil || Date.parse(value.pauseUntil) > Date.now());
  return {
    scheduleMode: value.scheduleMode,
    weeklySchedule: value.weeklySchedule.map((window) => ({ dayOfWeek: window.dayOfWeek, opensAt: minuteLabel(window.opensAtMinute), closesAt: minuteLabel(window.closesAtMinute) })),
    paused: pauseStillActive,
    pauseReason: pauseStillActive ? value.pauseReason ?? "" : "",
    pauseUntil: pauseStillActive && value.pauseUntil ? formatYemenDateTimeInput(value.pauseUntil) : null,
    preparationMinutes: value.preparationMinutes == null ? "" : String(value.preparationMinutes),
    unavailableFulfillmentModes: [...value.unavailableFulfillmentModes],
  };
}

function formatYemenDateTimeInput(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aden",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function parseYemenDateTimeInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(toAsciiDigits(value.trim()));
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const yemenLocalAsUTC = Date.UTC(year, month - 1, day, hour, minute);
  const instant = new Date(yemenLocalAsUTC - 3 * 60 * 60 * 1000);
  const normalizedLocal = new Date(instant.getTime() + 3 * 60 * 60 * 1000);
  if (normalizedLocal.getUTCFullYear() !== year || normalizedLocal.getUTCMonth() + 1 !== month || normalizedLocal.getUTCDate() !== day || normalizedLocal.getUTCHours() !== hour || normalizedLocal.getUTCMinutes() !== minute || instant.getTime() <= Date.now()) return null;
  return instant.toISOString();
}

function parseClock(value: string, allowEndOfDay = false): number | null {
  const normalized = toAsciiDigits(value.trim());
  if (allowEndOfDay && normalized === "24:00") return 1440;
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function buildAvailabilityRequest(draft: AvailabilityDraft, current: StoreOperationalAvailability, admittedModes: ReadonlyArray<StoreFulfillmentMode>): StoreOperationalAvailabilityRequest | null {
  const weeklySchedule: StoreScheduleWindow[] = [];
  if (draft.scheduleMode === "WEEKLY") {
    if (draft.weeklySchedule.length === 0) return null;
    for (const window of draft.weeklySchedule) {
      const opensAtMinute = parseClock(window.opensAt);
      const closesAtMinute = parseClock(window.closesAt, true);
      if (opensAtMinute === null || closesAtMinute === null || closesAtMinute <= opensAtMinute) return null;
      weeklySchedule.push({ dayOfWeek: window.dayOfWeek, opensAtMinute, closesAtMinute });
    }
    for (let day = 0; day < 7; day += 1) {
      const ranges = weeklySchedule.filter((window) => window.dayOfWeek === day).sort((left, right) => left.opensAtMinute - right.opensAtMinute);
      for (let index = 1; index < ranges.length; index += 1) {
        const previous = ranges[index - 1];
        const current = ranges[index];
        if (previous && current && current.opensAtMinute < previous.closesAtMinute) return null;
      }
    }
  }
  const preparationValue = draft.preparationMinutes.trim() ? Number(toAsciiDigits(draft.preparationMinutes.trim())) : null;
  if (preparationValue !== null && (!Number.isSafeInteger(preparationValue) || preparationValue < 1 || preparationValue > 1440)) return null;
  const pauseReason = draft.pauseReason.trim();
  if (draft.paused && (pauseReason.length < 2 || pauseReason.length > 500)) return null;
  const pauseUntilInput = draft.pauseUntil?.trim() ?? "";
  const pauseUntil = draft.paused && pauseUntilInput ? parseYemenDateTimeInput(pauseUntilInput) : null;
  if (draft.paused && pauseUntilInput && !pauseUntil) return null;
  const unavailableFulfillmentModes = [...new Set(draft.unavailableFulfillmentModes)].filter((mode) => admittedModes.includes(mode));
  return {
    scheduleMode: draft.scheduleMode,
    weeklySchedule,
    paused: draft.paused,
    pauseReason: draft.paused ? pauseReason : null,
    pauseUntil,
    preparationMinutes: preparationValue,
    unavailableFulfillmentModes,
    expectedVersion: current.version,
  };
}

function orderabilityLabel(state: PartnerStoreOperationalAvailabilityResponse["orderabilityByMode"][number]["state"]): string {
  switch (state) {
    case "OPEN_FOR_ORDERS": return "يستقبل الطلبات";
    case "CLOSED_BY_SCHEDULE": return "مغلق خارج ساعات العمل";
    case "PAUSED": return "متوقف مؤقتًا";
    case "OPERATIONALLY_UNAVAILABLE": return "وضع الطلب غير متاح مؤقتًا";
  }
}

function modeLabel(mode: StoreFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "توصيل بثواني";
  if (mode === "PARTNER_CAPTAIN") return "توصيل المتجر";
  return "الاستلام من المتجر";
}

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" ? value.status : null;
}

export function StoreOperationalAvailabilityManagement({ storeID, fulfillmentModes }: { storeID: string; fulfillmentModes: ReadonlyArray<StoreFulfillmentMode> }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<AvailabilityState>({ kind: "loading" });
  const [draft, setDraft] = useState<AvailabilityDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PendingAttempt | null>(null);
  const requestSequence = useRef(0);
  const disabled = busy || pendingAttempt !== null;

  const load = useCallback(async (showLoading = true) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (showLoading) setState({ kind: "loading" });
    setError("");
    try {
      const value = await readOwnStoreOperationalAvailability(storeID);
      if (sequence !== requestSequence.current) return value;
      setState({ kind: "ready", value });
      setDraft(availabilityDraft(value.availability));
      return value;
    } catch {
      if (sequence === requestSequence.current) setState({ kind: "error" });
      return null;
    }
  }, [storeID]);

  useEffect(() => {
    setPendingAttempt(null);
    setNotice("");
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  function addWindow(dayOfWeek: number) {
    setDraft((current) => current ? { ...current, weeklySchedule: [...current.weeklySchedule, { dayOfWeek, opensAt: DEFAULT_OPEN, closesAt: DEFAULT_CLOSE }] } : current);
  }

  function updateWindow(index: number, patch: Partial<WindowDraft>) {
    setDraft((current) => current ? { ...current, weeklySchedule: current.weeklySchedule.map((window, row) => row === index ? { ...window, ...patch } : window) } : current);
  }

  function removeWindow(index: number) {
    setDraft((current) => current ? { ...current, weeklySchedule: current.weeklySchedule.filter((_, row) => row !== index) } : current);
  }

  async function save() {
    if (state.kind !== "ready" || !draft || busy) return;
    const attempt = pendingAttempt ?? (() => {
      const input = buildAvailabilityRequest(draft, state.value.availability, fulfillmentModes);
      if (!input) return null;
      return { input, idempotencyKey: `store_availability_${Crypto.randomUUID()}`, correlationID: `store_availability_corr_${Crypto.randomUUID()}` };
    })();
    if (!attempt) {
      setError("راجع ساعات الأيام والفترات، وسبب الإيقاف، ومدة التجهيز؛ توجد قيمة غير صالحة أو فترة متداخلة.");
      return;
    }
    setPendingAttempt(attempt);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateOwnStoreOperationalAvailability(storeID, attempt.input, attempt.idempotencyKey, attempt.correlationID);
      setPendingAttempt(null);
      setState({ kind: "ready", value: updated });
      setDraft(availabilityDraft(updated.availability));
      setNotice("حُفظت الإتاحة وأُعيدت قراءة حالتها المعتمدة.");
    } catch (cause) {
      const status = httpStatus(cause);
      if (status === 409) {
        setPendingAttempt(null);
        await load(false);
        setError("تغيّرت الإتاحة في جلسة أخرى. أُعيدت قراءة الحالة المعتمدة؛ راجعها ثم احفظ من جديد.");
      } else if (status !== null && status < 500) {
        setPendingAttempt(null);
        setError(status === 401 ? "انتهت جلسة الشريك. سجّل الدخول مجددًا." : status === 403 ? "لا تملك صلاحية إدارة إتاحة هذا المتجر." : "رفضت المنصة التحديث؛ راجع المدخلات ثم أعد المحاولة.");
      } else {
        setError("لم يصل تأكيد الحفظ. أعد إرسال التحديث المحفوظ بالمفتاح نفسه للتحقق من النتيجة.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ قراءة إتاحة المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة ساعات العمل وإمكانية استقبال الطلبات…</Text></View>;
  if (state.kind === "error" || !draft) return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذرت قراءة الإتاحة المعتمدة للمتجر.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void load()} variant="secondary" /></View>;

  const current = state.value.availability;
  return <View style={styles.card}>
    <View style={styles.heading}><Text style={styles.title}>ساعات العمل وإتاحة الطلب</Text><Text style={styles.muted}>المنطقة الزمنية: اليمن (Asia/Aden). هذا الإعداد لا يغيّر نشر المتجر أو أوضاعه الدائمة.</Text></View>
    <View style={styles.block}>
      <Text style={styles.label}>ساعات استقبال الطلبات</Text>
      <View style={styles.chips}>
        <BthwaniChip accessibilityLabel="المتجر مفتوح دائمًا" disabled={disabled} label="مفتوح دائمًا" onPress={() => setDraft((value) => value ? { ...value, scheduleMode: "ALWAYS_OPEN" } : value)} selected={draft.scheduleMode === "ALWAYS_OPEN"} />
        <BthwaniChip accessibilityLabel="تحديد ساعات أسبوعية" disabled={disabled} label="ساعات أسبوعية" onPress={() => setDraft((value) => value ? { ...value, scheduleMode: "WEEKLY" } : value)} selected={draft.scheduleMode === "WEEKLY"} />
      </View>
      {draft.scheduleMode === "WEEKLY" ? <><Text style={styles.muted}>اختر أيام العمل وأدخل فترة واحدة أو أكثر لكل يوم. لا تُحفظ ساعات افتراضية من دون اختيارك.</Text><View style={styles.days}>{WEEKDAYS.map((day, dayOfWeek) => {
        const windows = draft.weeklySchedule.map((window, index) => ({ window, index })).filter(({ window }) => window.dayOfWeek === dayOfWeek);
        return <View key={day} style={styles.dayCard}>
          <View style={styles.dayHeader}><Text style={styles.label}>{day}</Text><Switch accessibilityLabel={`ساعات عمل يوم ${day}`} disabled={disabled} onValueChange={(enabled) => enabled ? addWindow(dayOfWeek) : setDraft((value) => value ? { ...value, weeklySchedule: value.weeklySchedule.filter((window) => window.dayOfWeek !== dayOfWeek) } : value)} value={windows.length > 0} /></View>
          {windows.map(({ window, index }) => <View key={`${day}-${index}`} style={styles.windowRow}>
            <View style={styles.timeField}><Text style={styles.muted}>من</Text><TextInput accessibilityLabel={`بداية فترة ${day}`} editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(opensAt) => updateWindow(index, { opensAt: toAsciiDigits(opensAt) })} placeholder="09:00" value={window.opensAt} style={styles.input} /></View>
            <View style={styles.timeField}><Text style={styles.muted}>إلى</Text><TextInput accessibilityLabel={`نهاية فترة ${day}`} editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(closesAt) => updateWindow(index, { closesAt: toAsciiDigits(closesAt) })} placeholder="17:00" value={window.closesAt} style={styles.input} /></View>
            <BthwaniButton disabled={disabled} label="حذف الفترة" onPress={() => removeWindow(index)} variant="secondary" />
          </View>)}
          {windows.length > 0 ? <BthwaniButton disabled={disabled} label="إضافة فترة أخرى" onPress={() => addWindow(dayOfWeek)} variant="secondary" /> : null}
        </View>;
      })}</View></> : null}
    </View>
    <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.label}>إيقاف استقبال الطلبات مؤقتًا</Text><Text style={styles.muted}>{draft.paused ? "يبقى الإيقاف حتى تلغيه يدويًا." : "يمكن إيقاف الطلبات دون إلغاء نشر المتجر."}</Text></View><Switch accessibilityLabel="إيقاف استقبال الطلبات مؤقتًا" disabled={disabled} onValueChange={(paused) => setDraft((value) => value ? { ...value, paused, pauseReason: paused ? value.pauseReason : "", pauseUntil: paused ? value.pauseUntil : null } : value)} value={draft.paused} /></View>
    {draft.paused ? <>
      <TextInput accessibilityLabel="سبب إيقاف استقبال الطلبات" editable={!disabled} maxLength={500} onChangeText={(pauseReason) => setDraft((value) => value ? { ...value, pauseReason } : value)} placeholder="سبب الإيقاف" value={draft.pauseReason} style={styles.input} />
      <TextInput accessibilityLabel="موعد انتهاء الإيقاف بتوقيت اليمن" editable={!disabled} maxLength={16} onChangeText={(pauseUntil) => setDraft((value) => value ? { ...value, pauseUntil: toAsciiDigits(pauseUntil) || null } : value)} placeholder="YYYY-MM-DD HH:mm" value={draft.pauseUntil ?? ""} style={styles.input} />
      <Text style={styles.muted}>أدخل موعدًا مستقبليًا بتوقيت اليمن، مثل 2026-10-03 18:30. اتركه فارغًا إذا كان الإيقاف حتى الاستئناف اليدوي.</Text>
    </> : null}
    <View style={styles.block}>
      <Text style={styles.label}>مدة التجهيز</Text>
      <TextInput accessibilityLabel="مدة التجهيز بالدقائق" editable={!disabled} keyboardType="number-pad" onChangeText={(preparationMinutes) => setDraft((value) => value ? { ...value, preparationMinutes: toAsciiDigits(preparationMinutes).replace(/[^0-9]/g, "") } : value)} placeholder="بالدقائق، اختياري" value={draft.preparationMinutes} style={styles.input} />
      <Text style={styles.muted}>من دقيقة واحدة إلى 24 ساعة.</Text>
    </View>
    {fulfillmentModes.length ? <View style={styles.block}>
      <Text style={styles.label}>إيقاف وضع طلب مؤقتًا</Text>
      <Text style={styles.muted}>الأوضاع المعروضة هنا هي أوضاع هذا المتجر المعتمدة. التغيير مؤقت ولا يحذف الوضع من إعدادات المتجر.</Text>
      {fulfillmentModes.map((mode) => {
        const unavailable = draft.unavailableFulfillmentModes.includes(mode);
        const status = state.value.orderabilityByMode.find((item) => item.fulfillmentMode === mode);
        return <View key={mode} style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.label}>{modeLabel(mode)}</Text><Text style={styles.muted}>{status ? orderabilityLabel(status.state) : "الحالة الحالية غير متاحة"}</Text></View><Switch accessibilityLabel={`إيقاف ${modeLabel(mode)} مؤقتًا`} disabled={disabled} onValueChange={(value) => setDraft((currentDraft) => currentDraft ? { ...currentDraft, unavailableFulfillmentModes: value ? [...currentDraft.unavailableFulfillmentModes, mode] : currentDraft.unavailableFulfillmentModes.filter((candidate) => candidate !== mode) } : currentDraft)} value={unavailable} /></View>;
      })}
    </View> : null}
    <View style={styles.currentState}>
      <Text style={styles.label}>الحالة المعتمدة الآن · الإصدار {current.version}</Text>
      {state.value.orderabilityByMode.length ? state.value.orderabilityByMode.map((item) => <Text key={item.fulfillmentMode} style={styles.muted}>{modeLabel(item.fulfillmentMode)}: {orderabilityLabel(item.state)}{item.preparationMinutes ? ` · تجهيز ${item.preparationMinutes} دقيقة` : ""}</Text>) : <Text style={styles.muted}>لا يوجد وضع طلب دائم معتمد لهذا المتجر بعد.</Text>}
    </View>
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <BthwaniButton busy={busy} disabled={busy || (pendingAttempt === null && (fulfillmentModes.length === 0 || (draft.scheduleMode === "WEEKLY" && draft.weeklySchedule.length === 0) || (draft.paused && draft.pauseReason.trim().length < 2)))} label={pendingAttempt ? "إعادة إرسال التحديث المحفوظ" : "حفظ إتاحة المتجر"} onPress={() => void save()} />
    <BthwaniButton disabled={busy || pendingAttempt !== null} label="إعادة قراءة الحالة المعتمدة" onPress={() => void load()} variant="secondary" />
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    heading: { gap: spacing[1] },
    title: { ...typography.titleMd, color: theme.color },
    label: { ...typography.label, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.label, color: theme.danger },
    notice: { ...typography.label, color: theme.actionBackground },
    block: { gap: spacing[2] },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    days: { gap: spacing[2] },
    dayCard: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    dayHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    windowRow: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    timeField: { flex: 1, gap: spacing[1], minWidth: 90 },
    input: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: 44, paddingHorizontal: spacing[2], textAlign: "right" },
    settingRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    settingCopy: { flex: 1, gap: spacing[1] },
    currentState: { backgroundColor: theme.surfaceInset, borderRadius: radius.md, gap: spacing[1], padding: spacing[3] },
  });
}
