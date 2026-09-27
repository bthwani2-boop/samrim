import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicPromotionView } from "@bthwani/dsh";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

export function PromotionCard({ promotion }: { promotion: PublicPromotionView }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const benefit = promotion.kind === "PERCENTAGE" ? `خصم ${promotion.valueMinor}%` : `خصم ${formatMoney(promotion.valueMinor, "YER")}`;
  return (
    <BthwaniSurface tone="raised" style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>{promotion.nameAr}</Text>
        <Text style={styles.muted}>{promotion.descriptionAr || benefit}</Text>
        {promotion.descriptionAr ? <Text style={styles.benefit}>{benefit}</Text> : null}
        {promotion.maxDiscountMinor ? <Text style={styles.muted}>الحد الأعلى للخصم {formatMoney(promotion.maxDiscountMinor, "YER")}</Text> : null}
        {promotion.endsAt ? <Text style={styles.muted}>يسري حتى {new Date(promotion.endsAt).toLocaleDateString("ar-YE", { dateStyle: "medium" })}</Text> : null}
      </View>
      <Text accessibilityLabel={`رمز العرض ${promotion.code}`} style={styles.code}>{promotion.code}</Text>
    </BthwaniSurface>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    copy: { flex: 1, gap: spacing[1] },
    title: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    benefit: { ...typography.bodySm, color: theme.interactiveText },
    code: { ...typography.label, backgroundColor: theme.actionSoft, borderColor: theme.interactiveText, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.interactiveText, paddingHorizontal: spacing[2], paddingVertical: spacing[1], textAlign: "left", writingDirection: "ltr" },
  });
}
