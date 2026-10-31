import { typography } from "@bthwani/design-system";
import { BthwaniIcon, type MobileIconName, useAppearanceTheme } from "@bthwani/design-system/native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PartnerStoreReels } from "../store-offer/partner-store-reels";
import { StorePromotionsCard } from "../store-offer/store-promotions";

export type PartnerMarketingView = "overview" | "offers" | "campaigns" | "content";

export function parsePartnerMarketingView(value: string | undefined): PartnerMarketingView {
  return value === "offers" || value === "campaigns" || value === "content" ? value : "overview";
}

const sections: ReadonlyArray<Readonly<{
  id: PartnerMarketingView; label: string; hint: string; icon: MobileIconName;
}>> = [
  { id: "overview", label: "نظرة تسويقية", hint: "العروض والحملات من بيانات المتجر", icon: "trending" },
  { id: "offers", label: "العروض والقسائم", hint: "خصم ونطاق وجدول وحد استخدام", icon: "offers" },
  { id: "campaigns", label: "حملات المنصة", hint: "مراجعة الأهلية وشروط المشاركة", icon: "success" },
  { id: "content", label: "مقاطع المتجر", hint: "محتوى أصلي يمر بمراجعة النشر", icon: "play" },
];

export function PartnerMarketingWorkspace({
  storeID, storeName, verticalID, view,
}: Readonly<{ storeID: string; storeName: string; verticalID: string; view: PartnerMarketingView }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    root: { gap: 16 },
    banner: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 16, padding: 20, gap: 7 },
    eyebrow: { ...typography.caption, color: theme.brandAction, fontWeight: "800" },
    heading: { ...typography.titleLg, color: theme.color, fontWeight: "800" },
    intro: { ...typography.bodySm, color: theme.colorMuted },
    nav: { flexDirection: "row", flexWrap: "wrap", gap: 11 },
    card: { flexGrow: 1, flexBasis: 185, minWidth: 175, minHeight: 98, padding: 13, borderWidth: 1, borderRadius: 13, borderColor: theme.borderColor, backgroundColor: theme.surface, gap: 7 },
    active: { borderColor: theme.brandAction, backgroundColor: theme.actionSoft },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 9 },
    cardTitle: { ...typography.bodyStrong, color: theme.color, fontWeight: "800" },
    cardHint: { ...typography.caption, color: theme.colorMuted },
    note: { ...typography.caption, color: theme.colorMuted, paddingHorizontal: 5 },
  }), [theme]);
  const router = useRouter();
  const navigate = (next: PartnerMarketingView) => {
    // Reuse the admitted Store promotion route and preserve the selected Store scope.
    router.setParams({ view: next });
  };
  return <View style={styles.root} accessibilityLabel="مساحة تسويق المتجر">
    <View style={styles.banner}>
      <Text style={styles.eyebrow}>مساحة الشريك / التسويق</Text>
      <Text accessibilityRole="header" style={styles.heading}>التسويق</Text>
      <Text style={styles.intro}>العروض والقسائم، حملات بثواني، ومقاطع المتجر — دون اشتراك إضافي. جميع التغييرات تمر عبر صلاحيات المتجر وقواعد DSH.</Text>
    </View>
    <View style={styles.nav} accessibilityLabel="أقسام تسويق المتجر">
      {sections.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label}
        accessibilityState={{ selected: item.id === view }} onPress={() => navigate(item.id)}
        style={({ pressed }) => [styles.card, item.id === view && styles.active, pressed && { opacity: .78 }]}>
        <View style={styles.cardTop}>
          <BthwaniIcon name={item.icon} size={20} color={theme.brandAction} />
          <Text style={styles.cardTitle}>{item.label}</Text>
        </View>
        <Text style={styles.cardHint}>{item.hint}</Text>
      </Pressable>)}
    </View>
    {view === "content" ? <PartnerStoreReels key={storeID} storeId={storeID} storeName={storeName} /> :
      <StorePromotionsCard key={storeID} storeID={storeID} verticalID={verticalID} mode={view} />}
    {view === "overview" ? <Text style={styles.note}>لا تتضمن هذه الشاشة إحصاءات تسويق تقديرية أو رسومًا مفروضة. أي خصم يُنشأ بتمويل الشريك يخضع لقواعد الأهلية والتسوية القائمة، والمقاطع تُنشر بعد موافقة العمليات.</Text> : null}
  </View>;
}
