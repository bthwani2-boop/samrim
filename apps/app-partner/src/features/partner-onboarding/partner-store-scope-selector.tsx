import { sizing } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessPermission } from "@bthwani/dsh";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { usePartnerStoreScope } from "./partner-store-scope-context";

export function PartnerStoreScopeSelector({ requiredPermissions }: Readonly<{ requiredPermissions?: ReadonlyArray<StoreAccessPermission> }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const { state, stores, selectedStore, selectStore, reload } = usePartnerStoreScope();
  const [expanded, setExpanded] = useState(false);
  const visibleStores = requiredPermissions
    ? stores.filter((store) => store.owned || requiredPermissions.some((permission) => store.permissions.includes(permission)))
    : stores;
  const visibleSelection = visibleStores.find((store) => store.id === selectedStore?.id);

  if (state.kind === "loading") return <View style={styles.card}><ActivityIndicator accessibilityLabel="جارٍ قراءة المتاجر المتاحة" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر المتاحة لحسابك…</Text></View>;
  if (state.kind === "error") return <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة المتاجر المتاحة من المنصة.</Text><BthwaniButton label="إعادة القراءة" onPress={() => void reload()} variant="secondary" /></View>;

  return <View style={styles.card}>
    <Pressable accessibilityLabel={`اختيار المتجر: ${visibleSelection?.name ?? "اختر متجرًا مصرحًا"}`} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={[styles.headerRow, { minHeight: sizing.controlLg }]}><Text style={styles.value}>{visibleSelection?.name ?? "اختر متجرًا مصرحًا"}</Text><Text style={styles.muted}>{expanded ? "إغلاق" : "تغيير"}</Text></Pressable>
    {visibleStores.length === 0 ? <Text style={styles.muted}>لا يوجد متجر متاح لهذه العملية حاليًا.</Text> : null}
    {expanded ? visibleStores.map((store) => <Pressable accessibilityLabel={`اختيار متجر ${store.name}`} accessibilityRole="button" accessibilityState={{ selected: selectedStore?.id === store.id }} key={store.id} onPress={() => { selectStore(store.id); setExpanded(false); }} style={{ backgroundColor: selectedStore?.id === store.id ? theme.surfaceInset : theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, minHeight: sizing.controlLg, justifyContent: "center", padding: 12 }}>
      <Text style={styles.value}>{store.name}</Text>
      {store.publicationState !== "published" ? <Text style={styles.muted}>غير منشور</Text> : null}
    </Pressable>) : null}
  </View>;
}
