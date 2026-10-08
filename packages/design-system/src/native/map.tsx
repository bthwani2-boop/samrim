import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import MapView, { type MapPressEvent, Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { spacing, typography } from "../tokens";
import { useAppearanceTheme } from "./appearance";
import { BthwaniButton } from "./primitives";

export type BthwaniMapCoordinate = Readonly<{ latitude: number; longitude: number }>;
export type BthwaniMapMarker = Readonly<{
  id: string;
  coordinate: BthwaniMapCoordinate;
  title: string;
  description?: string;
}>;

type BthwaniMapProps = Readonly<{
  accessibilityLabel: string;
  markers?: ReadonlyArray<BthwaniMapMarker>;
  selection?: BthwaniMapCoordinate | null;
  selectionTitle?: string;
  onSelectCoordinate?: (coordinate: BthwaniMapCoordinate) => void;
  height?: number;
  initialCoordinate?: BthwaniMapCoordinate | null;
}>;

function coordinateSpan(values: ReadonlyArray<number>) {
  if (values.length < 2) return 0.035;
  return Math.max(0.025, (Math.max(...values) - Math.min(...values)) * 1.8);
}

function initialRegion(markers: ReadonlyArray<BthwaniMapMarker>, selection?: BthwaniMapCoordinate | null, initialCoordinate?: BthwaniMapCoordinate | null): Region {
  const coordinates = [...markers.map((marker) => marker.coordinate), ...(selection ? [selection] : [])];
  if (coordinates.length === 0 && initialCoordinate) coordinates.push(initialCoordinate);
  // No city coordinates are present in ServiceCity. Start with country context
  // instead of implying that an unselected store is located in Sana'a.
  if (coordinates.length === 0) return { latitude: 15.5, longitude: 47.5, latitudeDelta: 9, longitudeDelta: 9 };
  const latitude = coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length;
  const longitude = coordinates.reduce((sum, point) => sum + point.longitude, 0) / coordinates.length;
  const latitudeSpan = coordinateSpan(coordinates.map((point) => point.latitude));
  const longitudeSpan = coordinateSpan(coordinates.map((point) => point.longitude));
  return { latitude, longitude, latitudeDelta: latitudeSpan, longitudeDelta: longitudeSpan };
}

export function BthwaniMap({ accessibilityLabel, markers = [], selection, selectionTitle = "الموقع المحدد", onSelectCoordinate, height = 220, initialCoordinate }: BthwaniMapProps) {
  const theme = useAppearanceTheme();
  const map = useRef<MapView>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const selectionLatitude = selection?.latitude;
  const selectionLongitude = selection?.longitude;
  useEffect(() => {
    if (selectionLatitude === undefined || selectionLongitude === undefined) return;
    map.current?.animateToRegion({ latitude: selectionLatitude, longitude: selectionLongitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 300);
  }, [selectionLatitude, selectionLongitude]);

  useEffect(() => {
    if (loadState !== "loading") return;
    const timer = setTimeout(() => setLoadState("unavailable"), 15000);
    return () => clearTimeout(timer);
  }, [loadState]);

  function selectMapPoint(event: MapPressEvent) {
    onSelectCoordinate?.(event.nativeEvent.coordinate);
  }

  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.frame, { height, backgroundColor: theme.surface }]}>
      <MapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion(markers, selection, initialCoordinate)}
        loadingEnabled
        loadingBackgroundColor={theme.surface}
        loadingIndicatorColor={theme.interactiveText}
        onMapReady={() => setLoadState("ready")}
        onMapLoaded={() => setLoadState("ready")}
        {...(onSelectCoordinate ? { onPress: selectMapPoint } : {})}
        style={StyleSheet.absoluteFill}
      >
        {markers.map((marker) => (
          <Marker key={marker.id} coordinate={marker.coordinate} title={marker.title} {...(marker.description ? { description: marker.description } : {})} />
        ))}
        {selection ? <Marker coordinate={selection} title={selectionTitle} draggable={Boolean(onSelectCoordinate)} {...(onSelectCoordinate ? { onDragEnd: (event) => onSelectCoordinate(event.nativeEvent.coordinate) } : {})} /> : null}
      </MapView>
      {loadState === "loading" ? <View pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.loadHint, { backgroundColor: theme.surface }]}><ActivityIndicator color={theme.interactiveText} /><Text style={[styles.stateText, { color: theme.colorMuted }]}>جارٍ تحميل الخريطة…</Text></View> : null}
      {loadState === "unavailable" ? <View accessibilityLiveRegion="polite" style={[styles.unavailable, { backgroundColor: theme.surface }]}><Text style={[styles.stateText, { color: theme.color }]}>تعذر تحميل الخريطة. تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة تحميل الخريطة" onPress={() => { map.current?.animateToRegion(initialRegion(markers, selection, initialCoordinate), 300); setLoadState("loading"); }} variant="secondary" /></View> : null}
      {onSelectCoordinate && loadState === "ready" ? <View pointerEvents="none" style={[styles.hint, { backgroundColor: theme.surface }]}><Text style={[styles.hintText, { color: theme.color }]}>المس الخريطة لتحديد النقطة أو اسحب الدبوس</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: "hidden", width: "100%" },
  hint: { alignSelf: "center", borderRadius: 20, bottom: 10, paddingHorizontal: 12, paddingVertical: 7, position: "absolute" },
  hintText: { ...typography.caption, textAlign: "center" },
  loadHint: { alignItems: "center", alignSelf: "center", borderRadius: 12, flexDirection: "row", gap: spacing[2], padding: spacing[2], position: "absolute", top: spacing[2] },
  stateText: { ...typography.bodySm, textAlign: "center" },
  unavailable: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", gap: spacing[3], justifyContent: "center", padding: spacing[4] },
});
