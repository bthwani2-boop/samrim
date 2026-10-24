import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMobileAppearance } from "./appearance";
import { BthwaniIcon } from "./icons";

/** Lightweight voice-note bubble; playback and private media remain owned by the calling app. */
type Props = Readonly<{
  mine: boolean;
  sender: string;
  sentAt: string;
  read: boolean;
  playing: boolean;
  loading: boolean;
  positionSeconds: number;
  durationSeconds: number;
  onPlayPause: () => void;
  onSeek: (progress: number) => void;
  error?: string;
}>;

const bars = ([11, 19, 28, 35, 26, 17, 30, 38, 22, 13, 34, 27, 18, 39, 30, 23, 17, 32, 37, 25, 15, 28, 40, 34, 22, 14, 31, 36, 24, 18, 33, 26, 14, 30, 38, 23] as const)
  .map((height, index) => ({ id: `wave-${index}`, height }));

export function BthwaniOrderChatAudioBubble({
  mine, sender, sentAt, read, playing, loading,
  positionSeconds, durationSeconds, onPlayPause, onSeek, error,
}: Props) {
  const { themeName } = useMobileAppearance();
  const dark = themeName === "dark";
  const [waveWidth, setWaveWidth] = useState(1);
  const background = mine ? (dark ? "#583B33" : "#FFF0E6") : (dark ? "#263038" : "#F5F7F8");
  const foreground = dark ? "#F9F2EE" : "#27394D";
  const secondary = dark ? "#CEB2A4" : "#9D918E";
  const waveform = dark ? "#F9A379" : "#EF7549";
  const elapsed = playing ? positionSeconds : durationSeconds;
  const progress = durationSeconds > 0 ? Math.max(0, Math.min(1, positionSeconds / durationSeconds)) : 0;
  const clock = Number.isFinite(Date.parse(sentAt))
    ? new Intl.DateTimeFormat("ar-YE", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Aden"}).format(new Date(sentAt))
    : "";

  return <View style={[styles.bubble, {backgroundColor: background}]} accessibilityLabel={`رسالة صوتية من ${sender}`}>
    <View style={styles.main}>
      <View style={[styles.avatar, {backgroundColor: dark ? "#715045" : "#FFD6C1"}]}>
        <BthwaniIcon name="account" size={27} color={foreground}/>
        <View style={[styles.avatarMic, {backgroundColor: background}]}>
          <BthwaniIcon name="mic" size={13} color={secondary}/>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={loading ? "جارٍ تحميل الصوت" : playing ? "إيقاف الصوت مؤقتًا" : "تشغيل الصوت"}
        accessibilityState={{disabled: loading, busy: loading}}
        disabled={loading}
        onPress={onPlayPause}
        style={styles.play}>
        <BthwaniIcon name={playing ? "pause" : "play"} size={31} color={foreground}/>
      </Pressable>
      <View style={styles.track}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="الانتقال داخل الرسالة الصوتية"
          accessibilityHint="اضغط في موضع من الموجة للانتقال إليه بعد تحميل التسجيل"
          style={styles.waveTouch}
          onLayout={event => setWaveWidth(event.nativeEvent.layout.width)}
          onPress={event => onSeek(Math.max(0, Math.min(1, event.nativeEvent.locationX / waveWidth)))}>
          <View style={styles.bars} pointerEvents="none">
            {bars.map((bar, index) => <View key={bar.id} style={[
              styles.bar,
              {height: bar.height * 0.72, backgroundColor: index / bars.length <= progress ? waveform : secondary},
            ]}/>)}
          </View>
          <View pointerEvents="none" style={[styles.progressDot, {
            backgroundColor: waveform, left: `${Math.min(98, progress * 98)}%`,
          }]}/>
        </Pressable>
        <View style={styles.meta}>
          <Text style={[styles.duration, {color: secondary}]}>{formatDuration(elapsed)}</Text>
          <View style={styles.metaRight}>
            <Text style={[styles.time, {color: secondary}]}>{clock}</Text>
            {mine ? <Text style={[styles.check, {color: read ? "#34A4CF" : secondary}]}>{read ? "✓✓" : "✓"}</Text> : null}
          </View>
        </View>
      </View>
    </View>
    {error ? <Text accessibilityRole="alert" style={[styles.error, {color: dark ? "#FFD5B5" : "#A22D20"}]}>{error}</Text> : null}
  </View>;
}

function formatDuration(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  bubble: { width: "100%", minWidth: 232, maxWidth: 320, borderRadius: 15, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 7 },
  main: { flexDirection: "row", gap: 6, alignItems: "center" },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", position: "relative" },
  avatarMic: {position: "absolute", bottom: -2, right: -2, borderRadius: 10, padding: 2 },
  play: {width: 38, height: 45, alignItems: "center", justifyContent: "center"},
  track: {flex: 1, minWidth: 0, gap: 2},
  waveTouch: {height: 38, justifyContent: "center", overflow: "hidden"},
  bars: {flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 1},
  bar: {width: 2.5, borderRadius: 3, flexShrink: 1},
  progressDot: {width: 8, height: 8, borderRadius: 4, position: "absolute", top: 15},
  meta: {flexDirection: "row", justifyContent: "space-between", alignItems: "center"},
  duration: {fontSize: 11, fontVariant: ["tabular-nums"]},
  metaRight: {flexDirection: "row", alignItems: "center", gap: 4},
  time: {fontSize: 10},
  check: {fontSize: 13, fontWeight: "700"},
  error: {fontSize: 11, marginTop: 4},
});
