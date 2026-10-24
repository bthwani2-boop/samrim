import { borders, radius, spacing, toAsciiDigits, type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse, StoreFulfillmentMode, StoreOperationalAvailability, StoreOperationalAvailabilityRequest, StoreScheduleWindow } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { readOwnStoreOperationalAvailability, updateOwnStoreOperationalAvailability } from "./store-readback-client";
import { PartnerWeeklyHoursEditor, type PartnerWorkingWindow } from "./partner-weekly-hours-editor";
import { signalStoreAvailabilityChanged } from "./store-availability-events";

type AvailabilityState = { kind: "loading" } | { kind: "ready"; value: PartnerStoreOperationalAvailabilityResponse } | { kind: "error" };
type WindowDraft = PartnerWorkingWindow;
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
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

function parseYemenDateTimeInput(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(toAsciiDigits(value.trim()));
  if (!match) return null;
  const [day, month, year, hour, minute] = match.slice(1).map(Number);
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
  const [showPreparation, setShowPreparation] = useState(false);
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


  async function save(override?: AvailabilityDraft) {
    if (state.kind !== "ready" || !draft || busy) return;
    const selectedDraft = override ?? draft;
    const attempt = pendingAttempt ?? (() => {
      const input = buildAvailabilityRequest(selectedDraft, state.value.availability, fulfillmentModes);
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
      setNotice("تم تحديث استقبال الطلبات.");
      signalStoreAvailabilityChanged(storeID);
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
        setError("لم يصل تأكيد الحفظ. أعد المحاولة من زر الحفظ للتحقق من النتيجة.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ قراءة إتاحة المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة ساعات العمل وإمكانية استقبال الطلبات…</Text></View>;
  if (state.kind === "error" || !draft) return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذرت قراءة الإتاحة المعتمدة للمتجر.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void load()} variant="secondary" /></View>;

  const confirmedOpen = state.value.orderabilityByMode.some((mode) => mode.state === "OPEN_FOR_ORDERS");
  const dirty = JSON.stringify(availabilityDraft(state.value.availability)) !== JSON.stringify(draft);
  const commit = (next: AvailabilityDraft) => { if (!disabled) void save(next); };
  return <View style={styles.card}>
    <View style={styles.headerLine}>
      <Text style={styles.title}>استقبال الطلبات</Text>
      <View style={[styles.stateTag, { backgroundColor: confirmedOpen ? theme.successSoft : theme.warningSoft }]}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: confirmedOpen ? theme.success : theme.warning }} />
        <Text style={[styles.stateLabel, { color: confirmedOpen ? theme.success : theme.warning }]}>{confirmedOpen ? "مفتوح" : "مغلق"}</Text>
      </View>
    </View>
    <View style={styles.chips}>
      <BthwaniChip disabled={disabled} label="مفتوح دائمًا" selected={draft.scheduleMode === "ALWAYS_OPEN" && !draft.paused && draft.unavailableFulfillmentModes.length === 0}
        onPress={() => commit({ ...draft, scheduleMode: "ALWAYS_OPEN", weeklySchedule: [], paused: false, pauseReason: "", pauseUntil: null, unavailableFulfillmentModes: [] })} />
      <BthwaniChip disabled={disabled} label="ساعات أسبوعية" selected={draft.scheduleMode === "WEEKLY"}
        onPress={() => setDraft((value) => value ? { ...value, scheduleMode: "WEEKLY" } : value)} />
    </View>
    {draft.scheduleMode === "WEEKLY" ? <View style={styles.schedule}><PartnerWeeklyHoursEditor disabled={disabled} windows={draft.weeklySchedule} onChange={(weeklySchedule) => setDraft((current) => current ? { ...current, weeklySchedule } : current)} /></View> : null}
    <View style={styles.settingRow}>
      <Text style={styles.label}>إيقاف مؤقت</Text>
      <Switch accessibilityLabel="إيقاف استقبال الطلبات مؤقتًا" disabled={disabled} value={draft.paused}
        onValueChange={(paused) => commit({ ...draft, paused, pauseReason: paused ? "إيقاف مؤقت من الشريك" : "", pauseUntil: null })} />
    </View>
    <View style={styles.divider} />
    <Text style={styles.label}>طرق الاستلام والتوصيل</Text>
    {fulfillmentModes.map((mode) => {
      const available = !draft.unavailableFulfillmentModes.includes(mode);
      const confirmed = state.value.orderabilityByMode.find((item) => item.fulfillmentMode === mode);
      return <View key={mode} style={styles.settingRow}>
        <View style={styles.modeText}><Text style={styles.label}>{modeLabel(mode)}</Text>
          <Text numberOfLines={1} style={styles.muted}>{confirmed ? orderabilityLabel(confirmed.state) : "قيد التحقق"}</Text>
        </View>
        <Switch accessibilityLabel={"تفعيل " + modeLabel(mode)} disabled={disabled} value={available} onValueChange={(enabled) => commit({
          ...draft, unavailableFulfillmentModes: enabled
            ? draft.unavailableFulfillmentModes.filter((candidate) => candidate !== mode)
            : [...draft.unavailableFulfillmentModes, mode],
        })} />
      </View>;
    })}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPreparation }} onPress={() => setShowPreparation((current) => !current)} style={styles.advancedTrigger}>
      <Text style={styles.advancedLabel}>مدة التجهيز {draft.preparationMinutes ? "· " + draft.preparationMinutes + " دقيقة" : ""}</Text>
      <Text style={styles.muted}>{showPreparation ? "إخفاء" : "تعديل"}</Text>
    </Pressable>
    {showPreparation ? <TextInput accessibilityLabel="مدة التجهيز بالدقائق" editable={!disabled} keyboardType="number-pad"
      onChangeText={(preparationMinutes) => setDraft((value) => value ? { ...value, preparationMinutes: toAsciiDigits(preparationMinutes).replace(/[^0-9]/g, "") } : value)}
      placeholder="دقائق التجهيز" value={draft.preparationMinutes} style={styles.input} /> : null}
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {dirty || pendingAttempt ? <BthwaniButton busy={busy} disabled={busy || (!pendingAttempt && (fulfillmentModes.length === 0 || (draft.scheduleMode === "WEEKLY" && !draft.weeklySchedule.length)))} label={pendingAttempt ? "إعادة المحاولة" : "حفظ التعديلات"} onPress={() => void save()} /> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, padding: 13 },
  headerLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  title: { ...typography.titleSm, color: theme.color, fontWeight: "800" },
  stateTag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 11, flexDirection: "row", gap: 5, alignItems: "center" },
  stateLabel: { ...typography.caption, fontWeight: "700" },
  label: { ...typography.bodyStrong, color: theme.color },
  muted: { ...typography.caption, color: theme.colorMuted },
  error: { ...typography.bodySm, color: theme.danger },
  notice: { ...typography.caption, color: theme.success },
  chips: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  schedule: { backgroundColor: theme.surfaceInset, borderRadius: 12, padding: 8 },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 43, gap: 8 },
  modeText: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: theme.borderColor },
  advancedTrigger: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 40 },
  advancedLabel: { ...typography.bodySm, color: theme.color },
  input: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 9, minHeight: 43, paddingHorizontal: 11, color: theme.color, textAlign: "right" },
}); }
