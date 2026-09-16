import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTextInputAlign, resolveTheme } from "@bthwani/design-system";
import type { JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import { correctAndResubmitOwnJoiningCase, listActiveServiceCities } from "./store-readback-client";

export function JoiningCaseCorrection({ value, onUpdated }: { value: JoiningCaseResponse; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [businessName, setBusinessName] = useState(current.businessName);
  const [firstStoreName, setFirstStoreName] = useState(current.firstStoreName);
  const [serviceCityId, setServiceCityId] = useState(current.serviceCityId || "");
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setBusinessName(current.businessName);
    setFirstStoreName(current.firstStoreName);
    setServiceCityId(current.serviceCityId || "");
  }, [current.businessName, current.firstStoreName, current.serviceCityId]);

  useEffect(() => {
    if (current.state === "needs_correction") void listActiveServiceCities().then(setCities, () => setCities([]));
  }, [current.state]);

  if (current.state !== "needs_correction") return null;

  async function correctAndResubmit() {
    const nextBusinessName = businessName.trim();
    const nextStoreName = firstStoreName.trim();
    if (nextBusinessName.length < 2 || nextBusinessName.length > 160 || nextStoreName.length < 2 || nextStoreName.length > 160 || !serviceCityId) {
      setError("أدخل اسم النشاط واسم المتجر بين حرفين و160 حرفًا.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const resubmitted = await correctAndResubmitOwnJoiningCase(current.id, nextBusinessName, nextStoreName, serviceCityId, current.firstStoreVerticalId || "", current.version);
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
      <View style={styles.cityList}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected: serviceCityId === city.id }} disabled={busy} onPress={() => setServiceCityId(city.id)} style={[styles.cityButton, serviceCityId === city.id && styles.cityButtonSelected]}><Text style={styles.cityText}>{city.displayNameAr}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void correctAndResubmit()} style={[styles.button, busy && styles.disabledButton]}>
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
  const rowDirection = resolveRowDirection(activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: 14, borderWidth: 1, gap: 8, marginTop: 12, padding: 12, direction: activeDirection },
    title: { color: theme.warning, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    reason: { color: theme.color, fontSize: 14, lineHeight: 20, textAlign: startTextAlign },
    phone: { color: theme.colorSecondary, fontSize: 13, textAlign: startTextAlign },
    phoneValue: { writingDirection: "ltr" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 10, textAlign: startInputTextAlign, writingDirection: activeDirection },
    label: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    cityList: { flexDirection: rowDirection, flexWrap: "wrap", gap: 8 },
    cityButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
    cityButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground },
    cityText: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
