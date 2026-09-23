import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CommerceVertical, JoiningCaseResponse, ServiceCity, StoreFulfillmentMode } from "@bthwani/dsh";
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
  const [latitude, setLatitude] = useState<number | null>(current.firstStoreLatitude);
  const [longitude, setLongitude] = useState<number | null>(current.firstStoreLongitude);
  const [fulfillmentModes, setFulfillmentModes] = useState<ReadonlyArray<StoreFulfillmentMode>>(current.firstStoreFulfillmentModes);
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
    setLatitude(current.firstStoreLatitude);
    setLongitude(current.firstStoreLongitude);
    setFulfillmentModes(current.firstStoreFulfillmentModes);
  }, [current.businessName, current.firstStoreName, current.serviceCityId, current.firstStoreVerticalId, current.firstStoreLatitude, current.firstStoreLongitude, current.firstStoreFulfillmentModes]);

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

  function toggleFulfillmentMode(mode: StoreFulfillmentMode) {
    setFulfillmentModes((currentModes) => {
      const selected = currentModes.includes(mode);
      if (selected && currentModes.length === 1) return currentModes;
      return selected ? currentModes.filter((value) => value !== mode) : [...currentModes, mode];
    });
  }

  async function correctAndResubmit() {
    const nextBusinessName = businessName.trim();
    const nextStoreName = firstStoreName.trim();
	    if (nextBusinessName.length < 2 || nextBusinessName.length > 160 || nextStoreName.length < 2 || nextStoreName.length > 160 || !serviceCityId || !verticalId || latitude === null || longitude === null || fulfillmentModes.length === 0) {
		setError("أدخل الأسماء واختر المدينة والنشاط وطريقة تلبية واحدة على الأقل، وتأكد من وجود موقع المتجر الثابت.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const resubmitted = await correctAndResubmitOwnJoiningCase(current.id, nextBusinessName, nextStoreName, serviceCityId, verticalId, latitude, longitude, fulfillmentModes, current.version);
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
      <View style={styles.locationBox}><Text style={styles.label}>موقع المتجر الثابت</Text><Text selectable style={styles.muted}>{latitude !== null && longitude !== null ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : "لم يُسجل الموقع ضمن ملف الانضمام"}</Text><Text style={styles.muted}>يُجمع الموقع مع ملف الانضمام ولا يُعدّل من شاشة إدارة المتجر.</Text></View>
      <TextInput accessibilityLabel="تصحيح اسم النشاط" editable={!busy} onChangeText={setBusinessName} value={businessName} style={styles.input} />
      <TextInput accessibilityLabel="تصحيح اسم المتجر الأول" editable={!busy} onChangeText={setFirstStoreName} value={firstStoreName} style={styles.input} />
      <Text style={styles.label}>مدينة المتجر الأول</Text>
      {cities.length === 0 ? <Text style={styles.muted}>لا توجد مدن خدمة مقروءة حاليًا. أعد قراءة بيانات الشريك.</Text> : null}
      <View style={styles.cityList}>{cities.map((city) => <BthwaniChip key={city.id} disabled={busy} label={city.displayNameAr} onPress={() => setServiceCityId(city.id)} selected={serviceCityId === city.id} />)}</View>
      <Text style={styles.label}>النشاط التجاري</Text>
      {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
      {optionsError ? <View style={styles.optionError}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة الأنشطة التجارية.</Text><BthwaniButton label="إعادة قراءة الأنشطة" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
      <View style={styles.cityList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} disabled={busy} label={vertical.nameAr} onPress={() => setVerticalId(vertical.id)} selected={verticalId === vertical.id} />)}</View>
      <Text style={styles.label}>طرق تلبية الطلب في المتجر</Text>
      <Text style={styles.muted}>المحدد الآن: {fulfillmentModes.map(fulfillmentModeLabel).join(" · ") || "لم تُحدد"}</Text>
      <View style={styles.cityList}>
        <BthwaniChip disabled={busy} label="توصيل بثواني" onPress={() => toggleFulfillmentMode("BTHWANI_CAPTAIN")} selected={fulfillmentModes.includes("BTHWANI_CAPTAIN")} />
        <BthwaniChip disabled={busy} label="الاستلام من المتجر" onPress={() => toggleFulfillmentMode("CUSTOMER_PICKUP")} selected={fulfillmentModes.includes("CUSTOMER_PICKUP")} />
      </View>
      <BthwaniButton busy={busy} disabled={optionsLoading} label="حفظ التصحيح وإعادة الإرسال" onPress={() => void correctAndResubmit()} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function fulfillmentModeLabel(mode: StoreFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "توصيل بثواني";
  if (mode === "CUSTOMER_PICKUP") return "الاستلام من المتجر";
  return "توصيل المتجر";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[3], padding: spacing[3] },
    title: { ...typography.bodyStrong, color: theme.warning },
    reason: { ...typography.bodySm, color: theme.color },
    phone: { ...typography.label, color: theme.colorSecondary },
    phoneValue: { writingDirection: "ltr" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    label: { ...typography.label, color: theme.color },
    cityList: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    error: { ...typography.label, color: theme.danger },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    optionError: { gap: spacing[2] },
    locationBox: { backgroundColor: theme.structureSoft, borderRadius: radius.sm, gap: spacing[1], padding: spacing[2] },
  });
}
