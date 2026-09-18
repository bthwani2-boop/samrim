import { borders, direction, radius, resolveTextAlign, resolveTextInputAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CommerceVertical, JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { correctAndResubmitOwnJoiningCase, listCatalogVerticals } from "./store-readback-client";

export function JoiningCaseCorrection({ value, cities, onUpdated }: { value: JoiningCaseResponse; cities: ReadonlyArray<ServiceCity>; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [businessName, setBusinessName] = useState(current.businessName);
  const [firstStoreName, setFirstStoreName] = useState(current.firstStoreName);
  const [serviceCityId, setServiceCityId] = useState(current.serviceCityId || "");
  const [verticalId, setVerticalId] = useState(current.firstStoreVerticalId || "");
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setBusinessName(current.businessName);
    setFirstStoreName(current.firstStoreName);
    setServiceCityId(current.serviceCityId || "");
    setVerticalId(current.firstStoreVerticalId || "");
  }, [current.businessName, current.firstStoreName, current.serviceCityId, current.firstStoreVerticalId]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError(false);
    try {
      setVerticals(await listCatalogVerticals());
    } catch (cause) {
      console.error("DSH Partner correction options read failed", cause);
      setVerticals([]);
      setOptionsError(true);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current.state === "needs_correction") void loadOptions();
  }, [current.state, loadOptions]);

  if (current.state !== "needs_correction") return null;

  async function correctAndResubmit() {
    const nextBusinessName = businessName.trim();
    const nextStoreName = firstStoreName.trim();
    if (nextBusinessName.length < 2 || nextBusinessName.length > 160 || nextStoreName.length < 2 || nextStoreName.length > 160 || !serviceCityId || !verticalId) {
      setError("أدخل الأسماء واختر مدينة الخدمة والنشاط التجاري.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const resubmitted = await correctAndResubmitOwnJoiningCase(current.id, nextBusinessName, nextStoreName, serviceCityId, verticalId, current.version);
      onUpdated(resubmitted);
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && "status" in nextError && (nextError as { status?: unknown }).status === 409) {
        setError("تغيّرت الحالة أثناء التصحيح. أعد قراءة حالة الانضمام ثم حاول مجددًا.");
      } else {
        setError("تعذر حفظ التصحيح وإعادة الإرسال. تحقق من الاتصال ثم أعد المحاولة.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="تصحيح حالة الانضمام">
      <Text style={styles.title}>التصحيح مطلوب قبل إعادة الإرسال</Text>
      <Text style={styles.reason}>{current.correctionReason || "طلب المشغّل تصحيح البيانات."}</Text>
      <Text style={styles.phone}>رقم الهاتف المعتمد: <Text style={styles.phoneValue}>{current.contactPhoneE164}</Text></Text>
      <TextInput accessibilityLabel="تصحيح اسم النشاط" editable={!busy} onChangeText={setBusinessName} value={businessName} style={styles.input} />
      <TextInput accessibilityLabel="تصحيح اسم المتجر الأول" editable={!busy} onChangeText={setFirstStoreName} value={firstStoreName} style={styles.input} />
      <Text style={styles.label}>مدينة المتجر الأول</Text>
      {cities.length === 0 ? <Text style={styles.muted}>لا توجد مدن خدمة مقروءة حاليًا. أعد قراءة بيانات الشريك.</Text> : null}
      <View style={styles.cityList}>{cities.map((city) => <BthwaniChip key={city.id} disabled={busy} label={city.displayNameAr} onPress={() => setServiceCityId(city.id)} selected={serviceCityId === city.id} />)}</View>
      <Text style={styles.label}>النشاط التجاري</Text>
      {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
      {optionsError ? <View style={styles.optionError}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة الأنشطة التجارية.</Text><BthwaniButton label="إعادة قراءة الأنشطة" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
      <View style={styles.cityList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} disabled={busy} label={vertical.nameAr} onPress={() => setVerticalId(vertical.id)} selected={verticalId === vertical.id} />)}</View>
      <BthwaniButton busy={busy} disabled={optionsLoading} label="حفظ التصحيح وإعادة الإرسال" onPress={() => void correctAndResubmit()} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[3], padding: spacing[3], direction: activeDirection },
    title: { ...typography.bodyStrong, color: theme.warning, textAlign: startTextAlign },
    reason: { ...typography.bodySm, color: theme.color, textAlign: startTextAlign },
    phone: { ...typography.label, color: theme.colorSecondary, textAlign: startTextAlign },
    phoneValue: { writingDirection: "ltr" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[2], textAlign: startInputTextAlign, writingDirection: activeDirection },
    label: { ...typography.label, color: theme.color, textAlign: startTextAlign },
    cityList: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    error: { ...typography.label, color: theme.danger, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    optionError: { gap: spacing[2] },
  });
}
