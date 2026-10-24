import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { AppState, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Reel = PublicDiscoveryContentView;

// Only the visible video plays; off-screen videos are paused, and playback
// stops when the app enters the background or the viewer is dismissed.
function ReelSlide({ item, active, height, width, onOpen }: {
  item: Reel;
  active: boolean;
  height: number;
  width: number;
  onOpen: (item: Reel) => void;
}) {
  const player = useVideoPlayer({ uri: item.mediaUri, useCaching: true }, (created) => {
    created.loop = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
    return () => player.pause();
  }, [active, player]);
  const cta = item.targetType === "PRODUCT" ? "عرض المنتج" :
    item.targetType === "STORE" ? "تصفح المتجر" :
    item.targetType === "PROMOTION" ? "اكتشف العرض" :
    item.targetType === "CATEGORY" ? "استكشف القسم" :
    "تعرف على المزيد";
  return (
    <View style={[styles.slide, { height, width }]}>
      <VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} surfaceType="textureView" />
      <View style={styles.bottom}>
        <Text style={styles.title} numberOfLines={2}>{item.titleAr}</Text>
        {item.bodyAr ? <Text style={styles.body} numberOfLines={3}>{item.bodyAr}</Text> : null}
        {item.targetType !== "INFO" ? (
          <Pressable accessibilityRole="button" accessibilityLabel={cta} style={styles.cta} onPress={() => onOpen(item)}>
            <Text style={styles.ctaText}>{cta}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function DiscoveryReelsViewer({ items, visible, initialIndex, onClose, onOpen }: {
  items: ReadonlyArray<Reel>;
  visible: boolean;
  initialIndex: number;
  onClose: () => void;
  onOpen: (item: Reel) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => { if (visible) setIndex(initialIndex); }, [visible, initialIndex]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);
  if (!visible || items.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(initialIndex, items.length - 1));
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" statusBarTranslucent>
      <View style={styles.root}>
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          pagingEnabled
          initialScrollIndex={safeIndex}
          getItemLayout={(_, position) => ({ length: height, offset: height * position, index: position })}
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          onMomentumScrollEnd={event => {
            const next = Math.round(event.nativeEvent.contentOffset.y / height);
            setIndex(Math.max(0, Math.min(items.length - 1, next)));
          }}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item, index: position }) => (
            <ReelSlide item={item} active={visible && foreground && index === position} height={height} width={width} onOpen={onOpen} />
          )}
        />
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 12 }]}>
          <Pressable style={styles.close} accessibilityRole="button" accessibilityLabel="إغلاق الريلز" onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.heading}>شاهد واطلب</Text>
        </View>
        <Text style={[styles.counter, { top: insets.top + 69 }]}>{index + 1} / {items.length}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#06070a" },
  slide: { backgroundColor: "#06070a" },
  top: { position: "absolute", left: 16, right: 16, top: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { color: "#fff", fontSize: 17, fontWeight: "700" },
  close: { height: 44, width: 44, borderRadius: 22, backgroundColor: "#0009", alignItems: "center", justifyContent: "center" },
  closeText: { color: "#fff", fontSize: 20 },
  counter: { position: "absolute", color: "#fff", left: 22, fontSize: 12 },
  bottom: { position: "absolute", bottom: 36, left: 18, right: 18, alignItems: "flex-end", gap: 10, padding: 12, backgroundColor: "#0006", borderRadius: 16 },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "right" },
  body: { color: "#eee", fontSize: 14, textAlign: "right" },
  cta: { paddingVertical: 12, paddingHorizontal: 20, backgroundColor: "#fff", borderRadius: 14, alignSelf: "stretch", alignItems: "center" },
  ctaText: { color: "#13151b", fontWeight: "700", fontSize: 15 },
});
