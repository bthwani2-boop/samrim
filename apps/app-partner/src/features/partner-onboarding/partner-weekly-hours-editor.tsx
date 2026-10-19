import { borders, radius, spacing, toAsciiDigits, type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

export type PartnerWorkingWindow = Readonly<{ dayOfWeek: number; opensAt: string; closesAt: string }>;

const DAYS = [
  { number: 0, label: "الأحد" },
  { number: 1, label: "الاثنين" },
  { number: 2, label: "الثلاثاء" },
  { number: 3, label: "الأربعاء" },
  { number: 4, label: "الخميس" },
  { number: 5, label: "الجمعة" },
  { number: 6, label: "السبت" },
] as const;
const DEFAULT_WINDOW: Pick<PartnerWorkingWindow, "opensAt" | "closesAt"> = { opensAt: "09:00", closesAt: "17:00" };

function minuteOfDay(input: string, end = false): number | null {
  const text = toAsciiDigits(input.trim());
  if (end && text === "24:00") return 1440;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function PartnerWeeklyHoursEditor({ windows, disabled, onChange }: Readonly<{
  windows: ReadonlyArray<PartnerWorkingWindow>;
  disabled: boolean;
  onChange: (windows: ReadonlyArray<PartnerWorkingWindow>) => void;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [selectedDays, setSelectedDays] = useState<ReadonlySet<number>>(new Set());
  const [opensAt, setOpensAt] = useState(() => windows[0]?.opensAt ?? DEFAULT_WINDOW.opensAt);
  const [closesAt, setClosesAt] = useState(() => windows[0]?.closesAt ?? DEFAULT_WINDOW.closesAt);
  const [showQuickEditor, setShowQuickEditor] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [quickError, setQuickError] = useState("");

  const activeDays = new Set(windows.map((window) => window.dayOfWeek));
  const changeDay = (number: number) => setSelectedDays((previous) => {
    const next = new Set(previous);
    if (next.has(number)) next.delete(number);
    else next.add(number);
    return next;
  });
  const editWindow = (index: number, patch: Partial<PartnerWorkingWindow>) =>
    onChange(windows.map((window, row) => row === index ? { ...window, ...patch } : window));
  const deleteWindow = (index: number) => onChange(windows.filter((_, row) => row !== index));
  const appendWindow = (dayOfWeek: number) => onChange([...windows, { dayOfWeek, ...DEFAULT_WINDOW }]);

  function applySelectedDays() {
    const start = minuteOfDay(opensAt);
    const end = minuteOfDay(closesAt, true);
    if (start === null || end === null || end <= start) {
      setQuickError("وقت الإغلاق يجب أن يكون بعد الفتح في اليوم نفسه.");
      return;
    }
    if (selectedDays.size === 0) return;
    onChange([
      ...windows.filter((window) => !selectedDays.has(window.dayOfWeek)),
      ...[...selectedDays].sort((a, b) => a - b).map((dayOfWeek) => ({
        dayOfWeek, opensAt: toAsciiDigits(opensAt), closesAt: toAsciiDigits(closesAt),
      })),
    ]);
    setQuickError("");
    setSelectedDays(new Set());
    setShowQuickEditor(false);
  }

  return <View style={styles.section}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.label}>ساعات الأسبوع</Text>
        <Text style={styles.muted}>{activeDays.size} أيام مفتوحة · {windows.length} فترات</Text>
      </View>
      <BthwaniButton disabled={disabled} label={showQuickEditor ? "إخفاء" : "تحديد الساعات"} onPress={() => setShowQuickEditor((previous) => !previous)} variant="secondary" />
    </View>
    {showQuickEditor ? <View style={styles.editor}>
      <Text style={styles.label}>اختر الأيام</Text>
      <View style={styles.chips}>
        {DAYS.map(({ number, label }) => <BthwaniChip key={number} disabled={disabled} label={label} onPress={() => changeDay(number)} selected={selectedDays.has(number)} />)}
        <BthwaniChip disabled={disabled} label={selectedDays.size === 7 ? "إلغاء تحديد الكل" : "كل الأسبوع"} onPress={() => setSelectedDays((current) => current.size === 7 ? new Set() : new Set(DAYS.map(({ number }) => number)))} selected={selectedDays.size === 7} />
      </View>
      <View style={styles.timeRow}>
        <View style={styles.timeField}>
          <Text style={styles.muted}>وقت الفتح</Text>
          <TextInput accessibilityLabel="وقت الفتح للأيام المحددة" editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(text) => { setOpensAt(toAsciiDigits(text)); setQuickError(""); }} value={opensAt} style={styles.input} />
        </View>
        <View style={styles.timeField}>
          <Text style={styles.muted}>وقت الإغلاق</Text>
          <TextInput accessibilityLabel="وقت الإغلاق للأيام المحددة" editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(text) => { setClosesAt(toAsciiDigits(text)); setQuickError(""); }} value={closesAt} style={styles.input} />
        </View>
      </View>
      <Text style={styles.muted}>تُطبَّق فترة واحدة على الأيام المختارة، مع استبدال فتراتها السابقة فقط.</Text>
      {quickError ? <Text accessibilityRole="alert" style={styles.error}>{quickError}</Text> : null}
      <BthwaniButton disabled={disabled || selectedDays.size === 0} label="تطبيق على الأيام المحددة" onPress={applySelectedDays} />
    </View> : null}
    <View style={styles.header}>
      <Text style={styles.label}>ملخص الأسبوع</Text>
      <BthwaniButton disabled={disabled} label={showDetails ? "إخفاء التفاصيل" : "تفاصيل الأيام"} onPress={() => setShowDetails((previous) => !previous)} variant="secondary" />
    </View>
    {showDetails ? <View style={styles.summary}>
      {DAYS.map(({ number, label }) => {
        const dayWindows = windows.map((window, index) => ({ window, index })).filter(({ window }) => window.dayOfWeek === number);
        const editing = editingDay === number;
        return <View key={number} style={styles.day}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.muted}>{dayWindows.length ? dayWindows.map(({ window }) => window.opensAt + " – " + window.closesAt).join(" · ") : "مغلق"}</Text>
            </View>
            <BthwaniChip disabled={disabled} label={editing ? "تم" : dayWindows.length ? "تعديل" : "فتح"} selected={editing} onPress={() => {
              if (!dayWindows.length) { appendWindow(number); setEditingDay(number); }
              else setEditingDay(editing ? null : number);
            }} />
          </View>
          {editing && dayWindows.length ? <View style={styles.editor}>
            {dayWindows.map(({ window, index }, windowNumber) => <View key={index} style={styles.window}>
              <Text style={styles.muted}>الفترة {windowNumber + 1}</Text>
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.muted}>من</Text>
                  <TextInput accessibilityLabel={"بداية فترة " + label + " " + (windowNumber + 1)} editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(text) => editWindow(index, { opensAt: toAsciiDigits(text) })} value={window.opensAt} style={styles.input} />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.muted}>إلى</Text>
                  <TextInput accessibilityLabel={"نهاية فترة " + label + " " + (windowNumber + 1)} editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(text) => editWindow(index, { closesAt: toAsciiDigits(text) })} value={window.closesAt} style={styles.input} />
                </View>
              </View>
              <BthwaniButton disabled={disabled} label="حذف الفترة" onPress={() => deleteWindow(index)} variant="secondary" />
            </View>)}
            <View style={styles.actions}>
              <BthwaniButton disabled={disabled} label="إضافة فترة أخرى" onPress={() => appendWindow(number)} variant="secondary" />
              <BthwaniButton disabled={disabled} label="إغلاق اليوم" onPress={() => { onChange(windows.filter((window) => window.dayOfWeek !== number)); setEditingDay(null); }} variant="secondary" />
            </View>
          </View> : null}
        </View>;
      })}
    </View> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    section: { gap: spacing[3] },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
    headerCopy: { flex: 1, gap: spacing[1] },
    label: { ...typography.label, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.danger },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    editor: { backgroundColor: theme.surfaceInset, borderRadius: radius.md, padding: spacing[3], gap: spacing[3] },
    timeRow: { flexDirection: "row", gap: spacing[2] },
    timeField: { flex: 1, gap: spacing[1], minWidth: 80 },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: 44, paddingHorizontal: spacing[2], textAlign: "center" },
    summary: { gap: spacing[2] },
    day: { borderBottomWidth: borders.hairline, borderColor: theme.borderColor, paddingVertical: spacing[2], gap: spacing[2] },
    window: { gap: spacing[2] },
    actions: { flexDirection: "row", gap: spacing[2], flexWrap: "wrap" },
  });
}
