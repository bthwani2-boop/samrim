import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Location from "expo-location";
import * as React from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, Text, View } from "react-native";
import MapView, { type MapPressEvent, Marker, PROVIDER_GOOGLE } from "react-native-maps";

type Coordinate = Readonly<{ latitude: number; longitude: number }>;
type Selection =
  | { kind: "idle" }
  | { kind: "locating"; timer: ReturnType<typeof setTimeout> }
  | { kind: "selected"; pin: Coordinate }
  | { kind: "failed"; message: string };

const SANAA_REGION = {
  latitude: 15.3694,
  longitude: 44.191,
  latitudeDelta: 0.025,
  longitudeDelta: 0.025,
} as const;
const LOCATION_DEADLINE_MS = 15000;

function validCoordinate(coordinate: Coordinate) {
  return Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude)
    && Math.abs(coordinate.latitude) <= 90 && Math.abs(coordinate.longitude) <= 180;
}

export default function AddressEditor({ onSelect }: Readonly<{ onSelect?: (pin: Coordinate) => void }> = {}) {
  const { theme } = useMobileAppearance();
  const map = React.useRef<MapView>(null);
  const mounted = React.useRef(true);
  const current = React.useRef<Selection>({ kind: "idle" });
  const [selection, setSelection] = React.useState<Selection>(current.current);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (current.current.kind === "locating") clearTimeout(current.current.timer);
      current.current = { kind: "idle" };
    };
  }, []);

  function transition(next: Selection) {
    if (!mounted.current) return;
    if (current.current.kind === "locating") clearTimeout(current.current.timer);
    current.current = next;
    setSelection(next);
  }

  function chooseOnMap(event: MapPressEvent) {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    const coordinate = { latitude, longitude };
    if (validCoordinate(coordinate)) transition({ kind: "selected", pin: coordinate });
  }

  async function locate() {
    if (!mounted.current || current.current.kind === "locating") return;
    const attempt: Selection = {
      kind: "locating",
      timer: setTimeout(() => {
        if (current.current === attempt) {
          transition({ kind: "failed", message: "انتهت مهلة تحديد الموقع. حاول مجددًا أو اختر النقطة يدويًا." });
        }
      }, LOCATION_DEADLINE_MS),
    };
    transition(attempt);
    const isCurrent = () => mounted.current && current.current === attempt;
    const fail = (message: string) => {
      if (isCurrent()) transition({ kind: "failed", message });
    };
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!isCurrent()) return;
      if (!enabled) {
        fail("خدمات الموقع متوقفة على الجهاز. فعّلها ثم حاول مجددًا.");
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!isCurrent()) return;
      if (permission.status !== "granted") {
        fail("لم يتم منح إذن الموقع. يمكنك اختيار النقطة يدويًا على الخريطة.");
        return;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!isCurrent()) return;
      const pin = { latitude: result.coords.latitude, longitude: result.coords.longitude };
      if (!validCoordinate(pin)) {
        fail("تعذر تحديد موقع صالح. اختر النقطة يدويًا.");
        return;
      }
      transition({ kind: "selected", pin });
      map.current?.animateToRegion({ ...pin, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
    } catch {
      fail("تعذر قراءة GPS حاليًا. تحقق من الإذن وإشارة الموقع أو اختر النقطة يدويًا.");
    }
  }

  const pin = selection.kind === "selected" ? selection.pin : null;
  const busy = selection.kind === "locating";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: 14, gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 23, fontWeight: "700" }}>تحديد الموقع</Text>
        <Text style={{ color: theme.colorSecondary }}>
          المس الخريطة لتحديد نقطة، أو استخدم موقع جهازك بعد منح الإذن.
        </Text>
        <MapView
          ref={map}
          testID="address-location-map"
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          style={{ flex: 1, minHeight: 240, borderRadius: 12 }}
          initialRegion={SANAA_REGION}
          showsUserLocation={false}
          onPress={chooseOnMap}
          accessibilityLabel="خريطة اختيار نقطة العنوان"
        >
          {pin ? <Marker coordinate={pin} /> : null}
        </MapView>
        {pin ? (
          <Text testID="address-location-coordinate" style={{ color: theme.color }} selectable>
            {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
          </Text>
        ) : <Text style={{ color: theme.colorSecondary }}>لم تُحدّد نقطة بعد.</Text>}
        {selection.kind === "failed" ? (
          <Text accessibilityRole="alert" testID="address-location-error" style={{ color: theme.dangerText }}>
            {selection.message}
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" testID="address-location-request" onPress={() => { void locate(); }}
          disabled={busy} style={{ borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.actionSoft, padding: 15, borderRadius: 12, alignItems: "center" }}>
          {busy ? <ActivityIndicator color={theme.interactiveText} /> : <Text style={{ color: theme.interactiveText }}>استخدام موقعي الحالي</Text>}
        </Pressable>
        {onSelect && pin ? <Pressable accessibilityRole="button" testID="address-location-confirm"
          onPress={() => { if (mounted.current && current.current === selection) onSelect(pin); }}
          style={{ minHeight: 44, padding: 12, backgroundColor: theme.actionSoft }}>
          <Text style={{ color: theme.interactiveText }}>استخدام النقطة المحددة</Text>
        </Pressable> : null}
        <Text style={{ color: theme.colorSecondary }}>
          اختيار النقطة معاينة محلية؛ يتم حفظها فقط من نموذج العنوان بعد التحقق من الحساب.
        </Text>
      </View>
    </SafeAreaView>
  );
}
