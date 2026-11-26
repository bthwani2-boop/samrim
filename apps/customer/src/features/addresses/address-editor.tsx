import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

type Coordinate = Readonly<{ latitude: number; longitude: number }>;

/** Browser position is a local draft input, not a DSH serviceability decision. */
export default function AddressEditor({ onSelect }: Readonly<{ onSelect?: (pin: Coordinate) => void }> = {}) {
  const { theme } = useMobileAppearance();
  const [pin, setPin] = useState<Coordinate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);

  useEffect(() => () => {
    generation.current++;
    pending.current = false;
  }, []);

  function locate() {
    if (pending.current) return;
    setPin(null);
    setError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("المتصفح لا يدعم تحديد الموقع. يمكنك إدخال الإحداثيات يدويًا.");
      return;
    }
    pending.current = true;
    const request = ++generation.current;
    setBusy(true);
    const finish = () => {
      if (!pending.current || generation.current !== request) return false;
      pending.current = false;
      setBusy(false);
      return true;
    };
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (!finish()) return;
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          setError("تعذّر تحديد نقطة صالحة. أدخل الإحداثيات يدويًا أو حاول مجددًا.");
          return;
        }
        setPin({ latitude, longitude });
      }, failure => {
        if (!finish()) return;
        setError(failure.code === 1
          ? "لم يتم منح إذن الموقع. يمكنك إدخال الإحداثيات يدويًا."
          : "تعذّر تحديد الموقع. تحقق من الاتصال والإذن أو أدخل الإحداثيات يدويًا.");
      }, { maximumAge: 0, timeout: 15000, enableHighAccuracy: true });
    } catch {
      if (finish()) setError("تعذّر الوصول إلى الموقع في هذا المتصفح. أدخل الإحداثيات يدويًا.");
    }
  }

  const button = { minHeight: 44, padding: 12, justifyContent: "center" as const,
    borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor };
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 12, backgroundColor: theme.surface }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700" }}>تحديد الموقع الحالي</Text>
      <Text style={{ color: theme.colorSecondary }}>يُطلب إذن الموقع عند الضغط فقط. راجع النقطة قبل اعتمادها في نموذج العنوان.</Text>
      <Pressable testID="web-address-location-request" accessibilityRole="button"
        disabled={busy} onPress={locate} style={button}>
        {busy ? <ActivityIndicator color={theme.interactiveText} accessibilityLabel="جارٍ تحديد الموقع" />
          : <Text style={{ color: theme.interactiveText }}>استخدام موقعي الحالي</Text>}
      </Pressable>
      {error ? <Text testID="web-address-location-error" accessibilityRole="alert" style={{ color: theme.dangerText }}>{error}</Text> : null}
      {pin ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.color }} selectable>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</Text>
          {onSelect ? <Pressable testID="web-address-location-confirm" accessibilityRole="button"
            onPress={() => onSelect(pin)} style={{ ...button, backgroundColor: theme.actionSoft }}>
            <Text style={{ color: theme.interactiveText }}>استخدام النقطة المحددة</Text>
          </Pressable> : null}
        </View>
      ) : null}
      <Text style={{ color: theme.colorSecondary }}>لا يتم حفظ الموقع إلا بعد حفظ العنوان لدى DSH.</Text>
    </View>
  );
}
