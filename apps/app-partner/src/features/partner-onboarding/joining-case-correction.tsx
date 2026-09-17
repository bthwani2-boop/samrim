import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";

import { direction, resolveTextAlign, resolveTextInputAlign, resolveTheme } from "@bthwani/design-system";
import type { CommerceVertical, JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import { correctAndResubmitOwnJoiningCase, listCatalogVerticals } from "./store-readback-client";

export function JoiningCaseCorrection({ value, cities, onUpdated }: { value: JoiningCaseResponse; cities: ReadonlyArray<ServiceCity>; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
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
      <View style={styles.cityList}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected: serviceCityId === city.id }} disabled={busy} onPress={() => setServiceCityId(city.id)} style={[styles.cityButton, serviceCityId === city.id && styles.cityButtonSelected]}><Text style={styles.cityText}>{city.displayNameAr}</Text></Pressable>)}</View>
      <Text style={styles.label}>النشاط التجاري</Text>
      {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
      {optionsError ? <View style={styles.optionError}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة الأنشطة التجارية.</Text><Pressable accessibilityRole="button" onPress={() => void loadOptions()} style={styles.retryButton}><Text style={styles.retryText}>إعادة قراءة الأنشطة</Text></Pressable></View> : null}
      <View style={styles.cityList}>{verticals.map((vertical) => <Pressable key={vertical.id} accessibilityRole="button" accessibilityState={{ selected: verticalId === vertical.id }} disabled={busy} onPress={() => setVerticalId(vertical.id)} style={[styles.cityButton, verticalId === vertical.id && styles.cityButtonSelected]}><Text style={styles.cityText}>{vertical.nameAr}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || optionsLoading }} disabled={busy || optionsLoading} onPress={() => void correctAndResubmit()} style={[styles.button, (busy || optionsLoading) && styles.disabledButton]}>
        {busy ? <ActivityIndicator color={theme.disabledText} /> : <Text style={styles.buttonText}>حفظ التصحيح وإعادة الإرسال</Text>}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: 14, borderWidth: 1, gap: 8, marginTop: 12, padding: 12, direction: activeDirection },
    title: { color: theme.warning, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    reason: { color: theme.color, fontSize: 14, lineHeight: 20, textAlign: startTextAlign },
    phone: { color: theme.colorSecondary, fontSize: 13, textAlign: startTextAlign },
    phoneValue: { writingDirection: "ltr" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 10, textAlign: startInputTextAlign, writingDirection: activeDirection },
    label: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    cityList: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    cityButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
    cityButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground },
    cityText: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    optionError: { gap: 6 },
    retryButton: { alignItems: "flex-start", minHeight: 40, justifyContent: "center", paddingHorizontal: 4 },
    retryText: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textDecorationLine: "underline", textAlign: startTextAlign },
  });
}
