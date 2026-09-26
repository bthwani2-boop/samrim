import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { type MapPressEvent, Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

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
}>;

const fallbackCoordinate = { latitude: 15.3694, longitude: 44.191 };

function initialRegion(markers: ReadonlyArray<BthwaniMapMarker>, selection?: BthwaniMapCoordinate | null): Region {
  const coordinates = [...markers.map((marker) => marker.coordinate), ...(selection ? [selection] : [])];
  if (coordinates.length === 0) coordinates.push(fallbackCoordinate);
  const latitude = coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length;
  const longitude = coordinates.reduce((sum, point) => sum + point.longitude, 0) / coordinates.length;
  const latitudeSpan = coordinates.length < 2 ? 0.035 : Math.max(0.025, (Math.max(...coordinates.map((point) => point.latitude)) - Math.min(...coordinates.map((point) => point.latitude))) * 1.8);
  const longitudeSpan = coordinates.length < 2 ? 0.035 : Math.max(0.025, (Math.max(...coordinates.map((point) => point.longitude)) - Math.min(...coordinates.map((point) => point.longitude))) * 1.8);
  return { latitude, longitude, latitudeDelta: latitudeSpan, longitudeDelta: longitudeSpan };
}

export function BthwaniMap({ accessibilityLabel, markers = [], selection, selectionTitle = "الموقع المحدد", onSelectCoordinate, height = 220 }: BthwaniMapProps) {
  const map = useRef<MapView>(null);
  const selectionLatitude = selection?.latitude;
  const selectionLongitude = selection?.longitude;
  useEffect(() => {
    if (selectionLatitude === undefined || selectionLongitude === undefined) return;
    map.current?.animateToRegion({ latitude: selectionLatitude, longitude: selectionLongitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 300);
  }, [selectionLatitude, selectionLongitude]);

  function selectMapPoint(event: MapPressEvent) {
    onSelectCoordinate?.(event.nativeEvent.coordinate);
  }

  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.frame, { height }]}>
      <MapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion(markers, selection)}
        {...(onSelectCoordinate ? { onPress: selectMapPoint } : {})}
        style={StyleSheet.absoluteFill}
      >
        {markers.map((marker) => (
          <Marker key={marker.id} coordinate={marker.coordinate} title={marker.title} {...(marker.description ? { description: marker.description } : {})} />
        ))}
        {selection ? <Marker coordinate={selection} title={selectionTitle} draggable={Boolean(onSelectCoordinate)} {...(onSelectCoordinate ? { onDragEnd: (event) => onSelectCoordinate(event.nativeEvent.coordinate) } : {})} /> : null}
      </MapView>
      {onSelectCoordinate ? <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>المس الخريطة لتحديد النقطة أو اسحب الدبوس</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: "hidden", width: "100%" },
  hint: { alignSelf: "center", backgroundColor: "#FFFFFFE8", borderRadius: 20, bottom: 10, paddingHorizontal: 12, paddingVertical: 7, position: "absolute" },
  hintText: { color: "#202124", fontSize: 12, textAlign: "center" },
});
