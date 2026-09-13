import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import type { PublicStoreView } from "@bthwani/dsh";
import { listPublishedStores, readPublishedStore } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView> }
  | { kind: "empty" }
  | { kind: "error" };

export default function StoreDiscovery() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [selected, setSelected] = useState<PublicStoreView | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setSelected(null);
    setDetailState("idle");
    try {
      const stores = await listPublishedStores();
      setState(stores.length ? { kind: "ready", stores } : { kind: "empty" });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openStore(store: PublicStoreView) {
    setSelected(null);
    setDetailState("loading");
    try {
      setSelected(await readPublishedStore(store.id));
      setDetailState("ready");
    } catch {
      setDetailState("error");
    }
  }

  if (state.kind === "loading") {
    return <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر المنشورة…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر اكتشاف المتاجر</Text><Text style={styles.muted}>تحقق من اتصال DSH ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable></View>;
  }
  if (state.kind === "empty") {
    return <View style={styles.state}><Text style={styles.title}>لا توجد متاجر منشورة</Text><Text style={styles.muted}>ستظهر المتاجر هنا بعد اجتياز النشر الكانوني.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحديث</Text></Pressable></View>;
  }
  if (detailState === "loading") {
    return <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ فتح تفاصيل المتجر…</Text></View>;
  }
  if (detailState === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر قراءة تفاصيل المتجر</Text><Pressable accessibilityRole="button" onPress={() => setDetailState("idle")} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة إلى المتاجر</Text></Pressable></View>;
  }
  if (selected) {
    return <View style={styles.detail}><Pressable accessibilityRole="button" onPress={() => { setSelected(null); setDetailState("idle"); }}><Text style={styles.back}>‹ المتاجر المنشورة</Text></Pressable><Text style={styles.title}>{selected.name}</Text><Text style={styles.muted}>متجر منشور ومتاح للاكتشاف</Text><Text style={styles.meta}>معرّف المتجر: {selected.id}</Text><Text style={styles.meta}>إصدار الحالة: {selected.version}</Text><Text style={styles.sectionTitle}>المنتجات المتاحة</Text>{selected.assortments.length ? selected.assortments.map((assortment) => <View key={assortment.productId} style={styles.item}><Text style={styles.meta}>{assortment.canonicalName}</Text><Text style={styles.meta}>{assortment.priceMinor} {assortment.currency} · {assortment.sellUnit === "kg" ? "بالكيلو" : "بالقطعة"}</Text><Text style={styles.muted}>متاح · إصدار العرض {assortment.version}</Text></View>) : <Text style={styles.muted}>لا توجد منتجات متاحة حاليًا.</Text>}</View>;
  }

  return <View style={styles.container}><Text style={styles.eyebrow}>اكتشاف العميل</Text><Text style={styles.title}>المتاجر المنشورة</Text><Text style={styles.muted}>هذه القائمة تأتي من DSH ولا تعرض إلا المتاجر التي اجتازت بوابات النشر الحالية.</Text><FlatList data={state.stores} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`فتح متجر ${item.name}`} onPress={() => void openStore(item)} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardMeta}>متجر منشور · إصدار {item.version}</Text></Pressable>} /></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { flex: 1, width: "100%", padding: 18, backgroundColor: theme.background },
    state: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 220, padding: 20, width: "100%", backgroundColor: theme.background },
    detail: { gap: 14, padding: 20, width: "100%", backgroundColor: theme.background },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: "center" },
    title: { color: theme.structure, fontSize: 22, fontWeight: "800", textAlign: "center" },
    muted: { color: theme.colorMuted, fontSize: 14, textAlign: "center" },
    list: { gap: 12, paddingVertical: 18 },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 16, borderWidth: 1, gap: 6, padding: 16 },
    cardTitle: { color: theme.structure, fontSize: 17, fontWeight: "800", textAlign: "left" },
    cardMeta: { color: theme.colorMuted, fontSize: 13, textAlign: "left" },
    meta: { color: theme.structure, fontSize: 14, textAlign: "left" },
    sectionTitle: { color: theme.structure, fontSize: 16, fontWeight: "800", marginTop: 8, textAlign: "left" },
    item: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 4, padding: 12 },
    back: { color: theme.interactiveText, fontSize: 15, fontWeight: "800", textAlign: "left" },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 14, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    buttonText: { color: theme.surface, fontSize: 15, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    secondaryButtonText: { color: theme.structure, fontSize: 15, fontWeight: "800" },
  });
}
