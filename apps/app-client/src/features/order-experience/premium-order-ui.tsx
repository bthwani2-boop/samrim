import { type CustomerFulfillmentMode, fulfillmentModeLabel } from "@bthwani/dsh";
import { BthwaniIcon } from "@bthwani/design-system/native";
import { ActivityIndicator, Image, ImageBackground, Pressable, StyleSheet, Text, View } from "react-native";

export const premium = {
  background: "#080F19", surface: "#111B27", raised: "#172331",
  stroke: "#2C3C4C", orange: "#FF944D", coral: "#FF5359",
  soft: "#42232C", text: "#F8F8FA", muted: "#A4ADBC", green: "#39D4A1",
} as const;
const description: Record<CustomerFulfillmentMode, string> = {
  BTHWANI_CAPTAIN: "بواسطة مندوبينا", PARTNER_CAPTAIN: "بواسطة فريق المتجر", CUSTOMER_PICKUP: "من المتجر",
};
export function PremiumStoreIdentity({ title, imageUri, subtitle, rating, compact = false }: {
  title: string; imageUri?: string | null | undefined; subtitle?: string | undefined; rating?: string | undefined; compact?: boolean | undefined;
}) {
  return <View style={styles.storeRow}>
    {imageUri ? <Image source={{ uri: imageUri }} style={compact ? styles.imageCompact : styles.image} resizeMode="cover" accessibilityLabel={"صورة متجر " + title} /> :
      <View style={[styles.imageFallback, compact && styles.imageCompact]}><BthwaniIcon name="store" size={26} color={premium.orange} /></View>}
    <View style={styles.storeCopy}>
      <Text numberOfLines={1} style={styles.storeTitle}>{title}</Text>
      {subtitle ? <Text numberOfLines={2} style={styles.storeSubtitle}>{subtitle}</Text> : null}
      {rating ? <Text style={styles.rating}>★ {rating}</Text> : null}
    </View>
  </View>;
}
export function PremiumFulfillmentSelector({ available, selected, disabled, onSelect }: {
  available: ReadonlyArray<CustomerFulfillmentMode>; selected: CustomerFulfillmentMode | null;
  disabled?: boolean; onSelect: (mode: CustomerFulfillmentMode) => void;
}) {
  return <View accessibilityRole="radiogroup" style={styles.modeRow}>
    {available.map((mode) => {
      const checked = selected === mode;
      return <Pressable key={mode} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked, disabled: Boolean(disabled) }}
        accessibilityLabel={fulfillmentModeLabel(mode)} onPress={() => onSelect(mode)}
        style={[styles.modeCard, checked && styles.modeSelected]}>
        <Text style={[styles.dot, checked && styles.dotSelected]}>{checked ? "✓" : "○"}</Text>
        <BthwaniIcon name={mode === "CUSTOMER_PICKUP" ? "account" : mode === "PARTNER_CAPTAIN" ? "store" : "location"} color={premium.orange} size={25}/>
        <Text numberOfLines={2} style={styles.modeLabel}>{fulfillmentModeLabel(mode)}</Text>
        <Text numberOfLines={2} style={styles.modeHint}>{description[mode]}</Text>
      </Pressable>;
    })}
  </View>;
}
export function PremiumOrderProgress({ steps, index }: { steps: readonly string[]; index: number }) {
  return <View accessibilityLabel={index < 0 ? "الطلب غير نشط" : "حالة الطلب: " + steps[index]} style={styles.progressRow}>
    {steps.map((title, i) => {
      const passed = index >= 0 && i < index; const current = index >= 0 && i === index;
      return <View style={styles.progressItem} key={title + i}>
        <View style={[styles.progressCircle, (passed || current) && styles.progressDone, current && styles.progressCurrent]}>
          <Text style={[styles.progressSymbol, (passed || current) && styles.progressSymbolActive]}>{passed ? "✓" : i + 1}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.progressTitle, current && styles.progressTitleCurrent]}>{title}</Text>
      </View>;
    })}
  </View>;
}
export function PremiumStickyFooter({ amount, label, disabled, busy, detail, onPress }: {
  amount: string; label: string; disabled?: boolean; busy?: boolean; detail?: string; onPress: () => void;
}) {
  return <View style={styles.sticky}>
    <View style={styles.amountCopy}><Text style={styles.amountLabel}>الإجمالي الكلي</Text>
      <Text numberOfLines={2} style={styles.amount}>{amount}</Text>
      {detail ? <Text style={styles.amountDetail}>{detail}</Text> : null}
    </View>
    <View style={styles.primary}><PremiumGradientAction label={label} busy={Boolean(busy)} disabled={Boolean(disabled)} onPress={onPress}/></View>
  </View>;
}
export function PremiumGradientAction({ label, onPress, disabled = false, busy = false }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
}) {
  return <ImageBackground source={require("../../../assets/checkout-gradient.png")} resizeMode="stretch"
    style={[styles.actionGradient, disabled && styles.actionDisabled]} imageStyle={styles.actionImage}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled || busy} onPress={onPress} style={styles.actionHit}>
      {busy ? <ActivityIndicator color={premium.text} /> : <Text style={styles.actionText}>{label}  ←</Text>}
    </Pressable>
  </ImageBackground>;
}

