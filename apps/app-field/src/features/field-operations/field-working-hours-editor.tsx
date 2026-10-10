import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { isValidStoreWorkingHours, normalizeOvernightWorkingHours, type StoreWorkingHoursInterval } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useMemo, useState } from "react";
import { Switch, Text, View } from "react-native";
import { formatClockDisplay } from "./field-circular-clock";
import { FieldCircularTimePicker as TimePickerField } from "./field-circular-time-picker";
import { createFieldOperationStyles } from "./field-operation-styles";

export type EditableWorkingHoursInterval = StoreWorkingHoursInterval & Readonly<{ id: string }>;
export type EditableWorkingHours = Readonly<Record<number, ReadonlyArray<EditableWorkingHoursInterval>>>;

const weekdays = [
  { day: 1, label: "الاثنين" },
  { day: 2, label: "الثلاثاء" },
  { day: 3, label: "الأربعاء" },
  { day: 4, label: "الخميس" },
  { day: 5, label: "الجمعة" },
  { day: 6, label: "السبت" },
  { day: 7, label: "الأحد" },
] as const;

export function toStoreWorkingHoursIntervals(schedule: EditableWorkingHours): ReadonlyArray<StoreWorkingHoursInterval> {
  return weekdays.flatMap(({ day }) => (schedule[day] ?? []).map(({ dayOfWeek: _day, id: _id, ...interval }) => normalizeOvernightWorkingHours({ dayOfWeek: day, ...interval })));
}

