import { radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { recordDiscoveryClick, recordDiscoveryImpression } from "./discovery-analytics";

function displayableStoreBanners(contents: ReadonlyArray<PublicDiscoveryContentView>): ReadonlyArray<PublicDiscoveryContentView> {
  return contents.filter((content) => content.kind === "BANNER" && content.mediaKind === "image" && Boolean(content.mediaUri));
}

/** Store-scoped DSH banners only. Publication and read/retry ownership stay with the Store screen. */
export function StoreBannerCarousel({ contents }: { contents: ReadonlyArray<PublicDiscoveryContentView> }) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width: windowWidth } = useWindowDimensions();
  const items = displayableStoreBanners(contents);
  const bannerStep = Math.max(1, windowWidth - spacing[3] * 2);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerPaused, setBannerPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const bannerRef = useRef<ScrollViewInstance | null>(null);
  const visibleContentID = items[bannerIndex]?.id ?? "";

  useEffect(() => {
    if (bannerIndex >= items.length) setBannerIndex(0);
    if (visibleContentID) void recordDiscoveryImpression(visibleContentID);
  }, [bannerIndex, items.length, visibleContentID]);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReduceMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (bannerPaused || reduceMotion || items.length < 2) return;
    const timer = setInterval(() => {
      setBannerIndex((current) => {
        const next = (current + 1) % items.length;
        bannerRef.current?.scrollTo({ x: (Platform.OS === "web" ? -1 : 1) * next * bannerStep, animated: true });
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [bannerStep, bannerPaused, items.length, reduceMotion]);

  if (!items.length) return null;

  return <View accessibilityLabel="بنرات المتجر" style={styles.bannerBlock}>
    <ScrollView
      ref={bannerRef}
      horizontal
      snapToInterval={bannerStep}
      decelerationRate="fast"
      onTouchStart={() => setBannerPaused(true)}
      onTouchEnd={() => setBannerPaused(false)}
      onMomentumScrollEnd={(event) => {
        setBannerIndex(Math.max(0, Math.min(items.length - 1, Math.round(Math.abs(event.nativeEvent.contentOffset.x) / bannerStep))));
        setBannerPaused(false);
      }}
      showsHorizontalScrollIndicator={false}
    >
      {items.map((content) => <Pressable
        key={content.id}
        accessibilityRole="button"
        accessibilityLabel={`عرض بنر المتجر: ${content.titleAr}`}
        onPress={() => {
          void recordDiscoveryClick(content.id);
          router.push((`/discovery-content/${encodeURIComponent(content.id)}`) as Href);
        }}
        style={[styles.storeBannerSlide, { width: bannerStep }]}
      >
        <ExpoImage cachePolicy="disk" accessibilityLabel={`صورة بنر ${content.titleAr}`} source={{ uri: content.mediaUri }} contentFit="cover" style={styles.storeBannerImage} />
        <View style={styles.storeBannerCaption}>
          <Text style={styles.storeBannerTitle} numberOfLines={2}>{content.titleAr}</Text>
          {content.bodyAr ? <Text style={styles.storeBannerSubtitle} numberOfLines={1}>{content.bodyAr}</Text> : null}
        </View>
      </Pressable>)}
    </ScrollView>
    {items.length > 1 ? <View style={styles.storeBannerPagination} accessibilityLabel="مؤشر بنرات المتجر">
      {items.map((item, index) => <View key={item.id} style={[styles.storeBannerDot, index === bannerIndex && styles.storeBannerDotActive]} />)}
    </View> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    bannerBlock: { gap: spacing[1], marginTop: spacing[1] },
    storeBannerSlide: { borderRadius: radius.lg, marginHorizontal: 0, overflow: "hidden", position: "relative", backgroundColor: theme.surfaceInset },
    storeBannerImage: { width: "100%", height: 174 },
    storeBannerCaption: { backgroundColor: "rgba(0,0,0,0.68)", paddingHorizontal: spacing[3], paddingVertical: spacing[2], minHeight: 44, justifyContent: "center" },
    storeBannerTitle: { ...typography.bodyStrong, color: "#FFFFFF", textAlign: "right" },
    storeBannerSubtitle: { ...typography.caption, color: "#FFFFFF", textAlign: "right" },
    storeBannerPagination: { flexDirection: "row", alignSelf: "center", gap: spacing[1], alignItems: "center" },
    storeBannerDot: { width: 6, height: 6, borderRadius: radius.round, backgroundColor: theme.borderColorStrong },
    storeBannerDotActive: { width: 18, height: 6, borderRadius: radius.round, backgroundColor: theme.interactiveText },
  });
}
