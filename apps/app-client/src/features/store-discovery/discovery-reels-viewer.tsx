import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { AppState, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reelDestinationLabel } from "./discovery-reel-destination";

type Reel = PublicDiscoveryContentView;
type ReelResume = { id: string; seconds: number } | null;

// The reel is a video, not a product sheet: one destination CTA, no prices or cart.
function ReelSlide({ item, active, height, width, resumeSeconds, onOpen }: {
  item: Reel;
  active: boolean;
  height: number;
  width: number;
  resumeSeconds: number;
  onOpen: (item: Reel, seconds: number) => void;
}) {
  const player = useVideoPlayer({ uri: item.mediaUri, useCaching: true }, created => {
    created.loop = true;
  });
  useEffect(() => {
    if (!active) { player.pause(); return; }
    if (Number.isFinite(resumeSeconds) && resumeSeconds > 0) {
      player.currentTime = resumeSeconds;
    }
    player.play();
    // The Expo hook owns native player disposal; do not pause a released player
    // in effect cleanup (Android crashes when the native view is destroyed).
  }, [active, player, resumeSeconds]);
  const cta = reelDestinationLabel(item.targetType);
  return (
    <View style={[styles.slide, { height, width }]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />
      <View style={styles.bottom}>
        <Text style={styles.title} numberOfLines={2}>{item.titleAr}</Text>
        {item.bodyAr ? <Text style={styles.body} numberOfLines={2}>{item.bodyAr}</Text> : null}
        {cta ? (
          <Pressable accessibilityRole="button" accessibilityLabel={cta} style={styles.cta} onPress={() => onOpen(item, player.currentTime)}>
            <Text style={styles.ctaText}>{cta}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function DiscoveryReelsViewer({ items, visible, initialIndex, resume, onClose, onOpen, onShare, onIndexChange }: {
  items: ReadonlyArray<Reel>;
  visible: boolean;
  initialIndex: number;
  resume: ReelResume;
  onClose: () => void;
  onOpen: (item: Reel, seconds: number) => void;
  onShare: (item: Reel) => void;
  onIndexChange: (index: number) => void;
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
  const activeItem = items[index] ?? items[safeIndex];
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
            const next = Math.max(0, Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.y / height)));
            setIndex(next);
            onIndexChange(next);
          }}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item, index: position }) => (
            <ReelSlide
              item={item}
              active={foreground && index === position}
              height={height}
              width={width}
              resumeSeconds={resume?.id === item.id ? resume.seconds : 0}
              onOpen={onOpen}
            />
          )}
        />
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 12 }]}>
          <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="إغلاق الريلز" onPress={onClose}>
            <Text style={styles.actionText}>✕</Text>
          </Pressable>
          <Text style={styles.heading}>شاهد واطلب</Text>
          {activeItem ? (
            <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="مشاركة الفيديو" onPress={() => onShare(activeItem)}>
              <Text style={styles.actionText}>↗</Text>
            </Pressable>
          ) : null}
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
  action: { height: 44, width: 44, borderRadius: 22, backgroundColor: "#0009", alignItems: "center", justifyContent: "center" },
  actionText: { color: "#fff", fontSize: 20 },
  counter: { position: "absolute", color: "#fff", left: 22, fontSize: 12 },
  bottom: { position: "absolute", bottom: 36, left: 18, right: 18, alignItems: "flex-end", gap: 10, padding: 12, backgroundColor: "#0006", borderRadius: 16 },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "right" },
  body: { color: "#eee", fontSize: 14, textAlign: "right" },
  cta: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: "#fff", borderRadius: 14, alignSelf: "stretch", alignItems: "center" },
  ctaText: { color: "#13151b", fontWeight: "700", fontSize: 15 },
});