function isValidLocalTime(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function intervalLabel(interval: StoreWorkingHoursInterval): string {
  const nextDay = normalizeOvernightWorkingHours(interval).closesNextDay;
  return `${formatClockDisplay(interval.opensAt)} – ${formatClockDisplay(interval.closesAt)}${nextDay ? " · ينتهي غدًا" : ""}`;
}

export function FieldWorkingHoursEditor({ value, disabled, onChange }: Readonly<{
  value: EditableWorkingHours;
  disabled: boolean;
  onChange: (value: EditableWorkingHours) => void;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [selectedDays, setSelectedDays] = useState<ReadonlySet<number>>(new Set());
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [closesNextDay, setClosesNextDay] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [showWeekDetails, setShowWeekDetails] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const intervals = toStoreWorkingHoursIntervals(value);
  const quickPeriodValid = isValidLocalTime(opensAt) && isValidLocalTime(closesAt) && (opensAt !== closesAt || closesNextDay);
  const invalidTime = Object.values(value).some((dayIntervals) => dayIntervals.some((interval) =>
    !isValidLocalTime(interval.opensAt) || !isValidLocalTime(interval.closesAt) ||
    (!interval.closesNextDay && interval.opensAt === interval.closesAt),
  ));
  const invalidSchedule = invalidTime || (intervals.length > 0 && !isValidStoreWorkingHours(intervals));

  function updateDay(day: number, next: ReadonlyArray<EditableWorkingHoursInterval>) {
    onChange({ ...value, [day]: next });
  }

  function toggleSelectedDay(day: number) {
    setSelectedDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function applyQuickPeriod() {
    if (!quickPeriodValid || selectedDays.size === 0) return;
    const next: Record<number, ReadonlyArray<EditableWorkingHoursInterval>> = { ...value };
    for (const day of selectedDays) {
      next[day] = [{ id: Crypto.randomUUID(), dayOfWeek: day, opensAt, closesAt, closesNextDay: closesNextDay || closesAt < opensAt }];
    }
    onChange(next);
    setSelectedDays(new Set());
  }

  return <View style={styles.compactCard}>
    <View style={styles.orderHeader}>
      <Text style={styles.cardTitle}>ساعات العمل</Text>
      <BthwaniButton disabled={disabled} label={showScheduler ? "إخفاء" : intervals.length ? "تعديل" : "تحديد"} onPress={() => setShowScheduler((current) => !current)} variant="secondary" />
    </View>
    {showScheduler ? <>
    <Text style={styles.label}>الأيام</Text>
    <View style={styles.optionList}>
      {weekdays.map(({ day, label }) => <BthwaniChip key={day} disabled={disabled} label={label} onPress={() => toggleSelectedDay(day)} selected={selectedDays.has(day)} />)}
      <BthwaniChip disabled={disabled} label={selectedDays.size === weekdays.length ? "إلغاء تحديد الأيام" : "كل الأسبوع"} onPress={() => setSelectedDays((current) => current.size === weekdays.length ? new Set() : new Set(weekdays.map(({ day }) => day)))} selected={selectedDays.size === weekdays.length} />
    </View>

    <View style={styles.optionList}>
      <TimePickerField label="وقت الفتح" value={opensAt} onChange={(next) => { setOpensAt(next); if (closesAt) setClosesNextDay(closesAt < next || (closesAt === next && closesNextDay)); }} disabled={disabled} />
      <TimePickerField label="وقت الإغلاق" value={closesAt} onChange={(next) => { setClosesAt(next); if (opensAt) setClosesNextDay(next < opensAt || (next === opensAt && closesNextDay)); }} disabled={disabled} />
    </View>
    <View style={styles.orderHeader}>
      <Switch disabled={disabled} value={closesNextDay} onValueChange={setClosesNextDay} />
      <Text style={[styles.muted, { flex: 1 }]}>إغلاق في اليوم التالي (تلقائي إذا أغلق بعد منتصف الليل)</Text>
      <BthwaniButton disabled={disabled || selectedDays.size === 0 || !quickPeriodValid} label="تطبيق على الأيام المحددة" onPress={applyQuickPeriod} variant="secondary" />
    </View>
    {opensAt || closesAt ? <Text style={quickPeriodValid ? styles.muted : styles.error}>{quickPeriodValid ? `ستستبدل الفترة الحالية في ${selectedDays.size.toLocaleString("ar-YE")} أيام محددة.` : "حدّد وقت الفتح والإغلاق من الساعة."}</Text> : null}

    <View style={styles.orderHeader}>
      <Text style={styles.label}>ملخص الأسبوع</Text>
      <BthwaniButton disabled={disabled} label={showWeekDetails ? "إخفاء" : "تفاصيل الأيام"} variant="secondary" onPress={() => setShowWeekDetails((current) => !current)} />
    </View>
    {showWeekDetails ? weekdays.map(({ day, label }) => {
      const dayIntervals = value[day] ?? [];
      const isEditing = editingDay === day;
      return <View key={day} style={{ gap: 8 }}>
        <View style={styles.orderHeader}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.muted}>{dayIntervals.length ? dayIntervals.map(intervalLabel).join(" · ") : "مغلق"}</Text>
          </View>
          <BthwaniChip disabled={disabled} label={isEditing ? "تم" : "تعديل"} onPress={() => setEditingDay(isEditing ? null : day)} selected={isEditing} />
        </View>
        {isEditing ? dayIntervals.length ? <View style={{ gap: 8 }}>
          {dayIntervals.map((interval, index) => <View key={interval.id} style={{ gap: 6 }}>
            <Text style={styles.muted}>الفترة {index + 1}</Text>
            <View style={styles.optionList}>
              <TimePickerField label={`${label} · بداية الفترة ${index + 1}`} disabled={disabled} value={interval.opensAt} onChange={(nextOpensAt) => updateDay(day, dayIntervals.map((item, itemIndex) => itemIndex === index ? { ...item, opensAt: nextOpensAt } : item))} />
              <TimePickerField label={`${label} · نهاية الفترة ${index + 1}`} disabled={disabled} value={interval.closesAt} onChange={(nextClosesAt) => updateDay(day, dayIntervals.map((item, itemIndex) => itemIndex === index ? { ...item, closesAt: nextClosesAt } : item))} />
            </View>
            <View style={styles.optionList}>
              <Switch disabled={disabled} value={interval.closesNextDay} onValueChange={(nextClosesNextDay) => updateDay(day, dayIntervals.map((item, itemIndex) => itemIndex === index ? { ...item, closesNextDay: nextClosesNextDay } : item))} />
              <Text style={styles.muted}>ينتهي في اليوم التالي تلقائيًا عند الإغلاق بعد منتصف الليل</Text>
              {dayIntervals.length > 1 ? <BthwaniButton disabled={disabled} label="حذف الفترة" onPress={() => updateDay(day, dayIntervals.filter((_, itemIndex) => itemIndex !== index))} variant="secondary" /> : null}
            </View>
          </View>)}
          <View style={styles.optionList}>
            <BthwaniButton disabled={disabled || intervals.length >= 28} label="إضافة فترة أخرى" onPress={() => updateDay(day, [...dayIntervals, { id: Crypto.randomUUID(), dayOfWeek: day, opensAt: "", closesAt: "", closesNextDay: false }])} variant="secondary" />
            <BthwaniButton disabled={disabled} label="إغلاق اليوم" onPress={() => updateDay(day, [])} variant="secondary" />
          </View>
        </View> : <Text style={styles.muted}>مغلق. اختر هذا اليوم أعلاه لإضافة فترة مشتركة.</Text> : null}
      </View>;
    }) : null}
    </> : null}

    {invalidSchedule ? <Text accessibilityRole="alert" style={styles.error}>تحقق من صيغة الوقت وترتيب الفترات: لا تتداخل الفترات، ويمكن للفترة أن تنتهي في اليوم التالي أو تستمر 24 ساعة.</Text> : null}
  </View>;
}
