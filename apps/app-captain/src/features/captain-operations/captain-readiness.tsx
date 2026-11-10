import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAdmission, captainAdmissionStateLabel } from "@bthwani/dsh";
import { useKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Switch, Text, View } from "react-native";
import { captainSessionKey } from "../../bootstrap/captain-session-scope";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { hasBackgroundMissionConsent, setBackgroundMissionConsent } from "./captain-mission-location-background";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { publishCaptainPresence } from "./captain-presence-publisher";

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

export function CaptainReadiness({ overlay = false, missionActive = false, missionAssignmentId = "", onAvailabilityConfirmed }: { overlay?: boolean; missionActive?: boolean; missionAssignmentId?: string; onAvailabilityConfirmed?: () => void } = {}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const actorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const sessionKey = captainSessionKey(identityState);
  const [loadedSessionKey, setLoadedSessionKey] = useState("");
  const [admission, setAdmission] = useState<CaptainAdmission | null>(null);
  const [storeOnly, setStoreOnly] = useState(false);
  const [hasActiveDelivery, setHasActiveDelivery] = useState(false);
  const [assignmentsUnknown, setAssignmentsUnknown] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);
  const [locationSettingsNeeded, setLocationSettingsNeeded] = useState(false);
  const [locationRecoveryBusy, setLocationRecoveryBusy] = useState(false);
  const [backgroundConsent, setBackgroundConsent] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const readSequence = useRef(0);
  const availabilityInFlight = useRef(false);
  const backgroundInFlight = useRef(false);
  const locationInFlight = useRef(false);

  const refreshGps = useCallback(async () => {
    try {
      const ready = await isPhoneLocationReady();
      setGpsReady(ready);
      if (ready) setLocationSettingsNeeded(false);
      return ready;
    } catch {
      setGpsReady(false);
      return false;
    }
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++readSequence.current;
    const requestSession = captainSessionKey(currentIdentityState());
    const isCurrent = () => Boolean(requestSession) && sequence === readSequence.current
      && captainSessionKey(currentIdentityState()) === requestSession;
    setLoading(true);
    setAdmission(null);
    setStoreOnly(false);
    setHasActiveDelivery(false);
    setAssignmentsUnknown(false);
    setLoadedSessionKey("");
    if (!requestSession) {
      setError("سجّل الدخول لقراءة حالة الكابتن.");
      setLoading(false);
      return false;
    }
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return false;
      const api = captainClient();
      const response = await api.readOwnCaptainAdmission(token);
      if (!isCurrent()) return false;
      // Availability requires a fresh canonical assignment readback.
      const assignments = await api.listOwnCaptainAssignments(token).catch(() => null);
      if (!isCurrent()) return false;
      setAdmission(response.admission);
      setHasActiveDelivery(assignments?.assignments.some((item) => item.state === "assigned" || item.state === "in_custody") ?? false);
      setAssignmentsUnknown(assignments === null);
      setLoadedSessionKey(requestSession);
      return true;
    } catch {
      if (!isCurrent()) return false;
      // Store Captains may be authorized for a Store without public dispatch admission.
      try {
        const token = await getUsableIdentityAccessToken();
        if (!isCurrent()) return false;
        const memberships = await captainClient().listOwnStoreCaptainMemberships(token);
        if (!isCurrent()) return false;
        if (memberships.memberships.some((item) => item.state === "active" && Boolean(item.displayNameAr))) {
          setStoreOnly(true);
          setLoadedSessionKey(requestSession);
          setError("");
          return true;
        }
      } catch { /* Existing recovery is retained for real admission/readback failure. */ }
      if (!isCurrent()) return false;
      setError("تعذرت قراءة حالة التوفر. افتح الصفحة مجددًا للمحاولة.");
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useEffect(() => {
    setBusy(false);
    setBackgroundBusy(false);
    setLocationRecoveryBusy(false);
    setError("");
    setBackgroundConsent(false);
    setLoading(Boolean(sessionKey));
  }, [sessionKey]);

  const refreshConsent = useCallback(async () => {
    const readSession = sessionKey;
    if (!readSession) { setBackgroundConsent(false); return; }
    try {
      const enabled = await hasBackgroundMissionConsent(actorID, missionAssignmentId);
      if (captainSessionKey(currentIdentityState()) === readSession) setBackgroundConsent(enabled);
    } catch {
      if (captainSessionKey(currentIdentityState()) === readSession) setBackgroundConsent(false);
    }
  }, [actorID, missionAssignmentId, sessionKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshGps();
        void refreshConsent();
      }
    });
    return () => subscription.remove();
  }, [refreshGps, refreshConsent]);

  useFocusEffect(useCallback(() => {
    setError("");
    void refreshGps();
    void refreshConsent();
    if (sessionKey) void load();
    else {
      setAdmission(null);
      setStoreOnly(false);
      setHasActiveDelivery(false);
      setAssignmentsUnknown(false);
      setLoadedSessionKey("");
      setLoading(false);
    }
    return () => { readSequence.current += 1; };
  }, [load, refreshGps, refreshConsent, sessionKey]));

  const currentSessionRead = Boolean(sessionKey) && loadedSessionKey === sessionKey
    && captainSessionKey(currentIdentityState()) === sessionKey;
  const current = currentSessionRead ? admission : null;
  const visibleStoreOnly = currentSessionRead && storeOnly;
  const visibleBackgroundConsent = currentSessionRead && backgroundConsent;
  const eligible = current?.state === "eligible";
  const available = current?.availabilityState === "available";
  const newOffersBlockedByDelivery = currentSessionRead && hasActiveDelivery && !available;
  const newOffersBlockedByUnknownWork = currentSessionRead && assignmentsUnknown && !available;

  async function toggleAvailability(next: boolean) {
    if (!currentSessionRead || !current || !eligible || busy || loading || available === next
      || availabilityInFlight.current || captainSessionKey(currentIdentityState()) !== loadedSessionKey) return;
    if (next && assignmentsUnknown) {
      setError("تعذر فحص مهامك الحالية. أعد فتح الرئيسية للتحقق قبل بدء العمل.");
      return;
    }
    if (next && hasActiveDelivery) {
      setError("لديك توصيل جارٍ. أكمله أو عالج تعثره من التوصيلات أولًا.");
      return;
    }
    const requestSession = loadedSessionKey;
    const isCurrent = () => Boolean(requestSession) && captainSessionKey(currentIdentityState()) === requestSession;
    availabilityInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (next) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!isCurrent()) return;
        if (!permission.granted) {
          setGpsReady(false);
          if (!permission.canAskAgain) {
            setLocationSettingsNeeded(true);
            setError("إذن الموقع مرفوض من إعدادات التطبيق. افتح إعدادات الإذن للسماح بالموقع.");
          } else {
            setError("اسمح بموقع الهاتف أولًا لبدء استقبال العروض.");
          }
          return;
        }
        setLocationSettingsNeeded(false);
        const services = await Location.hasServicesEnabledAsync();
        if (!isCurrent()) return;
        if (!services) {
          try {
            if (Platform.OS === "android") await Location.enableNetworkProviderAsync();
            else await openPhoneLocationSettings();
          } catch {
            if (isCurrent()) await openPhoneLocationSettings().catch(() => {});
          }
          if (!isCurrent()) return;
          const enabled = await Location.hasServicesEnabledAsync();
          if (!isCurrent()) return;
          if (!enabled) {
            setGpsReady(false);
            setError("فعّل موقع الهاتف ثم اضغط التوفر مجددًا لإكمال التشغيل.");
            return;
          }
        }
        setGpsReady(true);
      }
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      await captainClient().setCaptainAvailability(token, next, current.version);
      if (!isCurrent()) return;
      const confirmed = await load();
      if (!isCurrent()) return;
      if (!confirmed) {
        setError("لا يمكن تأكيد التوفر الآن؛ ستُقرأ الحالة من الخادم عند العودة.");
        return;
      }
      onAvailabilityConfirmed?.();
      if (next) {
        try { await publishCaptainPresence(true); }
        catch {
          if (isCurrent()) setError("التوفر مُفعّل لكن تعذر نشر موقعك. تحقق من GPS والاتصال.");
        }
      }
    } catch {
      if (!isCurrent()) return;
      const confirmed = await load();
      if (!isCurrent()) return;
      setError(confirmed
        ? "تعذر تأكيد تغيير التوفر؛ اعتمد الحالة الظاهرة قبل المحاولة من جديد."
        : "تعذرت قراءة نتيجة تغيير التوفر، فلا ترسل طلبًا آخر حتى تُقرأ الحالة.");
    } finally {
      availabilityInFlight.current = false;
      if (isCurrent()) {
        await refreshGps();
        if (isCurrent()) setBusy(false);
      }
    }
  }

  async function recoverPhoneLocation(onlyGps = false) {
    // Device GPS recovery never writes DSH availability or grants admission.
    if (!sessionKey || locationRecoveryBusy || locationInFlight.current
      || (!onlyGps && (missionActive ? !missionAssignmentId : !available))) return;
    const forMission = missionActive;
    const requestSession = sessionKey;
    const isCurrent = () => captainSessionKey(currentIdentityState()) === requestSession;
    if (!isCurrent()) return;
    locationInFlight.current = true;
    setLocationRecoveryBusy(true);
    setError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!isCurrent()) return;
      if (!permission.granted) {
        setGpsReady(false);
        if (!permission.canAskAgain) {
          setLocationSettingsNeeded(true);
          setError(forMission
            ? "إذن موقع المهمة مرفوض. افتح إعدادات التطبيق للسماح بالموقع."
            : "إذن موقع التوزيع مرفوض. افتح إعدادات التطبيق للسماح بالموقع.");
          await Linking.openSettings().catch(() => {});
        } else {
          setError(forMission
            ? "اسمح بموقع الهاتف لتتبع مهمة التوصيل الحالية."
            : "اسمح بموقع الهاتف لمواصلة التوفر واستقبال العروض.");
        }
        return;
      }
      setLocationSettingsNeeded(false);
      const services = await Location.hasServicesEnabledAsync();
      if (!isCurrent()) return;
      if (!services) {
        try {
          if (Platform.OS === "android") await Location.enableNetworkProviderAsync();
          else await openPhoneLocationSettings();
        } catch {
          if (isCurrent()) await openPhoneLocationSettings().catch(() => {});
        }
      }
      if (!isCurrent()) return;
      const ready = await refreshGps();
      if (!isCurrent()) return;
      if (!ready) {
        setError(forMission
          ? "فعّل موقع الهاتف ثم اضغط تشغيل موقع المهمة مجددًا."
          : "فعّل خدمات الموقع ثم اضغط استعادة الموقع مجددًا.");
        return;
      }
      if (!forMission && !onlyGps) {
        // Service availability and latest dispatch presence remain DSH-owned.
        onAvailabilityConfirmed?.();
        try {
          await publishCaptainPresence(true);
        } catch {
          if (isCurrent()) setError("عاد موقع الهاتف، لكن تعذر نشر موقع التوزيع. تحقق من الاتصال وحاول مجددًا.");
        }
      }
    } catch {
      if (isCurrent()) setError(forMission
        ? "تعذر تفعيل موقع المهمة. تحقق من إعدادات الموقع وحاول مجددًا."
        : "تعذر استعادة موقع التوزيع. تحقق من إعدادات الموقع وحاول مجددًا.");
    } finally {
      locationInFlight.current = false;
      if (isCurrent()) setLocationRecoveryBusy(false);
    }
  }

  async function togglePhoneGps(next: boolean) {
    if (!sessionKey || captainSessionKey(currentIdentityState()) !== sessionKey
      || locationRecoveryBusy || locationInFlight.current) return;
    if (next) { await recoverPhoneLocation(!available && !missionActive); return; }
    // Android cannot silently turn off OS location. Never interrupt active dispatch
    // or an active mission, and never infer offline from an unread DSH state.
    if (!currentSessionRead || (!current && !visibleStoreOnly)) {
      setError("تحقق من حالة حسابك والتوفر قبل تغيير GPS.");
      return;
    }
    if (missionActive || available) {
      setError("أوقف التوفر بعد إنهاء المهمة الجارية قبل إيقاف موقع الهاتف.");
      return;
    }
    const requestSession = sessionKey;
    try {
      await openPhoneLocationSettings();
      if (captainSessionKey(currentIdentityState()) === requestSession) void refreshGps();
    } catch {
      if (captainSessionKey(currentIdentityState()) === requestSession) setError("تعذر فتح إعدادات موقع الهاتف.");
    }
  }

  async function toggleBackground(next: boolean) {
    if (!missionActive || !sessionKey || !actorID || !missionAssignmentId
      || backgroundBusy || backgroundInFlight.current) return;
    const requestSession = sessionKey;
    const isCurrent = () => captainSessionKey(currentIdentityState()) === requestSession;
    if (!isCurrent()) return;
    backgroundInFlight.current = true;
    setBackgroundBusy(true);
    setError("");
    try {
      await setBackgroundMissionConsent(next, actorID, missionAssignmentId);
      if (!isCurrent()) return;
      const enabled = await hasBackgroundMissionConsent(actorID, missionAssignmentId);
      if (isCurrent()) setBackgroundConsent(enabled);
    } catch {
      if (isCurrent()) {
        setBackgroundConsent(false);
        setError("تعذر تفعيل مشاركة الموقع بالخلفية. اسمح بإذن الموقع الدائم من إعدادات Android أو استخدم التتبع في المقدمة.");
      }
    } finally {
      backgroundInFlight.current = false;
      if (isCurrent()) setBackgroundBusy(false);
    }
  }

  if (overlay) return <View style={{ marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 7, borderRadius: 16, backgroundColor: "rgba(15,29,40,0.73)" }} accessibilityLabel="التحكم بالجاهزية على الخريطة">
    {missionActive ? <KeepMissionScreenAwake /> : null}
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", gap: 10 }}>
      <View style={{ flex: 1, alignItems: "center", gap: 3 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>{missionActive ? "المهمة" : visibleStoreOnly ? "المتجر" : "التوفر"}</Text>
        {missionActive ? <Text style={{ color: "#FFFFFF", fontSize: 12 }}>مشغول</Text> : visibleStoreOnly ?
          <Text style={{ color: "#FFFFFF", fontSize: 12 }}>مرتبط</Text> :
          <Switch accessibilityLabel="مفتاح توفر الكابتن" accessibilityRole="switch"
            value={available} disabled={!eligible || busy || loading || newOffersBlockedByDelivery || newOffersBlockedByUnknownWork}
            onValueChange={(value) => void toggleAvailability(value)}
            trackColor={{ false: "#76818A", true: "#78D8A7" }}
            thumbColor={available ? "#087F46" : "#F9FAFB"} />}
        {!missionActive && !visibleStoreOnly ? <Text style={{ color: "#FFFFFF", fontSize: 11 }}>
          {available ? (gpsReady ? "الموقع يعمل" : "شغّل GPS لمواصلة العمل") : "موقع التوزيع متوقف"}
        </Text> : null}
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
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 4 }}>
      <Text style={{ color: "#FFFFFF", fontSize: 12 }}>موقع الهاتف (GPS)</Text>
      <Switch accessibilityLabel="مفتاح GPS الهاتف" accessibilityRole="switch"
        value={gpsReady} disabled={!sessionKey || locationRecoveryBusy}
        onValueChange={(value) => void togglePhoneGps(value)}
        trackColor={{ false: "#76818A", true: "#78D8A7" }}
        thumbColor={gpsReady ? "#087F46" : "#F9FAFB"} />
    </View>
    {missionActive ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 12, color: "#FFFFFF" }}>مشاركة الموقع أثناء المهمة بالخلفية</Text>
      <Switch accessibilityLabel="مشاركة موقع المهمة بالخلفية للعمليات" value={visibleBackgroundConsent}
        disabled={!currentSessionRead || backgroundBusy || !gpsReady} onValueChange={(enabled) => void toggleBackground(enabled)}
        trackColor={{ false: "#76818A", true: "#78D8A7" }} thumbColor={visibleBackgroundConsent ? "#087F46" : "#F9FAFB"} />
    </View> : null}
    {!gpsReady && (missionActive || (!visibleStoreOnly && available)) ? <BthwaniButton
      label={locationRecoveryBusy ? "جارٍ استعادة الموقع..." : missionActive ? "تشغيل موقع المهمة" : "استعادة موقع التوزيع"}
      variant="secondary" disabled={locationRecoveryBusy} onPress={() => void recoverPhoneLocation()} /> : null}
    {locationSettingsNeeded ? <BthwaniButton label="فتح إعدادات إذن الموقع" variant="secondary"
      onPress={() => void Linking.openSettings().catch(() => setError("تعذر فتح إعدادات التطبيق."))} /> : null}
    {visibleStoreOnly && !missionActive ? <Text style={{ color: "#FFFFFF", fontSize: 12 }}>طلبات المتجر تصل من التوصيلات، دون تفعيل توزيع بثواني العام.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: "#FFE4B3", fontSize: 12 }}>{error}</Text> : null}
    {newOffersBlockedByDelivery && !missionActive ? <Text accessibilityRole="alert" style={{ color: "#FFE4B3", fontSize: 12 }}>مشغول بتوصيل جارٍ · افتح إجراءات المهمة أسفل الخريطة</Text> : null}
    {newOffersBlockedByUnknownWork ? <Text accessibilityRole="alert" style={{ color: "#FFE4B3", fontSize: 12 }}>تعذر التحقق من المهام</Text> : null}
    {!eligible && current ? <Text style={{ color: "#FFE4B3", fontSize: 11 }}>التوفر يتطلب اعتماد الحساب</Text> : null}
    {loading && !current ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
  </View>;

  return <View style={styles.container} accessibilityLabel="جاهزية الكابتن">
    <Text style={styles.readinessTitle}>الجاهزية</Text>
    {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الجاهزية…</Text></View> : null}
    {visibleStoreOnly ? <View style={styles.readinessHero}>
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
          <Text style={styles.cardTitle}>موقع الهاتف (GPS)</Text>
          <Text style={styles.muted}>{gpsReady ? "GPS متاح" : "GPS مغلق أو إذنه غير مفعل"}</Text>
        </View>
        <Switch accessibilityLabel="مفتاح GPS الهاتف" accessibilityRole="switch"
          value={gpsReady} disabled={!sessionKey || locationRecoveryBusy}
          onValueChange={(value) => void togglePhoneGps(value)}
          trackColor={{ false: theme.borderColor, true: theme.successSoft }}
          thumbColor={gpsReady ? theme.success : theme.surface}
        />
      </View>
      <Text style={styles.muted}>
        {available ? (gpsReady ? "موقع التوزيع يعمل." : "موقع الهاتف غير متاح؛ شغّل GPS لاستمرار استقبال العروض.")
          : "موقع التوزيع متوقف. سيطلب التطبيق تشغيل الموقع عند تفعيل التوفر."}
      </Text>
      {available && !gpsReady ? <BthwaniButton
        label={locationRecoveryBusy ? "جارٍ استعادة الموقع..." : "استعادة موقع التوزيع"}
        variant="secondary" disabled={locationRecoveryBusy} onPress={() => void recoverPhoneLocation()} /> : null}
      {newOffersBlockedByDelivery ? <Text style={styles.muted}>أكمل التوصيل الحالي أو عالج تعثره من التوصيلات قبل استقبال طلب جديد.</Text> : null}
      {newOffersBlockedByUnknownWork ? <Text style={styles.muted}>تعذرت قراءة التوصيلات؛ أعد فتح الرئيسية للتحقق.</Text> : null}
      {!eligible ? <Text style={styles.muted}>يُفعّل التوفر بعد اعتماد الكابتن.</Text> : null}
    </View> : null}
    {locationSettingsNeeded ? <BthwaniButton label="فتح إعدادات إذن الموقع" variant="secondary"
      onPress={() => void Linking.openSettings().catch(() => setError("تعذر فتح إعدادات التطبيق."))} /> : null}
    {error ? <View style={styles.readinessError}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View> : null}
  </View>;
}
