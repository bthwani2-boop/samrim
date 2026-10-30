import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { BthwaniMap } from "@bthwani/design-system/native/map";
import { isFreshOpportunitySample, type CaptainAssignment, type CaptainDeliveryTask, type CaptainOpportunityHeatmap } from "@bthwani/dsh";
import * as Location from "expo-location";
import { type Href, Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { isCurrentCaptainActor } from "./captain-session-scope";

type Mission = Readonly<{ assignment: CaptainAssignment; task: CaptainDeliveryTask }>;
type MissionReadiness = "loading" | "ready" | "unavailable";
type Props = { mission?: Mission | null; missionReadiness?: MissionReadiness };
const circleStyles = {
  ORDERS: { fillColor: "rgba(234,111,36,0.30)", strokeColor: "#EA6F24" },
  CAPTAINS: { fillColor: "rgba(12,155,151,0.28)", strokeColor: "#0C9B97" },
} as const;
const radii = { LOW: 1050, MEDIUM: 1750, HIGH: 2450 } as const;

function openNavigation(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    Alert.alert("الموقع غير متاح", "لا يمكن بدء الملاحة قبل التحقق من الوجهة.");
    return;
  }
  // Let Google Maps handle turn-by-turn voice navigation. The application
  // never streams the Captain's route to any Client or DSH endpoint.
  void Linking.openURL("https://www.google.com/maps/dir/?api=1&destination="
    + encodeURIComponent(latitude + "," + longitude) + "&travelmode=driving")
    .catch(() => Alert.alert("تعذر فتح الملاحة", "تحقق من توفر خرائط الهاتف."));
}

