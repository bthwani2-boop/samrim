import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import type { PublicStoreView } from "@bthwani/dsh";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { listPublishedStores } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView> }
  | { kind: "empty" }
  | { kind: "error" };

export default function StoreDiscovery({ isAuthenticated = true, onRequireAuthentication }: { isAuthenticated?: boolean; onRequireAuthentication?: (() => void) | undefined }) {
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      if (!selectedCityID) {
        setState({ kind: "empty" });
        return;
      }
      const stores = await listPublishedStores(selectedCityID);
      setState(stores.length ? { kind: "ready", stores } : { kind: "empty" });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") {
    return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ قراءة المتاجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المتاجر المنشورة…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر اكتشاف المتاجر</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable>{!isAuthenticated && onRequireAuthentication ? <Pressable accessibilityRole="button" onPress={onRequireAuthentication} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تسجيل الدخول للطلب</Text></Pressable> : null}</View>;
  }
  if (state.kind === "empty") {
    return <View style={styles.state}><Text style={styles.title}>لا توجد متاجر متاحة</Text><Text style={styles.muted}>ستظهر المتاجر هنا عندما تصبح متاحة للطلب.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>تحديث</Text></Pressable>{!isAuthenticated && onRequireAuthentication ? <Pressable accessibilityRole="button" onPress={onRequireAuthentication} style={styles.button}><Text style={styles.buttonText}>تسجيل الدخول للطلب</Text></Pressable> : null}</View>;
  }

  return (
    <View style={styles.container} accessibilityLabel="اكتشاف المتاجر">
      <Text style={styles.eyebrow}>اكتشاف العميل</Text>
      <Text style={styles.title}>المتاجر المتاحة</Text>
      <Text style={styles.muted}>اختر متجرًا لعرض الكتالوج ثم انتقل إلى السلة عند الاستعداد للطلب.</Text>
      <View style={styles.list}>
        {state.stores.map((store) => (
          <Pressable
            key={store.id}
            accessibilityRole="button"
            accessibilityLabel={`فتح متجر ${store.name}`}
            onPress={() => router.push(`/store/${encodeURIComponent(store.id)}` as Href)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <Text style={styles.cardTitle}>{store.name}</Text>
            <Text style={styles.cardMeta}>{store.serviceCity.displayNameAr} · متاح للطلب</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, direction: activeDirection, gap: 10, marginTop: 16, padding: 14, width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: 10, paddingVertical: 28, width: "100%" },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 20, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    list: { gap: 8 },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 4, padding: 14 },
    cardPressed: { opacity: 0.74 },
    cardTitle: { color: theme.color, fontSize: 16, fontWeight: "800", textAlign: startTextAlign },
    cardMeta: { color: theme.colorMuted, fontSize: 13, textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
  });
}
