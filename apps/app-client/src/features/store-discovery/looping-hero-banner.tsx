import { radius, spacing } from "@bthwani/design-system";
import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { AccessibilityInfo, Animated, AppState, Easing, Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { wrapBannerIndex } from "./banner-loop";
import { recordDiscoveryImpression } from "./discovery-analytics";
import type { BannerPresentation } from "./store-discovery-client";

type Direction = 1 | -1;
type Transition = Readonly<{ index: number; direction: Direction }>;

// Public demo slides have different base hues. The palette must follow the
// slide artwork, never the carousel position, so the top header and media agree.
function immersiveSlidePalette(item: PublicDiscoveryContentView): readonly [string, string, string] {
  if (item.titleAr.includes("مقاضي")) return ["#195A54", "#297A73", "#56A59A"];
  if (item.titleAr.includes("متاجر")) return ["#132E50", "#1A4068", "#4078A4"];
  return ["#A94316", "#CB6131", "#EFAD86"];
}


/** Native-driver images, independent of Android RTL ScrollView offsets. */
export function LoopingHeroBanner({
  cardWidth, items, onOpen, label, screenActive, presentation, immersiveHeader,
}: {
  cardWidth: number;
  items: ReadonlyArray<PublicDiscoveryContentView>;
  onOpen: (item: PublicDiscoveryContentView) => void;
  label: string;
  screenActive: boolean;
  presentation: BannerPresentation;
  immersiveHeader?: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const currentIndex = useRef(0);
  const [transition, setTransition] = useState<Transition | null>(null);
  const animated = useRef(new Animated.Value(0)).current;
  const inTransition = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failedMedia, setFailedMedia] = useState<ReadonlySet<string>>(() => new Set());
  const [loadedMedia, setLoadedMedia] = useState<ReadonlySet<string>>(() => new Set());
  const navigateRef = useRef<(direction: Direction) => void>(() => {});
  const openRef = useRef<() => void>(() => {});
  // Keep the complete top stage in the same animated slide, with interactive
  // controls over it; the delivery/campaign strip remains a separate sibling.
  const immersive = Boolean(immersiveHeader);
  // A full-width home stage is square: branding, search, media and dots all fit inside 1:1.
  const height = immersive ? cardWidth : Math.round(cardWidth / 1.75);
  // The current published artwork is landscape. Preserve its aspect ratio in
  // the lower part of the square instead of stretching or cropping its copy.
  const mediaHeight = immersive ? Math.round(cardWidth / 1.75) : height;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    const app = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => {
      mounted = false;
      motion.remove();
      app.remove();
      animated.stopAnimation();
    };
  }, [animated]);

  useEffect(() => {
    const safe = Math.min(currentIndex.current, Math.max(items.length - 1, 0));
    currentIndex.current = safe;
    setIndex(safe);
  }, [items.length]);

  const activeItem = items[index];
  const activeMediaKey = activeItem ? activeItem.id + ":" + activeItem.mediaUri : "";
  // Count a view only after the image is loaded and remains visible in the
  // foreground for one second. Each completed carousel exposure may count.
  useEffect(() => {
    if (!activeItem || !screenActive || !foreground || interacting || transition
      || failedMedia.has(activeMediaKey) || !loadedMedia.has(activeMediaKey)) return;
    const contentID = activeItem.id;
    const timer = setTimeout(() => { void recordDiscoveryImpression(contentID); }, 1000);
    return () => clearTimeout(timer);
  }, [activeItem, activeMediaKey, screenActive, foreground, interacting, transition, failedMedia, loadedMedia]);

  const moveTo = useCallback((next: number, direction: Direction) => {
    if (items.length < 2 || inTransition.current || next === currentIndex.current) return;
    if (reducedMotion) {
      currentIndex.current = next;
      setIndex(next);
      return;
    }
    inTransition.current = true;
    setTransition({ index: next, direction });
    animated.setValue(0);
    Animated.timing(animated, {
      toValue: 1,
      duration: 550,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        currentIndex.current = next;
        setIndex(next);
      }
      requestAnimationFrame(() => {
        animated.setValue(0);
        setTransition(null);
        inTransition.current = false;
      });
    });
  }, [animated, items.length, reducedMotion]);
  const navigate = useCallback((direction: Direction) => {
    moveTo(wrapBannerIndex(currentIndex.current, direction, items.length), direction);
  }, [moveTo, items.length]);

  navigateRef.current = navigate;
  openRef.current = () => {
    const item = items[currentIndex.current];
    if (item && !inTransition.current) onOpen(item);
  };

  const completeSwipe = useCallback((deltaX: number) => {
    if (Math.abs(deltaX) > 30) navigateRef.current(deltaX < 0 ? 1 : -1);
  }, []);
  // Native gesture recognition lets vertical product scrolling win against horizontal banner swipes.
  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-24, 24])
    .onStart(() => { runOnJS(setInteracting)(true); })
    .onEnd((event) => { runOnJS(completeSwipe)(event.translationX); })
    .onFinalize(() => { runOnJS(setInteracting)(false); }), [completeSwipe]);

  // The timer does not depend on the index and survives the last-to-first wrap.
  useEffect(() => {
    if (!screenActive || !foreground || interacting || reducedMotion || presentation.mode === "STATIC" || items.length < 2) return;
    const timer = setInterval(() => navigateRef.current(1), presentation.intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [screenActive, foreground, interacting, reducedMotion, presentation.mode, presentation.intervalSeconds, items.length]);

  const slide = (item: PublicDiscoveryContentView, style: object, key: string) => {
    const colors = immersiveSlidePalette(item);
    return <Animated.View key={key} pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, width: cardWidth, height }, style]}>
      {immersive ? <LinearGradient colors={colors} locations={[0, (height - mediaHeight) / height, 1]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} /> : null}
      {failedMedia.has(item.id + ":" + item.mediaUri)
        ? <View style={{ flex: 1, justifyContent: "center", backgroundColor: immersive ? "transparent" : "#192335", padding: spacing[3], marginTop: immersive ? height - mediaHeight : 0 }}><Text style={{ color: "#FFFFFF", textAlign: "center" }}>{item.titleAr}</Text></View>
        : <ExpoImage cachePolicy="disk" source={{ uri: item.mediaUri }} contentFit="contain"
          onLoad={() => setLoadedMedia((current) => {
            const key = item.id + ":" + item.mediaUri;
            return current.has(key) ? current : new Set(current).add(key);
          })}
          onError={() => setFailedMedia((current) => new Set(current).add(item.id + ":" + item.mediaUri))}
          style={{ position: immersive ? "absolute" : "relative", bottom: immersive ? 0 : undefined, width: "100%", height: mediaHeight }} />}
      {immersive ? <LinearGradient pointerEvents="none" colors={[colors[1], colors[1] + "00"]} style={{ position: "absolute", top: height - mediaHeight, left: 0, right: 0, height: 28 }} /> : null}
    </Animated.View>;
  };

  if (!activeItem) return null;
  const incoming = transition ? items[transition.index] : undefined;
  const fading = presentation.mode === "CROSSFADE";
  const currentStyle = transition
    ? fading
      ? { opacity: animated.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }
      : { transform: [{ translateX: animated.interpolate({ inputRange: [0, 1], outputRange: [0, -transition.direction * cardWidth] }) }] }
    : {};
  const nextStyle = transition
    ? fading
      ? { opacity: animated }
      : { transform: [{ translateX: animated.interpolate({ inputRange: [0, 1], outputRange: [transition.direction * cardWidth, 0] }) }] }
    : {};

  return <GestureHandlerRootView style={{ marginHorizontal: immersive ? 0 : -spacing[1], width: cardWidth, height }}>
    <GestureDetector gesture={panGesture}><View
      accessibilityLabel={label + "، " + activeItem.titleAr + "، " + (index + 1) + " من " + items.length}
      style={{ width: cardWidth, height, borderRadius: immersive ? 0 : radius.lg, overflow: "hidden", backgroundColor: "#101827" }}
    >
    {slide(activeItem, currentStyle, activeItem.id)}
    {incoming ? slide(incoming, nextStyle, "incoming-" + incoming.id) : null}
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={"عرض " + activeItem.titleAr}
      onPress={() => openRef.current()}
      style={{ position: "absolute", top: immersive ? height - mediaHeight : 0, left: 0, right: 0, bottom: 0 }}
    />
    {items.length > 1 ? <View accessibilityLabel="مؤشرات البنر" style={{ position: "absolute", bottom: spacing[2], left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 4, pointerEvents: "box-none" }}>
      {items.map((item, dotIndex) => <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`انتقل إلى البنر ${dotIndex + 1} من ${items.length}`}
        accessibilityState={{ selected: dotIndex === index }}
        hitSlop={8}
        onPress={() => moveTo(dotIndex, dotIndex > currentIndex.current ? 1 : -1)}
        style={{ width: dotIndex === index ? 24 : 8, height: 8, borderRadius: radius.round, backgroundColor: dotIndex === index ? "#FFFFFF" : "#FFFFFF99" }}
      />)}
    </View> : null}
    {immersiveHeader ? <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 }} pointerEvents="box-none">{immersiveHeader}</View> : null}
    </View></GestureDetector>
  </GestureHandlerRootView>;
}
