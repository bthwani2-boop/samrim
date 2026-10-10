import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useRef, useState } from "react";
import { I18nManager, Modal, Text, View, type GestureResponderEvent } from "react-native";

import {
  clockDarkness,
  clockHandDegrees,
  formatClockTime,
  parseClockTime,
  rotateClockMinutes,
  wrapDayMinutes,
} from "./field-circular-clock";
import { createFieldOperationStyles } from "./field-operation-styles";

const SIZE = 248;
const CENTER = SIZE / 2;
const LABEL_RADIUS = 96;
const CLOCK_NUMBERS = Array.from({ length: 12 }, (_, index) => {
  const angle = index * Math.PI / 6 - Math.PI / 2;
  return { number: index || 12, x: CENTER + LABEL_RADIUS * Math.cos(angle), y: CENTER + LABEL_RADIUS * Math.sin(angle) };
});

function interpolateColor(light: readonly number[], dark: readonly number[], fraction: number): string {
  return `rgb(${light.map((value, i) => Math.round(value + ((dark[i] ?? value) - value) * fraction)).join(",")})`;
}

function dialAngle(event: GestureResponderEvent): number {
  const { locationX, locationY } = event.nativeEvent;
  return Math.atan2(locationY - CENTER, locationX - CENTER);
}

export function FieldCircularTimePicker({ label, value, onChange, disabled }: Readonly<{
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}>) {
  const theme = useAppearanceTheme();
  const styles = createFieldOperationStyles(theme);
  const [visible, setVisible] = useState(false);
  const [minutes, setMinutes] = useState(9 * 60);
  const precise = useRef(9 * 60);
  const lastAngle = useRef<number | null>(null);
  const darkness = clockDarkness(minutes);
  const dialBackground = interpolateColor([239, 246, 255], [23, 37, 61], darkness);
  const dialForeground = darkness >= 0.57 ? "#FFFFFF" : "#243247";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const display = `${String(hour % 12 || 12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const period = hour < 12 ? "صباحًا" : "مساءً";

  function updateMinutes(next: number) {
    precise.current = wrapDayMinutes(next);
    setMinutes(Math.round(precise.current) % (24 * 60));
  }

  function open() {
    updateMinutes(parseClockTime(value));
    lastAngle.current = null;
    setVisible(true);
  }

  function move(event: GestureResponderEvent) {
    if (lastAngle.current === null) return;
    const nextAngle = dialAngle(event);
    updateMinutes(rotateClockMinutes(precise.current, lastAngle.current, nextAngle));
    lastAngle.current = nextAngle;
  }

  return <View style={{ flex: 1, minWidth: 112 }}>
    <BthwaniButton disabled={disabled} label={value || label} onPress={open} variant="secondary" />
    <Modal animationType="fade" transparent visible={visible} onRequestClose={() => setVisible(false)}>
      <View style={{ flex: 1, justifyContent: "center", padding: 14, backgroundColor: "rgba(0,0,0,0.55)" }}>
        <View accessibilityViewIsModal style={{
          backgroundColor: theme.surface, borderRadius: 18, padding: 14,
          alignItems: "center", gap: 12,
        }}>
          <Text style={styles.cardTitle}>{label}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.sectionTitle, { textAlign: "center", fontSize: 23 }]}>
            {display} {period}
          </Text>
          <Text style={styles.muted}>لف العقرب لتغيير الساعة والفترة تلقائيًا · كل دورة 12 ساعة</Text>
          <View
            accessibilityRole="adjustable"
            accessibilityLabel={`${label}: ${display} ${period}`}
            accessibilityHint="حرّك العقرب، أو استخدم إجراءات زيادة الدقيقة وإنقاصها"
            accessibilityActions={[{ name: "increment", label: "زيادة دقيقة" }, { name: "decrement", label: "إنقاص دقيقة" }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "increment") updateMinutes(precise.current + 1);
              if (event.nativeEvent.actionName === "decrement") updateMinutes(precise.current - 1);
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => { lastAngle.current = dialAngle(event); }}
            onResponderMove={move}
            onResponderRelease={() => { lastAngle.current = null; }}
            onResponderTerminate={() => { lastAngle.current = null; }}
            style={{
              width: SIZE, height: SIZE, borderRadius: CENTER,
              backgroundColor: dialBackground, alignSelf: "center",
              borderWidth: 1, borderColor: theme.borderColor,
            }}
          >
            {CLOCK_NUMBERS.map(({ number, x, y }) =>
              <Text key={number} pointerEvents="none" style={{
                position: "absolute", left: I18nManager.isRTL ? SIZE - x - 19 : x - 19, top: y - 13,
                width: 38, height: 27, textAlign: "center",
                fontSize: 17, fontWeight: "600", color: dialForeground,
              }}>{number}</Text>
            )}
            <View pointerEvents="none" style={{
              position: "absolute", top: 0, left: 0, width: SIZE, height: SIZE,
              transform: [{ rotate: `${clockHandDegrees(minutes)}deg` }],
            }}>
              <View style={{
                position: "absolute", top: CENTER - 84, left: CENTER - 2,
                width: 4, height: 84, borderRadius: 3, backgroundColor: theme.actionBackground,
              }} />
              <View style={{
                position: "absolute", top: CENTER - 94, left: CENTER - 10,
                width: 20, height: 20, borderRadius: 10, backgroundColor: theme.actionBackground,
              }} />
            </View>
            <View pointerEvents="none" style={{
              position: "absolute", left: CENTER - 7, top: CENTER - 7,
              width: 14, height: 14, borderRadius: 7, backgroundColor: theme.actionBackground,
            }} />
          </View>
          <Text style={styles.muted}>لضبط الوقت بدقة، أضف دقيقة أو أنقصها</Text>
          <View style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}>
            <View style={{ minWidth: 110 }}><BthwaniButton label="− دقيقة" variant="secondary" onPress={() => updateMinutes(precise.current - 1)} /></View>
            <View style={{ minWidth: 110 }}><BthwaniButton label="+ دقيقة" variant="secondary" onPress={() => updateMinutes(precise.current + 1)} /></View>
          </View>
          <Text style={styles.muted}>يُحفظ الوقت: {formatClockTime(minutes)} (24 ساعة)</Text>
          <View style={{ flexDirection: "row", gap: 10, alignSelf: "stretch" }}>
            <View style={{ flex: 1 }}><BthwaniButton label="إلغاء" variant="secondary" onPress={() => setVisible(false)} /></View>
            <View style={{ flex: 1 }}><BthwaniButton label="تأكيد" onPress={() => { onChange(formatClockTime(minutes)); setVisible(false); }} /></View>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}
