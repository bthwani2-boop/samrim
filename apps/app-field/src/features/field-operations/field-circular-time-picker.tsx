import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useCallback, useMemo, useState } from "react";
import { I18nManager, Modal, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { clockHandAtRadius, formatClockDisplay, formatClockTime, parseClockTime } from "./field-circular-clock";
import { createFieldOperationStyles } from "./field-operation-styles";

const AnimatedClockLabel = Animated.createAnimatedComponent(TextInput);

const SIZE = 248;
const CENTER = SIZE / 2;
const LABEL_RADIUS = 102;
const TWO_PI = Math.PI * 2;
const CLOCK_NUMBERS = Array.from({ length: 12 }, (_, index) => {
  const angle = index * Math.PI / 6 - Math.PI / 2;
  return { number: index || 12, x: CENTER + LABEL_RADIUS * Math.cos(angle), y: CENTER + LABEL_RADIUS * Math.sin(angle) };
});

export function FieldCircularTimePicker({ label, value, onChange, disabled }: Readonly<{
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [visible, setVisible] = useState(false);
  const [displayMinutes, setDisplayMinutes] = useState(9 * 60);
  // Both hands and the day/night dial animate on the UI thread. No JS render
  // or clock-minute snapping participates in the drag.
  const minutes = useSharedValue(9 * 60);
  const activeHand = useSharedValue(0); // 1 = short/hour, 2 = long/minute
  const lastAngle = useSharedValue(0);
  const originalMinute = useSharedValue(0);
  const displayTime = formatClockDisplay(formatClockTime(displayMinutes));
  const isDark = displayMinutes < 390 || displayMinutes > 1170;

  const syncDisplay = useCallback((next: number) => setDisplayMinutes(Math.round(next) % 1440), []);
  const timeProps = useAnimatedProps(() => {
    const m = Math.round(minutes.value) % 1440;
    const h = Math.floor(m / 60);
    const mins = m % 60;
    const visibleTime = `${h % 12 || 12}:${mins < 10 ? "0" : ""}${mins} ${h < 12 ? "صباحًا" : "مساءً"}`;
    return { value: visibleTime };
  });
  const dialStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(minutes.value,
      [0, 360, 420, 1080, 1260, 1440],
      ["#17253d", "#17253d", "#eff6ff", "#eff6ff", "#17253d", "#17253d"]),
  }));
  const hourStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(minutes.value % 720) / 2}deg` }],
  }));
  const minuteStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(minutes.value % 60) * 6}deg` }],
  }));

  const gesture = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      const dx = event.x - CENTER;
      const dy = event.y - CENTER;
      // Large hit areas: inner radius = hour, outer radius = minute.
      activeHand.value = clockHandAtRadius(Math.hypot(dx, dy)) === "hour" ? 1 : 2;
      lastAngle.value = Math.atan2(dy, dx);
      originalMinute.value = Math.round(minutes.value) % 60;
    })
    .onUpdate((event) => {
      const angle = Math.atan2(event.y - CENTER, event.x - CENTER);
      const delta = Math.atan2(Math.sin(angle - lastAngle.value), Math.cos(angle - lastAngle.value));
      minutes.value = ((minutes.value + delta * (activeHand.value === 1 ? 720 : 60) / TWO_PI) % 1440 + 1440) % 1440;
      lastAngle.value = angle;
    })
    .onFinalize(() => {
      if (activeHand.value === 1) {
        minutes.value = ((Math.round((minutes.value - originalMinute.value) / 60) * 60 + originalMinute.value) % 1440 + 1440) % 1440;
      } else {
        minutes.value = Math.round(minutes.value) % 1440;
      }
      activeHand.value = 0;
      scheduleOnRN(syncDisplay, Math.round(minutes.value));
    }), [activeHand, lastAngle, minutes, originalMinute, syncDisplay]);

  function open() {
    const initial = parseClockTime(value);
    minutes.value = initial;
    setDisplayMinutes(initial);
    setVisible(true);
  }

  return <View style={{ flex: 1, minWidth: 112 }}>
    <BthwaniButton disabled={disabled} label={value ? formatClockDisplay(value) : label} onPress={open} variant="secondary" />
    <Modal animationType="fade" transparent visible={visible} onRequestClose={() => setVisible(false)}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 14, backgroundColor: "rgba(0,0,0,0.55)" }}>
          <View accessibilityViewIsModal style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 14, gap: 12, alignItems: "center" }}>
            <Text style={styles.cardTitle}>{label}</Text>
            <AnimatedClockLabel
              accessibilityLabel={`${label}: ${displayTime}`}
              editable={false}
              caretHidden
              defaultValue={displayTime}
              animatedProps={timeProps}
              style={[styles.sectionTitle, { width: "100%", textAlign: "center", fontSize: 25, padding: 0 }]}
            />
            <Text style={styles.muted}>العقرب القصير للساعات · الطويل للدقائق</Text>
            <GestureDetector gesture={gesture}>
              <Animated.View
                accessibilityRole="adjustable"
                accessibilityLabel={`${label}: ${displayTime}`}
                accessibilityHint="اسحب العقرب القصير لضبط الساعة أو الطويل لضبط الدقائق"
                accessibilityActions={[{ name: "increment", label: "زيادة دقيقة" }, { name: "decrement", label: "إنقاص دقيقة" }]}
                onAccessibilityAction={(event) => {
                  const direction = event.nativeEvent.actionName === "increment" ? 1 : -1;
                  const updated = ((Math.round(minutes.value) + direction) % 1440 + 1440) % 1440;
                  minutes.value = updated;
                  setDisplayMinutes(updated);
                }}
                style={[{
                  height: SIZE, width: SIZE, borderRadius: CENTER, overflow: "hidden",
                  borderWidth: 1, borderColor: theme.borderColor, alignSelf: "center",
                }, dialStyle]}
              >
                {CLOCK_NUMBERS.map(({ number, x, y }) => <Text key={number} pointerEvents="none" style={{
                  position: "absolute", left: I18nManager.isRTL ? SIZE - x - 19 : x - 19, top: y - 13,
                  width: 38, height: 27, textAlign: "center", fontSize: 17, fontWeight: "600",
                  color: isDark ? "#ffffff" : "#243247",
                }}>{number}</Text>)}
                <Animated.View pointerEvents="none" style={[{ position: "absolute", width: SIZE, height: SIZE, top: 0, left: 0 }, hourStyle]}>
                  <View style={{ position: "absolute", top: CENTER - 60, left: CENTER - 3.5,
                    width: 7, height: 60, backgroundColor: isDark ? "#cbe2fc" : "#35618a", borderRadius: 5 }} />
                  <View style={{ position: "absolute", top: CENTER - 69, left: CENTER - 10,
                    width: 20, height: 20, backgroundColor: isDark ? "#cbe2fc" : "#35618a", borderRadius: 10 }} />
                </Animated.View>
                <Animated.View pointerEvents="none" style={[{ position: "absolute", width: SIZE, height: SIZE, top: 0, left: 0 }, minuteStyle]}>
                  <View style={{ position: "absolute", top: CENTER - 91, left: CENTER - 2,
                    width: 4, height: 91, borderRadius: 3, backgroundColor: theme.actionBackground }} />
                  <View style={{ position: "absolute", top: CENTER - 101, left: CENTER - 9,
                    width: 18, height: 18, borderRadius: 9, backgroundColor: theme.actionBackground }} />
                </Animated.View>
                <View pointerEvents="none" style={{
                  position: "absolute", left: CENTER - 7, top: CENTER - 7,
                  width: 14, height: 14, borderRadius: 7, backgroundColor: theme.actionBackground,
                }} />
              </Animated.View>
            </GestureDetector>
            <View style={{ flexDirection: "row", gap: 10, alignSelf: "stretch" }}>
              <View style={{ flex: 1 }}><BthwaniButton label="إلغاء" variant="secondary" onPress={() => setVisible(false)} /></View>
              <View style={{ flex: 1 }}><BthwaniButton label="تأكيد" onPress={() => { onChange(formatClockTime(minutes.value)); setVisible(false); }} /></View>
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  </View>;
}
