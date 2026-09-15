import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { JoiningCaseResponse, ServiceCity } from "@bthwani/dsh";
import { correctAndResubmitOwnJoiningCase, listActiveServiceCities } from "./store-readback-client";

export function JoiningCaseCorrection({ value, onUpdated }: { value: JoiningCaseResponse; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
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
      const resubmitted = await correctAndResubmitOwnJoiningCase(current.id, nextBusinessName, nextStoreName, serviceCityId, current.version);
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
      <Text style={styles.phone}>رقم الهاتف المعتمد: {current.contactPhoneE164}</Text>
      <TextInput accessibilityLabel="تصحيح اسم النشاط" editable={!busy} onChangeText={setBusinessName} value={businessName} style={styles.input} />
      <TextInput accessibilityLabel="تصحيح اسم المتجر الأول" editable={!busy} onChangeText={setFirstStoreName} value={firstStoreName} style={styles.input} />
      <Text style={styles.label}>مدينة المتجر الأول</Text>
      <View style={styles.cityList}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected: serviceCityId === city.id }} disabled={busy} onPress={() => setServiceCityId(city.id)} style={[styles.cityButton, serviceCityId === city.id && styles.cityButtonSelected]}><Text style={styles.cityText}>{city.displayNameAr}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void correctAndResubmit()} style={styles.button}>
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>حفظ التصحيح وإعادة الإرسال</Text>}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderColor: "#d97706", borderRadius: 8, borderWidth: 1, gap: 8, marginTop: 12, padding: 12 },
  title: { color: "#92400e", fontSize: 15, fontWeight: "800" },
  reason: { color: "#451a03", fontSize: 14 },
  phone: { color: "#475569", fontSize: 13 },
  input: { borderColor: "#cbd5e1", borderRadius: 8, borderWidth: 1, color: "#0f172a", minHeight: 44, paddingHorizontal: 10 },
  label: { color: "#451a03", fontSize: 13, fontWeight: "700" },
  cityList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cityButton: { borderColor: "#cbd5e1", borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  cityButtonSelected: { backgroundColor: "#ccfbf1", borderColor: "#0f766e" },
  cityText: { color: "#0f172a", fontSize: 13, fontWeight: "700" },
  button: { alignItems: "center", backgroundColor: "#0f766e", borderRadius: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  buttonText: { color: "#ffffff", fontWeight: "800" },
  error: { color: "#b91c1c", fontSize: 13 },
});
