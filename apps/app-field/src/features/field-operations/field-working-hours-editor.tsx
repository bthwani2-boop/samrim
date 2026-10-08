import { isValidStoreWorkingHours, type StoreWorkingHoursInterval } from "@bthwani/dsh";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useMemo, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";

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
  return weekdays.flatMap(({ day }) => (schedule[day] ?? []).map(({ dayOfWeek: _day, id: _id, ...interval }) => ({ dayOfWeek: day, ...interval })));
}

function isValidLocalTime(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

export function FieldWorkingHoursEditor({ value, disabled, onChange }: Readonly<{
  value: EditableWorkingHours;
  disabled: boolean;
  onChange: (value: EditableWorkingHours) => void;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [applyDays, setApplyDays] = useState<ReadonlySet<number>>(new Set());
  const [copySourceDay, setCopySourceDay] = useState<number | null>(null);
  const intervals = toStoreWorkingHoursIntervals(value);
  const invalidTime = Object.values(value).some((dayIntervals) => dayIntervals.some((interval) =>
    !isValidLocalTime(interval.opensAt) || !isValidLocalTime(interval.closesAt) ||
    (!interval.closesNextDay && interval.opensAt === interval.closesAt),
  ));

  function updateDay(day: number, next: ReadonlyArray<EditableWorkingHoursInterval>) {
    if (day === copySourceDay && next.length === 0) {
      setCopySourceDay(null);
      setApplyDays(new Set());
    }
    onChange({ ...value, [day]: next });
  }

  function copyDaySchedule(fromDay: number, targets: ReadonlySet<number>) {
    const source = value[fromDay] ?? [];
    if (!targets.size || source.length === 0) return;
    const next: Record<number, ReadonlyArray<EditableWorkingHoursInterval>> = { ...value };
    for (const day of targets) next[day] = source.map((interval) => ({ ...interval, id: Crypto.randomUUID(), dayOfWeek: day }));
    onChange(next);
  }

  return <View style={styles.card}>
    <Text style={styles.cardTitle}>ساعات العمل</Text>
    <Text style={styles.muted}>أدخل الوقت المحلي للمدينة. اترك اليوم مغلقًا، أو أضف فترات منفصلة ومتداخلة عبر الأيام للتحقق قبل الحفظ.</Text>
    {weekdays.map(({ day, label }) => {
      const dayIntervals = value[day] ?? [];
      return <View key={day} style={{ gap: 8 }}>
        <View style={styles.orderHeader}>
          {dayIntervals.length ? <Text style={styles.label}>{label} · مفتوح ({dayIntervals.length} فترات)</Text> : <BthwaniChip disabled={disabled} label={`${label} · مغلق · فتح اليوم`} onPress={() => updateDay(day, [{ id: Crypto.randomUUID(), dayOfWeek: day, opensAt: "09:00", closesAt: "17:00", closesNextDay: false }])} />}
          {dayIntervals.length > 0 ? <BthwaniButton disabled={disabled} label="إغلاق اليوم" onPress={() => updateDay(day, [])} variant="secondary" /> : null}
        </View>
        {dayIntervals.length > 0 ? dayIntervals.map((interval, index) => <View key={interval.id} style={{ gap: 6 }}>
          <Text style={styles.muted}>الفترة {index + 1}</Text>
          <View style={styles.optionList}>
            <TextInput accessibilityLabel={`${label} بداية الفترة ${index + 1}`} editable={!disabled} keyboardType="numbers-and-punctuation" placeholder="من 09:00" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput, { flex: 1 }]} value={interval.opensAt} onChangeText={(opensAt) => updateDay(day, dayIntervals.map((item, itemIndex) => itemIndex === index ? { ...item, opensAt } : item))} />
            <TextInput accessibilityLabel={`${label} نهاية الفترة ${index + 1}`} editable={!disabled} keyboardType="numbers-and-punctuation" placeholder="إلى 17:00" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput, { flex: 1 }]} value={interval.closesAt} onChangeText={(closesAt) => updateDay(day, dayIntervals.map((item, itemIndex) => itemIndex === index ? { ...item, closesAt } : item))} />
          </View>
          <View style={styles.optionList}>
            <Switch disabled={disabled} value={interval.closesNextDay} onValueChange={(closesNextDay) => updateDay(day, dayIntervals.map((item, itemIndex) => itemIndex === index ? { ...item, closesNextDay } : item))} />
            <Text style={styles.muted}>ينتهي في اليوم التالي (09:00–09:00 تعني 24 ساعة)</Text>
            {dayIntervals.length > 1 ? <BthwaniButton disabled={disabled} label="حذف الفترة" onPress={() => updateDay(day, dayIntervals.filter((_, itemIndex) => itemIndex !== index))} variant="secondary" /> : null}
          </View>
        </View>) : null}
        {dayIntervals.length > 0 ? <View style={styles.optionList}>
          <BthwaniButton disabled={disabled || intervals.length >= 28} label="إضافة فترة" onPress={() => updateDay(day, [...dayIntervals, { id: Crypto.randomUUID(), dayOfWeek: day, opensAt: "13:00", closesAt: "17:00", closesNextDay: false }])} variant="secondary" />
          {dayIntervals.length === 1 && !(dayIntervals[0]?.opensAt === "00:00" && dayIntervals[0]?.closesAt === "00:00" && dayIntervals[0]?.closesNextDay) ? <BthwaniButton disabled={disabled} label="مفتوح طوال اليوم" onPress={() => updateDay(day, [{ ...dayIntervals[0]!, opensAt: "00:00", closesAt: "00:00", closesNextDay: true }])} variant="secondary" /> : null}
          {dayIntervals.length === 1 && dayIntervals[0]?.opensAt === "00:00" && dayIntervals[0]?.closesAt === "00:00" && dayIntervals[0]?.closesNextDay ? <BthwaniButton disabled={disabled} label="تعديل ساعات اليوم" onPress={() => updateDay(day, [{ ...dayIntervals[0]!, opensAt: "09:00", closesAt: "17:00", closesNextDay: false }])} variant="secondary" /> : null}
        </View> : null}
      </View>;
    })}
    <Text style={styles.label}>نسخ جدول يوم إلى أيام أخرى</Text>
    <Text style={styles.muted}>اليوم المصدر</Text>
    <View style={styles.optionList}>{weekdays.filter(({ day }) => (value[day] ?? []).length > 0).map(({ day, label }) => <BthwaniChip key={day} disabled={disabled} label={label} onPress={() => { setCopySourceDay(day); setApplyDays(new Set()); }} selected={copySourceDay === day} />)}</View>
    <Text style={styles.muted}>الأيام التي سيُطبّق عليها الجدول</Text>
    <View style={styles.optionList}>{weekdays.filter(({ day }) => day !== copySourceDay).map(({ day, label }) => <BthwaniChip key={day} disabled={disabled || copySourceDay === null} label={label} onPress={() => setApplyDays((current) => { const next = new Set(current); if (next.has(day)) next.delete(day); else next.add(day); return next; })} selected={applyDays.has(day)} />)}</View>
    <BthwaniButton disabled={disabled || copySourceDay === null || !applyDays.size} label="تطبيق الجدول على الأيام المحددة" onPress={() => { if (copySourceDay !== null) copyDaySchedule(copySourceDay, applyDays); }} variant="secondary" />
    {invalidTime || (intervals.length > 0 && !isValidStoreWorkingHours(intervals)) ? <Text accessibilityRole="alert" style={styles.error}>تحقق من صيغة الوقت وترتيب الفترات: لا تتداخل الفترات، ويمكن للفترة أن تنتهي في اليوم التالي أو تستمر 24 ساعة.</Text> : null}
  </View>;
}
