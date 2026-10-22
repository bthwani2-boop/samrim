import { radius, spacing } from "@bthwani/design-system";
import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, PanResponder, Pressable, Text, View } from "react-native";
import { recordDiscoveryImpression } from "./discovery-analytics";
import { wrapBannerIndex } from "./banner-loop";
import type { BannerPresentation } from "./store-discovery-client";

type Direction = 1 | -1;
type Transition = Readonly<{ index: number; direction: Direction }>;

/** Native-driver images, independent of Android RTL ScrollView offsets. */
export function LoopingHeroBanner({
  cardWidth, items, onOpen, label, screenActive, presentation,
}: {
  cardWidth: number;
  items: ReadonlyArray<PublicDiscoveryContentView>;
  onOpen: (item: PublicDiscoveryContentView) => void;
  label: string;
  screenActive: boolean;
  presentation: BannerPresentation;
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
  const impressions = useRef(new Set<string>());
  const navigateRef = useRef<(direction: Direction) => void>(() => {});
  const openRef = useRef<() => void>(() => {});
  const height = Math.round(cardWidth / 1.75);

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
  useEffect(() => {
    if (!activeItem || impressions.current.has(activeItem.id)) return;
    impressions.current.add(activeItem.id);
    void recordDiscoveryImpression(activeItem.id);
  }, [activeItem]);

  const navigate = useCallback((direction: Direction) => {
    if (items.length < 2 || inTransition.current) return;
    const next = wrapBannerIndex(currentIndex.current, direction, items.length);
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
      // Keep the arriving image in place until the committed image has rendered.
      requestAnimationFrame(() => {
        animated.setValue(0);
        setTransition(null);
        inTransition.current = false;
      });
    });
  }, [animated, items.length, reducedMotion]);

  navigateRef.current = navigate;
  openRef.current = () => {
    const item = items[currentIndex.current];
    if (item && !inTransition.current) onOpen(item);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
    onPanResponderGrant: () => setInteracting(true),
    onPanResponderRelease: (_, gesture) => {
      setInteracting(false);
      if (Math.abs(gesture.dx) > 30) navigateRef.current(gesture.dx < 0 ? 1 : -1);
    },
    onPanResponderTerminate: () => setInteracting(false),
    onPanResponderTerminationRequest: () => true,
  }), []);

  // The timer does not depend on the index and survives the last-to-first wrap.
  useEffect(() => {
    if (!screenActive || !foreground || interacting || reducedMotion || presentation.mode === "STATIC" || items.length < 2) return;
    const timer = setInterval(() => navigateRef.current(1), presentation.intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [screenActive, foreground, interacting, reducedMotion, presentation.mode, presentation.intervalSeconds, items.length]);

  const slide = (item: PublicDiscoveryContentView, style: object, key: string) => (
    <Animated.View key={key} pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, width: cardWidth, height }, style]}>
      {failedMedia.has(item.id)
        ? <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#192335", padding: spacing[3] }}><Text style={{ color: "#FFFFFF", textAlign: "center" }}>{item.titleAr}</Text></View>
        : <Image source={{ uri: item.mediaUri }} resizeMode="cover" onError={() => setFailedMedia((current) => new Set(current).add(item.id))} style={{ width: "100%", height: "100%" }} />}
    </Animated.View>
  );

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

  return <View
    accessibilityLabel={label + "، " + activeItem.titleAr + "، " + (index + 1) + " من " + items.length}
    style={{ marginHorizontal: -spacing[1], width: cardWidth, height, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#101827" }}
    {...panResponder.panHandlers}
  >
    {slide(activeItem, currentStyle, activeItem.id)}
    {incoming ? slide(incoming, nextStyle, "incoming-" + incoming.id) : null}
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={"عرض " + activeItem.titleAr}
      onPress={() => openRef.current()}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    />
  </View>;
}
