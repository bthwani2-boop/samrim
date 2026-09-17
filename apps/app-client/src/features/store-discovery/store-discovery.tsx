import { borders, direction, opacity, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import type { PublicStoreView } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
const theme = useAppearanceTheme();
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
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleMd, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    list: { gap: spacing[2] },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    cardPressed: { opacity: opacity.subtle },
    cardTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    cardMeta: { ...typography.caption, color: theme.colorMuted, textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
  });
}
