import type { PublicOffer } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, Text, View } from "react-native";
import ProductVariantPrice from "./product-variants";

export default function ProductDetail({ offer, quantity, disabled, onAdjust }: Readonly<{
  offer: PublicOffer;
  quantity: number;
  disabled: boolean;
  onAdjust?: (direction: -1 | 1) => void;
}>) {
  const { theme } = useMobileAppearance();
  const button = { minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: "center",
    alignItems: "center", borderRadius: 10 } as const;
  return <View testID={`offer-${offer.id}`} style={{
    backgroundColor: theme.surface, padding: 16, borderWidth: 1,
    borderColor: theme.borderColor, borderRadius: 12, gap: 12,
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center",
  }}>
    <View style={{ gap: 4, flexShrink: 1 }}>
      <Text style={{ color: theme.color, fontWeight: "600", fontSize: 17 }}>{offer.name}</Text>
      <ProductVariantPrice priceYer={offer.priceYer} />
    </View>
    {onAdjust ? quantity > 0 ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1,
        borderColor: theme.borderColor, borderRadius: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`تقليل كمية ${offer.name}`}
          disabled={disabled} onPress={() => onAdjust(-1)} style={button}>
          <Text style={{ color: theme.interactiveText, fontSize: 19 }}>−</Text>
        </Pressable>
        <Text accessibilityLabel={`الكمية ${quantity}`} accessibilityLiveRegion="polite"
          style={{ color: theme.color, minWidth: 22, textAlign: "center" }}>{quantity.toLocaleString("ar-YE")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`زيادة كمية ${offer.name}`}
          disabled={disabled || quantity >= 2147483647} onPress={() => onAdjust(1)} style={button}>
          <Text style={{ color: theme.interactiveText, fontSize: 19 }}>+</Text>
        </Pressable>
      </View>
    ) : (
      <Pressable accessibilityRole="button" accessibilityLabel={`أضف ${offer.name} إلى السلة`}
        disabled={disabled} onPress={() => onAdjust(1)}
        style={{ ...button, backgroundColor: theme.actionBackground, opacity: disabled ? 0.55 : 1 }}>
        <Text style={{ color: theme.onAction, fontWeight: "600" }}>أضف للسلة</Text>
      </Pressable>
    ) : null}
  </View>;
}
