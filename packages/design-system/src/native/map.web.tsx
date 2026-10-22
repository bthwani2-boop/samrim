import { StyleSheet, Text, View } from "react-native";
import type { BthwaniMapProps } from "./map";

export type { BthwaniMapCoordinate, BthwaniMapMarker, BthwaniMapCircle, BthwaniMapProps } from "./map";

// Browser proof: never claim an interactive native map exists on the web.
export function BthwaniMap({ accessibilityLabel, selection, height = 220 }: BthwaniMapProps) {
  return <View accessibilityLabel={accessibilityLabel} style={[styles.frame, { height }]}>
    <Text style={styles.message}>الخريطة التفاعلية غير متاحة في نسخة الويب التجريبية.</Text>
    {selection ? <Text style={styles.coordinates}>{selection.latitude.toFixed(5)}، {selection.longitude.toFixed(5)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: "100%", borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f3f5", padding: 16 },
  message: { fontSize: 14, color: "#303840", textAlign: "center", writingDirection: "rtl" },
  coordinates: { fontSize: 12, color: "#586474", marginTop: 6 },
});
