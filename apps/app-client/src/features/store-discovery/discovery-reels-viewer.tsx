import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reelDestinationLabel } from "./discovery-reel-destination";

type Reel = PublicDiscoveryContentView;
type ReelResume = { id: string; seconds: number } | null;

// Reels only describe and link to their destination. The Store owns product details,
// prices, variants, cart and checkout; do not reimplement commerce in the video.
function ReelSlide({ item, active, height, width, bottomInset, resumeSeconds, muted, onToggleSound, onOpen }: {
  item: Reel;
  active: boolean;
  height: number;
  width: number;
  bottomInset: number;
  resumeSeconds: number;
  muted: boolean;
  onToggleSound: () => void;
  onOpen: (item: Reel, seconds: number) => void;
}) {
  const player = useVideoPlayer({ uri: item.mediaUri, useCaching: true }, created => {
    created.loop = true;
    created.muted = true;
  });
  const [status, setStatus] = useState(player.status);
  const [started, setStarted] = useState(false);
  const [held, setHeld] = useState(false);
  const holding = useRef(false);

  useEffect(() => {
    const statusSubscription = player.addListener("statusChange", event => setStatus(event.status));
    const playSubscription = player.addListener("playingChange", event => {
      if (event.isPlaying) setStarted(true);
    });
    return () => {
      statusSubscription.remove();
      playSubscription.remove();
    };
  }, [player]);

  useEffect(() => { player.muted = muted; }, [muted, player]);
  useEffect(() => {
    if (!active) { player.pause(); return; }
    if (Number.isFinite(resumeSeconds) && resumeSeconds > 0) {
      player.currentTime = resumeSeconds;
    }
    player.play();
    // useVideoPlayer manages disposal; pausing a disposed Android player in
    // effect cleanup can crash the native view.
  }, [active, player, resumeSeconds]);

  const cta = reelDestinationLabel(item.targetType);
  const failed = status === "error";
  const showPoster = !started || failed;

  return (
    <View style={[styles.slide, { height, width }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
      />
      {showPoster ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {item.posterUri ? (
            <ExpoImage source={{ uri: item.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : <View style={styles.posterFallback} />}
          {!failed ? <ActivityIndicator style={styles.loading} color="#ffffff" size="small" /> : (
            <View style={styles.errorPanel}>
              <Text style={styles.errorText} accessibilityRole="alert">تعذر تشغيل الفيديو</Text>
              <Text style={styles.errorHint}>اسحب لمشاهدة الفيديو التالي</Text>
            </View>
          )}
        </View>
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="button"
        accessibilityLabel="اضغط مطولًا لإيقاف الفيديو مؤقتًا"
        onLongPress={() => {
          if (!active || failed) return;
          holding.current = true;
          setHeld(true);
          player.pause();
        }}
        onPressOut={() => {
          if (!holding.current) return;
          holding.current = false;
          setHeld(false);
          if (active) player.play();
        }}
      />

      <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0)"]} style={styles.topShade} />
      <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.88)"]} style={styles.bottomShade} />
      {held ? <View pointerEvents="none" style={styles.pauseHint}><Text style={styles.pauseText}>Ⅱ</Text></View> : null}
      <View style={[styles.bottom, { bottom: bottomInset + 16 }]}>
        <View style={styles.descriptionHead}>
          <Pressable
            style={styles.soundAction}
            accessibilityRole="button"
            accessibilityLabel={muted ? "تشغيل صوت الفيديو" : "كتم صوت الفيديو"}
            onPress={onToggleSound}
          >
            <Text style={styles.soundText}>{muted ? "♪̸" : "♫"}</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={2}>{item.titleAr}</Text>
        </View>
        {item.bodyAr ? <Text style={styles.body} numberOfLines={2}>{item.bodyAr}</Text> : null}
        {cta ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cta}
            style={styles.destination}
            onPress={() => onOpen(item, player.currentTime)}
          >
            <View style={styles.destinationArrow}><Text style={styles.destinationArrowText}>←</Text></View>
            <View style={styles.destinationCopy}>
              <Text style={styles.destinationEyebrow}>من الفيديو مباشرة</Text>
              <Text style={styles.destinationText}>{cta}</Text>
            </View>
            {item.posterUri ? (
              <ExpoImage source={{ uri: item.posterUri }} style={styles.destinationThumbnail} contentFit="cover" cachePolicy="memory-disk" />
            ) : <View style={styles.destinationThumbnailFallback}><Text style={styles.destinationThumbnailSymbol}>▶</Text></View>}
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
  const [muted, setMuted] = useState(true);
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
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item, index: position }) => (
            <ReelSlide
              item={item}
              active={foreground && index === position}
              height={height}
              width={width}
              bottomInset={insets.bottom}
              muted={muted}
              onToggleSound={() => setMuted(current => !current)}
              resumeSeconds={resume?.id === item.id ? resume.seconds : 0}
              onOpen={onOpen}
            />
          )}
        />
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 10 }]}>
          <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="إغلاق الريلز" onPress={onClose}>
            <Text style={styles.actionText}>×</Text>
          </Pressable>
          <Text style={styles.heading}>شاهد واطلب</Text>
          {activeItem ? (
            <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="مشاركة الفيديو" onPress={() => onShare(activeItem)}>
              <Text style={styles.shareText}>↗</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#090b0e" },
  slide: { backgroundColor: "#10151b" },
  posterFallback: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#10151b" },
  loading: { position: "absolute", top: "49%", alignSelf: "center" },
  errorPanel: { position: "absolute", alignSelf: "center", top: "45%", alignItems: "center", gap: 8 },
  errorText: { fontSize: 16, color: "#fff", fontWeight: "700" },
  errorHint: { fontSize: 13, color: "#ffffffbb" },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 175 },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0, height: 360 },
  top: { position: "absolute", left: 16, right: 16, top: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { color: "#fff", fontSize: 15, fontWeight: "700", textShadowColor: "#0009", textShadowRadius: 5 },
  action: { height: 42, width: 42, borderRadius: 21, backgroundColor: "#0b1117a8", alignItems: "center", justifyContent: "center" },
  actionText: { color: "#fff", fontSize: 27, lineHeight: 30 },
  shareText: { color: "#fff", fontSize: 22 },
  pauseHint: { position: "absolute", top: "45%", alignSelf: "center", width: 62, height: 62, borderRadius: 31, backgroundColor: "#0008", alignItems: "center", justifyContent: "center" },
  pauseText: { color: "#fff", fontSize: 32 },
  bottom: { position: "absolute", left: 18, right: 18, gap: 9, alignItems: "stretch" },
  descriptionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "right", flex: 1, textShadowColor: "#0009", textShadowRadius: 5 },
  body: { color: "#f3f5f7", fontSize: 14, lineHeight: 21, textAlign: "right", textShadowColor: "#0009", textShadowRadius: 4 },
  soundAction: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#111a23bb", alignItems: "center", justifyContent: "center" },
  soundText: { color: "#fff", fontSize: 23 },
  destination: { minHeight: 76, padding: 9, borderRadius: 19, backgroundColor: "#14202bd9", borderWidth: 1, borderColor: "#ffffff26", flexDirection: "row", gap: 11, alignItems: "center" },
  destinationArrow: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  destinationArrowText: { fontSize: 24, color: "#101923", fontWeight: "700" },
  destinationCopy: { flex: 1, gap: 3, alignItems: "flex-end" },
  destinationEyebrow: { fontSize: 11, color: "#cad1d9" },
  destinationText: { color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "right" },
  destinationThumbnail: { width: 58, height: 58, borderRadius: 12 },
  destinationThumbnailFallback: { width: 58, height: 58, borderRadius: 12, backgroundColor: "#34414d", alignItems: "center", justifyContent: "center" },
  destinationThumbnailSymbol: { fontSize: 23, color: "#fff" },
});
