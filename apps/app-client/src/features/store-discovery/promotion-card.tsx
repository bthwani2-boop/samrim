import { useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicPromotionView } from "@bthwani/dsh";
import { Button, Card, Text, View } from "tamagui";

export function PromotionCard({ promotion, onUse }: { promotion: PublicPromotionView; onUse?: () => void }) {
  const theme = useAppearanceTheme();
  const benefit = promotion.kind === "PERCENTAGE" ? `خصم ${promotion.valueMinor}%` : `خصم ${discoveryMoney(promotion.valueMinor, "YER")}`;
  return (
    <Card style={{ alignItems: "center", backgroundColor: theme.surfaceRaised, borderRadius: 12, flexDirection: "row", gap: 12, padding: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.color, fontSize: 14, fontWeight: "600", textAlign: "right" }}>{promotion.nameAr}</Text>
        <Text style={{ color: theme.colorMuted, fontSize: 12, textAlign: "right" }}>{promotion.descriptionAr || benefit}</Text>
        {promotion.descriptionAr ? <Text style={{ color: theme.interactiveText, fontSize: 12, textAlign: "right" }}>{benefit}</Text> : null}
        {promotion.maxDiscountMinor ? <Text style={{ color: theme.colorMuted, fontSize: 12, textAlign: "right" }}>الحد الأعلى للخصم {discoveryMoney(promotion.maxDiscountMinor, "YER")}</Text> : null}
        {promotion.endsAt ? <Text style={{ color: theme.colorMuted, fontSize: 12, textAlign: "right" }}>يسري حتى {new Date(promotion.endsAt).toLocaleDateString("ar-YE", { dateStyle: "medium" })}</Text> : null}
        {onUse ? (
          <Button
            accessibilityLabel={`استخدام عرض ${promotion.nameAr} في سلة المتجر`}
            onPress={onUse}
            style={{ alignSelf: "flex-start" }}
          >
            <Text style={{ color: theme.interactiveText, textAlign: "right" }}>استخدام العرض في السلة</Text>
          </Button>
        ) : null}
      </View>
      <Text
        accessibilityLabel={`رمز العرض ${promotion.code}`}
        style={{ backgroundColor: theme.actionSoft, borderColor: theme.interactiveText, borderRadius: 8, borderWidth: 1, color: theme.interactiveText, paddingHorizontal: 8, paddingVertical: 4, textAlign: "left", writingDirection: "ltr" }}
      >
        {promotion.code}
      </Text>
    </Card>
  );
}

function discoveryMoney(amountMinor: number, currency: string): string {
  return (currency === "YER" ? formatMoney(amountMinor, "YER") : `${amountMinor} ${currency}`).replace(/ريال يمني/g, "ريال");
}
