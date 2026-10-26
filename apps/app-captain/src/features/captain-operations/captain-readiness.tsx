import { BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Location from "expo-location";
import { useKeepAwake } from "expo-keep-awake";
import { type CaptainAdmission, captainAdmissionStateLabel } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Switch, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { publishCaptainPresence } from "./captain-presence-publisher";
import { isCurrentCaptainActor } from "./captain-session-scope";
import { hasBackgroundMissionConsent, setBackgroundMissionConsent } from "./captain-mission-location-background";

function KeepMissionScreenAwake() {
  useKeepAwake();
  return null;
}

async function isPhoneLocationReady() {
  const [permission, services] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return permission.granted && services;
}

async function openPhoneLocationSettings() {
  if (Platform.OS === "android") {
    try {
      await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
      return;
    } catch { /* Android vendors can disallow the location settings intent. */ }
  }
  await Linking.openSettings();
}

export function CaptainReadiness({ overlay = false, missionActive = false, missionAssignmentId = "" }: { overlay?: boolean; missionActive?: boolean; missionAssignmentId?: string } = {}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const actorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const [loadedActorID, setLoadedActorID] = useState("");
  const [admission, setAdmission] = useState<CaptainAdmission | null>(null);
  const [storeOnly, setStoreOnly] = useState(false);
  const [hasActiveDelivery, setHasActiveDelivery] = useState(false);
  const [assignmentsUnknown, setAssignmentsUnknown] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);
  const [gpsChecked, setGpsChecked] = useState(false);
  const [backgroundConsent, setBackgroundConsent] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const readSequence = useRef(0);

  const refreshGps = useCallback(async () => {
    try {
      const ready = await isPhoneLocationReady();
      setGpsReady(ready);
      setGpsChecked(true);
      return ready;
    } catch {
      setGpsReady(false);
      setGpsChecked(true);
      return false;
    }
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++readSequence.current;
    const before = currentIdentityState();
    const target = before.kind === "authenticated" ? before.identity.subject.trim() : "";
    setLoading(true);
    if (!target) {
      setAdmission(null);
      setStoreOnly(false);
      setHasActiveDelivery(false);
      setAssignmentsUnknown(false);
      setLoadedActorID("");
      setError("سجّل الدخول لقراءة حالة الكابتن.");
      setLoading(false);
      return false;
    }
    try {
      const token = await getUsableIdentityAccessToken();
      const api = captainClient();
      const response = await api.readOwnCaptainAdmission(token);
      // New offers are blocked while a pickup/delivery remains assigned.
      // Read existing work before presenting a writable availability switch.
      const assignments = await api.listOwnCaptainAssignments(token).catch(() => null);
      const after = currentIdentityState();
      if (sequence !== readSequence.current || after.kind !== "authenticated" || !isCurrentCaptainActor(target, after.identity.subject.trim())) return false;
      setAdmission(response.admission);
      setStoreOnly(false);
      setHasActiveDelivery(assignments?.assignments.some((item) => item.state === "assigned" || item.state === "in_custody") ?? false);
      setAssignmentsUnknown(assignments === null);
      setLoadedActorID(target);
      return true;
    } catch {
      // Owner-created Store Captains have no public-pool admission. They may
      // still accept directed Store offers after activating their Identity role.
      try {
        const memberships = await captainClient().listOwnStoreCaptainMemberships(await getUsableIdentityAccessToken());
        const after = currentIdentityState();
        if (sequence === readSequence.current && after.kind === "authenticated" && isCurrentCaptainActor(target, after.identity.subject.trim()) &&
          memberships.memberships.some((item) => item.state === "active" && Boolean(item.displayNameAr))) {
          setAdmission(null);
          setStoreOnly(true);
          setLoadedActorID(target);
          setHasActiveDelivery(false);
          setAssignmentsUnknown(false);
          setError("");
          return true;
        }
      } catch { /* Real admission/readback errors retain the existing recovery. */ }
      const after = currentIdentityState();
      if (sequence === readSequence.current && after.kind === "authenticated" && isCurrentCaptainActor(target, after.identity.subject.trim())) {
        setStoreOnly(false);
        setAdmission(null);
        setHasActiveDelivery(false);
        setAssignmentsUnknown(false);
        setLoadedActorID("");
        setError("تعذرت قراءة حالة التوفر. افتح الصفحة مجددًا للمحاولة.");
      }
      return false;
    } finally {
      if (sequence === readSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshGps();
        void hasBackgroundMissionConsent(actorID, missionAssignmentId).then(setBackgroundConsent).catch(() => setBackgroundConsent(false));
      }
    });
    return () => subscription.remove();
  }, [refreshGps, actorID, missionAssignmentId]);

  useFocusEffect(useCallback(() => {
    setError("");
    void refreshGps();
    void hasBackgroundMissionConsent(actorID, missionAssignmentId).then(setBackgroundConsent).catch(() => setBackgroundConsent(false));
    if (actorID) void load();
    else { setAdmission(null); setStoreOnly(false); setHasActiveDelivery(false); setAssignmentsUnknown(false); setLoadedActorID(""); setLoading(false); }
    return () => { readSequence.current += 1; };
  }, [load, refreshGps, actorID, missionAssignmentId]));

  const current = isCurrentCaptainActor(loadedActorID, actorID) ? admission : null;
  const eligible = current?.state === "eligible";
  const available = current?.availabilityState === "available";
  const newOffersBlockedByDelivery = hasActiveDelivery && !available;
  const newOffersBlockedByUnknownWork = assignmentsUnknown && !available;

  async function toggleAvailability(next: boolean) {
    if (!current || !eligible || busy || loading || available === next) return;
    if (next && assignmentsUnknown) {
      setError("تعذر فحص مهامك الحالية. أعد فتح الرئيسية للتحقق قبل بدء العمل.");
      return;
    }
    if (next && hasActiveDelivery) {
      setError("لديك توصيل جارٍ. أكمله أو عالج تعثره من التوصيلات أولًا.");
      return;
    }
    const target = actorID;
    setBusy(true);
    setError("");
    try {
      if (next) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setGpsReady(false);
          setError("اسمح بموقع الهاتف أولًا لبدء استقبال العروض.");
          return;
        }
        if (!(await Location.hasServicesEnabledAsync())) {
          setGpsReady(false);
          setError("خدمات GPS مغلقة. افتح مفتاح GPS أولًا.");
          return;
        }
      }
      const token = await getUsableIdentityAccessToken();
      const before = currentIdentityState();
      if (before.kind !== "authenticated" || !isCurrentCaptainActor(target, before.identity.subject.trim())) return;
      await captainClient().setCaptainAvailability(token, next, current.version);
      const confirmed = await load();
      if (!confirmed) {
        setError("لا يمكن تأكيد التوفر الآن؛ ستُقرأ الحالة من الخادم عند العودة.");
        return;
      }
      if (next) {
        try { await publishCaptainPresence(true); }
        catch { setError("التوفر مُفعّل لكن تعذر نشر موقعك. تحقق من GPS والاتصال."); }
      }
    } catch {
      const confirmed = await load();
      setError(confirmed
        ? "تعذر تأكيد تغيير التوفر؛ اعتمد الحالة الظاهرة قبل المحاولة من جديد."
        : "تعذرت قراءة نتيجة تغيير التوفر، فلا ترسل طلبًا آخر حتى تُقرأ الحالة.");
    } finally {
      await refreshGps();
      setBusy(false);
    }
  }

  async function togglePhoneGps(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!next) {
        if (available) {
          setError("أوقف التوفر أولًا قبل إيقاف GPS؛ حتى لا تُعرض عليك طلبات دون موقع.");
          return;
        }
        // Android does not permit a third-party application to silently
        // disable the device location provider. The Switch mirrors OS truth.
        await openPhoneLocationSettings();
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError("امنح التطبيق إذن الموقع من إعدادات الهاتف.");
        await Linking.openSettings();
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        if (Platform.OS === "android") {
          try { await Location.enableNetworkProviderAsync(); }
          catch { await openPhoneLocationSettings(); }
        } else {
          await openPhoneLocationSettings();
        }
      }
      const ready = await refreshGps();
      if (!ready) setError("فعّل خدمات الموقع في إعدادات الهاتف؛ سيظهر المفتاح مفعّلًا عند نجاح ذلك.");
      else if (available) {
        try { await publishCaptainPresence(true); }
        catch { setError("GPS يعمل، لكن تعذر تحديث موقع التوزيع. تحقق من الاتصال."); }
      }
    } catch {
      setError("تعذر فتح إعدادات الموقع. يمكنك تشغيل GPS يدويًا من إعدادات الهاتف.");
    } finally {
      await refreshGps();
      setBusy(false);
    }
  }

  async function toggleBackground(next: boolean) {
    if (!missionActive || !actorID || !missionAssignmentId || backgroundBusy) return;
    setBackgroundBusy(true);
    setError("");
    try {
      await setBackgroundMissionConsent(next, actorID, missionAssignmentId);
      setBackgroundConsent(await hasBackgroundMissionConsent(actorID, missionAssignmentId));
    } catch {
      setBackgroundConsent(false);
      setError("تعذر تفعيل مشاركة الموقع بالخلفية. اسمح بإذن الموقع الدائم من إعدادات Android أو استخدم التتبع في المقدمة.");
    } finally { setBackgroundBusy(false); }
  }

  if (overlay) return <View style={{ marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 7, borderRadius: 16, backgroundColor: "rgba(15,29,40,0.73)" }} accessibilityLabel="التحكم بالجاهزية على الخريطة">
    {missionActive ? <KeepMissionScreenAwake /> : null}
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", gap: 10 }}>
      <View style={{ flex: 1, alignItems: "center", gap: 3 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>{missionActive ? "المهمة" : storeOnly ? "المتجر" : "التوفر"}</Text>
        {missionActive ? <Text style={{ color: "#FFFFFF", fontSize: 12 }}>مشغول</Text> : storeOnly ?
          <Text style={{ color: "#FFFFFF", fontSize: 12 }}>مرتبط</Text> :
          <Switch accessibilityLabel="مفتاح توفر الكابتن" accessibilityRole="switch"
            value={available} disabled={!eligible || busy || loading || newOffersBlockedByDelivery || newOffersBlockedByUnknownWork}
            onValueChange={(value) => void toggleAvailability(value)}
            trackColor={{ false: "#76818A", true: "#78D8A7" }}
            thumbColor={available ? "#087F46" : "#F9FAFB"} />}
      </View>
      <View style={{ width: 1, height: 35, backgroundColor: "rgba(255,255,255,0.25)" }} />
      <View style={{ flex: 1, alignItems: "center", gap: 3 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>GPS</Text>
        <Switch accessibilityLabel="مفتاح GPS الهاتف" accessibilityRole="switch"
          value={gpsReady} disabled={busy || !gpsChecked}
          onValueChange={(value) => void togglePhoneGps(value)}
          trackColor={{ false: "#76818A", true: "#78D8A7" }}
          thumbColor={gpsReady ? "#087F46" : "#F9FAFB"} />
      </View>
      <View style={{ width: 1, height: 35, backgroundColor: "rgba(255,255,255,0.25)" }} />
      <View style={{ flex: 1.2, gap: 5 }}>
        {missionActive ? <Text style={{ fontSize: 12, color: "#FFFFFF", fontWeight: "700" }}>وجهة التوصيل</Text> : <>
          <Text style={{ fontSize: 12, color: "#FFFFFF", fontWeight: "700" }}>
            <Text style={{ color: "#FF9A50" }}>● </Text>الطلبات
          </Text>
          <Text style={{ fontSize: 12, color: "#FFFFFF", fontWeight: "700" }}>
            <Text style={{ color: "#55D9CE" }}>● </Text>الكباتن
          </Text>
        </>}
      </View>
    </View>
    {missionActive ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 12, color: "#FFFFFF" }}>مشاركة الموقع أثناء المهمة بالخلفية</Text>
      <Switch accessibilityLabel="مشاركة موقع المهمة بالخلفية للعمليات" value={backgroundConsent}
        disabled={backgroundBusy || !gpsReady} onValueChange={(enabled) => void toggleBackground(enabled)}
        trackColor={{ false: "#76818A", true: "#78D8A7" }} thumbColor={backgroundConsent ? "#087F46" : "#F9FAFB"} />
    </View> : null}
    {storeOnly && !missionActive ? <Text style={{ color: "#FFFFFF", fontSize: 12 }}>طلبات المتجر تصل من التوصيلات، دون تفعيل توزيع بثواني العام.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: "#FFE4B3", fontSize: 12 }}>{error}</Text> : null}
    {newOffersBlockedByDelivery && !missionActive ? <Text accessibilityRole="alert" style={{ color: "#FFE4B3", fontSize: 12 }}>مشغول بتوصيل جارٍ · افتح إجراءات المهمة أسفل الخريطة</Text> : null}
    {newOffersBlockedByUnknownWork ? <Text accessibilityRole="alert" style={{ color: "#FFE4B3", fontSize: 12 }}>تعذر التحقق من المهام</Text> : null}
    {!eligible && current ? <Text style={{ color: "#FFE4B3", fontSize: 11 }}>التوفر يتطلب اعتماد الحساب</Text> : null}
    {loading && !current ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
  </View>;

  return <View style={styles.container} accessibilityLabel="جاهزية الكابتن">
    <Text style={styles.readinessTitle}>الجاهزية</Text>
    {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الجاهزية…</Text></View> : null}
    {storeOnly ? <View style={styles.readinessHero}>
      <Text style={styles.cardTitle}>توصيل المتجر</Text>
      <Text style={styles.muted}>عضويتك نشطة. عروض المتجر تصل عبر التوصيلات ولا تحتاج إلى تفعيل التوزيع العام.</Text>
    </View> : null}
    {current ? <View style={styles.readinessHero}>
      <View style={styles.readinessHeroHeader}>
        <Text style={styles.readinessEyebrow}>حالة الحساب</Text>
        <BthwaniStatusBadge icon={eligible ? "success" : "warning"} label={captainAdmissionStateLabel(current.state)} tone={eligible ? "success" : "warning"} />
      </View>
      <View style={styles.readinessSwitchRow}>
        <View style={styles.readinessHeroCopy}>
          <Text style={styles.cardTitle}>التوفر لاستقبال العروض</Text>
          <Text style={styles.muted}>{available ? "متاح للعمل" : newOffersBlockedByDelivery ? "مشغول بتوصيل جارٍ" : "غير متاح حاليًا"}</Text>
        </View>
        <Switch accessibilityLabel="مفتاح توفر الكابتن" accessibilityRole="switch"
          value={available} disabled={!eligible || busy || loading || newOffersBlockedByDelivery || newOffersBlockedByUnknownWork}
          onValueChange={(value) => void toggleAvailability(value)}
          trackColor={{ false: theme.borderColor, true: theme.successSoft }}
          thumbColor={available ? theme.success : theme.surface}
        />
      </View>
      <View style={styles.readinessSwitchRow}>
        <View style={styles.readinessHeroCopy}>
          <Text style={styles.cardTitle}>GPS الهاتف</Text>
          <Text style={styles.muted}>{gpsReady ? "الموقع يعمل" : gpsChecked ? "الموقع متوقف أو الإذن غير متاح" : "جارٍ التحقق من الموقع…"}</Text>
        </View>
        <Switch accessibilityLabel="مفتاح GPS الهاتف" accessibilityRole="switch"
          value={gpsReady} disabled={busy || !gpsChecked}
          onValueChange={(value) => void togglePhoneGps(value)}
          trackColor={{ false: theme.borderColor, true: theme.successSoft }}
          thumbColor={gpsReady ? theme.success : theme.surface}
        />
      </View>
      <Text style={styles.muted}>مفتاح GPS يعكس حالة الهاتف، وقد يفتح إعدادات الموقع.</Text>
      {newOffersBlockedByDelivery ? <Text style={styles.muted}>أكمل التوصيل الحالي أو عالج تعثره من التوصيلات قبل استقبال طلب جديد.</Text> : null}
      {newOffersBlockedByUnknownWork ? <Text style={styles.muted}>تعذرت قراءة التوصيلات؛ أعد فتح الرئيسية للتحقق.</Text> : null}
      {!eligible ? <Text style={styles.muted}>يُفعّل التوفر بعد اعتماد الكابتن.</Text> : null}
    </View> : null}
    {error ? <View style={styles.readinessError}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View> : null}
  </View>;
}
