import { type ColorValue, Text, View } from "react-native";

import { sizing } from "../tokens/index";
import type { MobileIconName } from "./icon-types";

export type { MobileIconName } from "./icon-types";

// @expo/ui's native Icon intentionally renders nothing on web.
// Keep icon call sites and navigation consistent without bundling native XML
// symbols (or introducing another native dependency) in Expo Web.
const webGlyphs: Record<MobileIconName, string> = {
  home: "⌂",
  orders: "▤",
  account: "◉",
  wallet: "▣",
  store: "▥",
  favorite: "♥",
  offers: "◇",
  deliveries: "➜",
  cases: "▰",
  cart: "▱",
  back: "‹",
  forward: "›",
  add: "+",
  edit: "✎",
  location: "⌖",
  appearance: "◐",
  refresh: "↻",
  warning: "⚠",
  success: "✓",
  search: "⌕",
  share: "⇧",
  trending: "↗",
  notifications: "♧",
  close: "×",
  eye: "◉",
  "eye-off": "⊘",
  categories: "▦",
  restaurant: "♨",
  grocery: "▧",
  desserts: "✿",
  beauty: "✦",
  electronics: "▣",
  health: "+",
  gifts: "♢",
  "home-projects": "⌂",
  "auto-parts": "⚒",
  honey: "⬡",
  mall: "▥",
};

export function BthwaniIcon({
  name,
  color,
  size = sizing.iconLg,
  accessibilityLabel,
}: {
  name: MobileIconName;
  color?: ColorValue;
  size?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : "none"}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ color: color ?? "currentColor", fontSize: Math.max(12, size * 0.95), lineHeight: size, textAlign: "center", fontWeight: "600" }}
      >
        {webGlyphs[name]}
      </Text>
    </View>
  );
}
