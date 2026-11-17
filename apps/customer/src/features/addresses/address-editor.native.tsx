import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Location from "expo-location";
import * as React from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, Text, View } from "react-native";
import MapView, { type MapPressEvent, Marker, PROVIDER_GOOGLE } from "react-native-maps";

type Coordinate = Readonly<{ latitude: number; longitude: number }>;

const SANAA_REGION = {
  latitude: 15.3694,
  longitude: 44.191,
  latitudeDelta: 0.025,
  longitudeDelta: 0.025,
} as const;

function validCoordinate(coordinate: Coordinate) {
  return Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude)
    && Math.abs(coordinate.latitude) <= 90 && Math.abs(coordinate.longitude) <= 180;
}

export default function AddressEditor() {
  const { theme } = useMobileAppearance();
  const map = React.useRef<MapView>(null);
  const mounted = React.useRef(true);
  const [pin, setPin] = React.useState<Coordinate | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const chooseOnMap = (event: MapPressEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    if (validCoordinate(coordinate)) {
      setPin({ latitude: coordinate.latitude, longitude: coordinate.longitude });
      setError(null);
    }
  };

  const locate = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const serviceEnabled = await Location.hasServicesEnabledAsync();
      if (!serviceEnabled) {
        setError("خدمات الموقع متوقفة على الجهاز. فعّلها ثم حاول مجددًا.");
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError("لم يتم منح إذن الموقع. يمكنك اختيار النقطة يدويًا على الخريطة.");
        return;
      }
      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinate = {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
      };
      if (!mounted.current) return;
      if (!validCoordinate(coordinate)) {
        setError("تعذر تحديد موقع صالح. اختر النقطة يدويًا.");
        return;
      }
      setPin(coordinate);
      map.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
    } catch {
      if (mounted.current) setError("تعذر قراءة GPS حاليًا. تحقق من الإذن وإشارة الموقع أو اختر النقطة يدويًا.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

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
        {error ? (
          <Text accessibilityRole="alert" testID="address-location-error" style={{ color: theme.dangerText }}>
            {error}
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" testID="address-location-request" onPress={() => { void locate(); }}
          disabled={busy} style={{ borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.actionSoft, padding: 15, borderRadius: 12, alignItems: "center" }}>
          {busy ? <ActivityIndicator color={theme.interactiveText} /> : <Text style={{ color: theme.interactiveText }}>استخدام موقعي الحالي</Text>}
        </Pressable>
        <Text style={{ color: theme.colorSecondary }}>
          هذه معاينة محلية فقط؛ لا يُحفظ العنوان أو يُرسل موقعك إلى الخدمة حتى يتوفر تكامل DSH المصرح به.
        </Text>
      </View>
    </SafeAreaView>
  );
}
