import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

type Coordinate = Readonly<{ latitude: number; longitude: number }>;
type Selection =
  | { kind: "idle" }
  | { kind: "locating"; timer: ReturnType<typeof setTimeout> }
  | { kind: "selected"; pin: Coordinate }
  | { kind: "failed"; message: string };
const LOCATION_DEADLINE_MS = 15000;

/** Browser position is a local draft input, not a DSH serviceability decision. */
export default function AddressEditor({ onSelect }: Readonly<{ onSelect?: (pin: Coordinate) => void }> = {}) {
  const { theme } = useMobileAppearance();
  const mounted = useRef(true);
  const current = useRef<Selection>({ kind: "idle" });
  const [selection, setSelection] = useState<Selection>(current.current);

  useEffect(() => {
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

  function locate() {
    if (!mounted.current || current.current.kind === "locating") return;
    const attempt: Selection = {
      kind: "locating",
      timer: setTimeout(() => {
        if (current.current === attempt) {
          transition({ kind: "failed", message: "انتهت مهلة تحديد الموقع. حاول مجددًا أو أدخل الإحداثيات يدويًا." });
        }
      }, LOCATION_DEADLINE_MS),
    };
    transition(attempt);
    const isCurrent = () => mounted.current && current.current === attempt;
    const fail = (message: string) => {
      if (isCurrent()) transition({ kind: "failed", message });
    };
    try {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        fail("المتصفح لا يدعم تحديد الموقع. يمكنك إدخال الإحداثيات يدويًا.");
        return;
      }
      navigator.geolocation.getCurrentPosition(position => {
        if (!isCurrent()) return;
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          fail("تعذّر تحديد نقطة صالحة. أدخل الإحداثيات يدويًا أو حاول مجددًا.");
          return;
        }
        transition({ kind: "selected", pin: { latitude, longitude } });
      }, failure => {
        fail(failure.code === 1
          ? "لم يتم منح إذن الموقع. يمكنك إدخال الإحداثيات يدويًا."
          : "تعذّر تحديد الموقع. تحقق من الاتصال والإذن أو أدخل الإحداثيات يدويًا.");
      }, { maximumAge: 0, timeout: LOCATION_DEADLINE_MS, enableHighAccuracy: true });
    } catch {
      fail("تعذّر الوصول إلى الموقع في هذا المتصفح. أدخل الإحداثيات يدويًا.");
    }
  }

  const pin = selection.kind === "selected" ? selection.pin : null;
  const busy = selection.kind === "locating";
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
      {selection.kind === "failed" ? <Text testID="web-address-location-error" accessibilityRole="alert" style={{ color: theme.dangerText }}>{selection.message}</Text> : null}
      {pin ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.color }} selectable>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</Text>
          {onSelect ? <Pressable testID="web-address-location-confirm" accessibilityRole="button"
            onPress={() => { if (mounted.current && current.current === selection) onSelect(pin); }}
            style={{ ...button, backgroundColor: theme.actionSoft }}>
            <Text style={{ color: theme.interactiveText }}>استخدام النقطة المحددة</Text>
          </Pressable> : null}
        </View>
      ) : null}
      <Text style={{ color: theme.colorSecondary }}>لا يتم حفظ الموقع إلا بعد حفظ العنوان لدى DSH.</Text>
    </View>
  );
}
