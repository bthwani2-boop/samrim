import type { PublicDiscoveryContentView } from "@bthwani/dsh";
import { Image } from "expo-image";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { recordDiscoveryImpression } from "./discovery-analytics";

type HomeReelsEntryProps = {
  first: PublicDiscoveryContentView;
  count: number;
  onOpen: () => void;
};

/**
 * One Home entry for the entire reel feed. Only a cached JPEG poster is
 * rendered on Home; MP4 decoding begins after the user opens the viewer.
 */
export function HomeReelsEntry({ first, count, onOpen }: HomeReelsEntryProps) {
  useEffect(() => {
    void recordDiscoveryImpression(first.id);
  }, [first.id]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="شاهد واطلب"
      accessibilityHint="افتح الفيديوهات وتصفحها بالسحب للأعلى والأسفل"
      onPress={onOpen}
      style={styles.card}
    >
      {first.posterUri ? (
        <Image
          source={{ uri: first.posterUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View pointerEvents="none" style={styles.scrim} />
      <View pointerEvents="none" style={styles.content}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{count > 1 ? `${count} فيديوهات` : "فيديو واحد"}</Text>
          <Text style={styles.title} numberOfLines={1}>{first.titleAr}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>اضغط للمشاهدة واسحب للتنقل</Text>
        </View>
        <View style={styles.play}>
          <Text style={styles.playText}>▶</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    height: 156,
    backgroundColor: "#131D33",
    borderRadius: 18,
    overflow: "hidden",
    marginTop: 4,
    marginBottom: 4,
  },
  scrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#07112690",
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    gap: 16,
  },
  copy: { flex: 1, alignItems: "flex-end", gap: 5 },
  eyebrow: { color: "#E8EDF9", fontSize: 12, fontWeight: "600" },
  title: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", textAlign: "right" },
  subtitle: { color: "#F0F2F8", fontSize: 12, textAlign: "right" },
  play: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  playText: { fontSize: 21, color: "#101827", marginLeft: 3 },
});