export function PremiumOutlineAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.outlineAction}>
    <Text style={styles.outlineText}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  actionGradient: { minHeight: 54, borderRadius: 14, overflow: "hidden", justifyContent: "center" },
  actionImage: { borderRadius: 14 },
  actionHit: { minHeight: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  actionDisabled: { opacity: 0.55 },
  actionText: { color: premium.text, fontWeight: "700", fontSize: 15, textAlign: "center" },
  outlineAction: { minHeight: 48, borderRadius: 13, borderColor: premium.coral, borderWidth: 1, backgroundColor: premium.background, alignItems: "center", justifyContent: "center", padding: 8 },
  outlineText: { color: premium.orange, fontSize: 14, fontWeight: "700", textAlign: "center" },
  storeRow: { flexDirection: "row-reverse", alignItems: "center", gap: 14 },
  image: { width: 118, height: 88, borderRadius: 14, backgroundColor: premium.raised },
  imageCompact: { width: 90, height: 75, borderRadius: 12 },
  imageFallback: { width: 118, height: 88, backgroundColor: premium.soft, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  storeCopy: { flex: 1, gap: 5, alignItems: "flex-end" },
  storeTitle: { color: premium.text, fontSize: 18, fontWeight: "700", textAlign: "right" },
  storeSubtitle: { color: premium.muted, fontSize: 13, textAlign: "right" },
  rating: { color: premium.orange, fontSize: 13, textAlign: "right" },
  modeRow: { flexDirection: "row", gap: 8 },
  modeCard: { flex: 1, position: "relative", minWidth: 0, minHeight: 114, borderRadius: 16, borderWidth: 1, borderColor: premium.stroke, backgroundColor: premium.background, justifyContent: "center", alignItems: "center", paddingVertical: 10, paddingHorizontal: 3, gap: 5 },
  modeSelected: { borderColor: premium.coral, borderWidth: 2, backgroundColor: premium.soft, shadowColor: premium.coral, shadowOpacity: 0.28, shadowRadius: 10, elevation: 3 },
  dot: { position: "absolute", left: 7, top: 7, color: premium.muted, fontSize: 16, fontWeight: "700" },
  dotSelected: { color: premium.coral },
  modeLabel: { color: premium.text, fontWeight: "700", fontSize: 12, textAlign: "center" },
  modeHint: { color: premium.muted, fontSize: 10, textAlign: "center" },
  progressRow: { flexDirection: "row", backgroundColor: premium.surface, borderColor: premium.stroke, borderWidth: 1, borderRadius: 17, paddingVertical: 15, paddingHorizontal: 6, gap: 3 },
  progressItem: { flex: 1, gap: 7, alignItems: "center" },
  progressCircle: { height: 33, width: 33, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: premium.stroke, borderRadius: 20 },
  progressDone: { borderColor: premium.orange, backgroundColor: premium.soft },
  progressCurrent: { borderColor: premium.coral, borderWidth: 2, shadowColor: premium.coral, shadowOpacity: 0.5, shadowRadius: 8 },
  progressSymbol: { color: premium.muted, fontSize: 13 },
  progressSymbolActive: { color: premium.orange, fontWeight: "700" },
  progressTitle: { color: premium.muted, fontSize: 11, textAlign: "center" },
  progressTitleCurrent: { color: premium.orange, fontWeight: "700" },
  sticky: { flexDirection: "row", borderTopWidth: 1, borderColor: premium.stroke, backgroundColor: premium.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 12, gap: 12, alignItems: "center" },
  amountCopy: { flexShrink: 1, alignItems: "flex-end", gap: 3 },
  amountLabel: { color: premium.orange, fontSize: 12, fontWeight: "700" },
  amount: { color: premium.text, fontSize: 19, fontWeight: "800", textAlign: "right" },
  amountDetail: { color: premium.muted, fontSize: 10 },
  primary: { flex: 1 },
});