export function CaptainOpportunities({ mission = null, missionReadiness = "ready" }: Props) {
  const theme = useAppearanceTheme();
  const [height, setHeight] = useState(0);
  const [data, setData] = useState<CaptainOpportunityHeatmap | null>(null);
  const [ownMapCenter, setOwnMapCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const refresh = useCallback(async (quiet = false) => {
    if (mission || missionReadiness !== "ready") {
      setData(null); setLoading(false); setError(""); return;
    }
    const sequence = ++requestSequence.current;
    const before = currentIdentityState();
    if (!quiet) setLoading(true);
    setError("");
    // A stalled refresh must never leave a stale density layer visible.
    setData((previous) => previous && !isFreshOpportunitySample(previous.measuredAt)
      ? null : previous);
    if (before.kind !== "authenticated") { setLoading(false); setData(null); return; }
    const actorID = before.identity.subject.trim();
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().readOwnCaptainOpportunities(token);
      const after = currentIdentityState();
      if (sequence !== requestSequence.current || after.kind !== "authenticated"
        || !isCurrentCaptainActor(actorID, after.identity.subject.trim())) return;
      if (result.signalType !== "RECENT_ACTIVITY"
        || !isFreshOpportunitySample(result.measuredAt)
        || !Array.isArray(result.cells)
        || !result.cells.every((cell) => Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude)
          && cell.intensity in radii && (cell.kind === "ORDERS" || cell.kind === "CAPTAINS"))) {
        throw new Error("INVALID_OPPORTUNITY_RESPONSE");
      }
      setData(result);
    } catch {
      const after = currentIdentityState();
      if (sequence === requestSequence.current && after.kind === "authenticated"
        && isCurrentCaptainActor(actorID, after.identity.subject.trim())) {
        setData(null);
        setError("تعذر قراءة النشاط. لا تُعرض بيانات سابقة.");
      }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [mission, missionReadiness]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void refresh();
    void (async () => {
      try {
        const before = currentIdentityState();
        if (mission || missionReadiness !== "ready" || before.kind !== "authenticated") return;
        // Only the server-confirmed available Captain may acquire a new map fix.
        // Offline mode must not activate phone GPS merely to center the map.
        const token = await getUsableIdentityAccessToken();
        const admission = await captainClient().readOwnCaptainAdmission(token);
        const current = currentIdentityState();
        if (cancelled || current.kind !== "authenticated"
          || !isCurrentCaptainActor(before.identity.subject.trim(), current.identity.subject.trim())
          || admission.admission.state !== "eligible" || admission.admission.availabilityState !== "available") return;
        const [permission, enabled] = await Promise.all([
          Location.getForegroundPermissionsAsync(), Location.hasServicesEnabledAsync(),
        ]);
        if (!permission.granted || !enabled) return;
        const fix = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000, requiredAccuracy: 5000 })
          ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const after = currentIdentityState();
        if (!cancelled && after.kind === "authenticated"
          && isCurrentCaptainActor(before.identity.subject.trim(), after.identity.subject.trim())) {
          setOwnMapCenter({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
        }
      } catch { /* GPS center is local-only and optional; never fabricate coordinates. */ }
    })();
    const timer = setInterval(() => void refresh(true), 60_000);
    return () => { cancelled = true; clearInterval(timer); requestSequence.current++; setData(null); setOwnMapCenter(null); };
  }, [refresh, mission, missionReadiness]));

  // The single home map switches with the canonical assignment, never
  // based on an optimistic local offer decision.
  const target = mission ? mission.assignment.state === "assigned"
    ? mission.task.pickupOrigin : mission.task.customerDestination : null;
  const label = mission?.assignment.state === "assigned" ? "المتجر" : "العميل";
  const circles = !mission && missionReadiness === "ready"
    ? data?.cells.map((cell) => ({
      id: cell.kind + ":" + cell.latitude + ":" + cell.longitude,
      coordinate: { latitude: cell.latitude, longitude: cell.longitude },
      radiusMeters: radii[cell.intensity],
      fillColor: circleStyles[cell.kind].fillColor,
      strokeColor: circleStyles[cell.kind].strokeColor,
    })) ?? [] : [];
  const markers = target ? [{ id: "current-destination", coordinate: target, title: label }] : [];

  return <View style={{ flex: 1, overflow: "hidden" }}
    onLayout={(event) => setHeight(Math.round(event.nativeEvent.layout.height))}
    accessibilityLabel={mission ? "خريطة المهمة الحالية" : "خريطة نشاط الطلبات والكباتن"}>
    {height > 0 ? <BthwaniMap accessibilityLabel={mission ? "خريطة وجهة " + label : "دوائر الطلبات والكباتن"}
      height={height} circles={circles} markers={markers}
      initialCoordinate={mission ? target : ownMapCenter} edgeToEdge /> : null}
    {!mission && missionReadiness === "ready" && loading && !data
      ? <View pointerEvents="none" style={{ position: "absolute", alignSelf: "center", top: "50%" }}>
        <ActivityIndicator color={theme.actionBackground} />
      </View> : null}
    {!mission && missionReadiness !== "ready"
      ? <View style={{ position: "absolute", bottom: 18, left: 16, right: 16,
        backgroundColor: "rgba(15,29,40,0.85)", borderRadius: 12, padding: 12 }}>
        <Text accessibilityRole="alert" style={{ color: "#FFFFFF" }}>
          {missionReadiness === "loading" ? "جارٍ التحقق من المهمة…" : "تعذر تأكيد حالة المهمة. افتح التوصيلات للتحقق."}
        </Text>
      </View> : null}
    {mission && target ? <View style={{ position: "absolute", bottom: 14, left: 12, right: 12,
      backgroundColor: "rgba(15,29,40,0.89)", borderRadius: 16, padding: 12, gap: 8 }}
      accessibilityLabel="ملخص مهمة الكابتن">
      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 17 }}>
        {mission.assignment.state === "assigned" ? "الاتجاه إلى المتجر" :
          mission.assignment.state === "delivery_failed" ? "مهمة متعثرة — راجع العمليات" : "الاتجاه إلى العميل"}
      </Text>
      <Text style={{ color: "#FFFFFF", fontSize: 13 }} numberOfLines={1}>
        {mission.assignment.state === "assigned" ? mission.task.storeName : mission.task.customerAddressText}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <BthwaniButton label={"ملاحة إلى " + label} onPress={() => openNavigation(target.latitude, target.longitude)} />
        </View>
        <View style={{ flex: 1 }}>
          <Link href={"/deliveries" as Href} asChild>
            <BthwaniButton variant="secondary"
              label={mission.assignment.state === "assigned" ? "استلام الطلب" :
                mission.assignment.state === "delivery_failed" ? "معالجة التعثر" : "إجراءات التسليم"} />
          </Link>
        </View>
      </View>
    </View> : null}
    {!mission && missionReadiness === "ready" && !loading && error
      ? <View style={{ position: "absolute", bottom: 16, left: 12, right: 12,
        padding: 12, borderRadius: 12, backgroundColor: "rgba(15,29,40,0.85)" }}>
        <Text accessibilityRole="alert" style={{ color: "#FFFFFF" }}>{error}</Text>
        <BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void refresh()} />
      </View> : null}
  </View>;
}
