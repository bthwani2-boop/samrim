import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type ClientOpenCartSummary, formatOrderDate } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState } from "../../bootstrap/identity";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { listOwnOpenCarts } from "../store-discovery/store-discovery-client";

type CartsState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; actorID: string; carts: ReadonlyArray<ClientOpenCartSummary> };

function isCurrentActor(actorID: string): boolean {
  const session = currentIdentityState();
  return session.kind === "authenticated" && session.identity.subject.trim() === actorID;
}

export function ClientOpenCarts({ actorID }: { actorID: string }) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { selectedCityID } = useServiceCityScope();
  const [state, setState] = useState<CartsState>({ kind: "loading" });
  const requestID = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestID.current;
    setState({ kind: "loading" });
    if (!actorID || !isCurrentActor(actorID)) return;
    try {
      const response = await listOwnOpenCarts();
      if (sequence === requestID.current && isCurrentActor(actorID)) {
        setState({ kind: "ready", actorID, carts: [...response.carts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      }
    } catch {
      if (sequence === requestID.current && isCurrentActor(actorID)) setState({ kind: "error" });
    }
  }, [actorID]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestID.current += 1; };
  }, [load]));

  if (!isCurrentActor(actorID) || state.kind === "loading" || (state.kind === "ready" && state.actorID !== actorID)) {
    return <View style={styles.state}><BthwaniSkeleton height={112} /><BthwaniSkeleton height={112} /></View>;
  }
  if (state.kind === "error") {
    return <BthwaniSurface tone="inset" style={styles.state}>
      <Text accessibilityRole="alert" style={styles.title}>تعذر قراءة السلال</Text>
      <Text style={styles.muted}>تحقق من الاتصال ثم أعد القراءة.</Text>
      <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />
    </BthwaniSurface>;
  }
  if (!state.carts.length) {
    return <BthwaniSurface tone="inset" style={styles.state}>
      <BthwaniIcon name="cart" color={theme.interactiveText} size={32} />
      <Text style={styles.title}>لا توجد سلال مفتوحة</Text>
      <Text style={styles.muted}>أضف منتجات من المتاجر لتظهر سلالك هنا.</Text>
      <BthwaniButton label="استكشف المتاجر" onPress={() => router.push("/home" as Href)} />
    </BthwaniSurface>;
  }
  return <View style={styles.list} accessibilityLabel="سلال العميل المفتوحة">
    <Text style={styles.muted}>سلالك المفتوحة؛ لا يُنشأ طلب إلا بعد إتمام الشراء.</Text>
    {state.carts.map((cart) => {
      const sameCity = Boolean(selectedCityID) && cart.serviceCityId === selectedCityID;
      const available = sameCity && cart.publicationState === "published";
      const hint = !sameCity ? "اختر مدينة المتجر للمتابعة" : "المتجر غير متاح للشراء حاليًا";
      return <Pressable key={cart.cartId} accessibilityRole="button"
        accessibilityLabel={`سلة ${cart.storeName}، ${cart.lineCount} منتجات`}
        accessibilityHint={available ? "متابعة السلة" : hint}
        accessibilityState={{ disabled: !available }}
        disabled={!available}
        onPress={() => router.push(`/cart/${encodeURIComponent(cart.storeId)}` as Href)}
        style={styles.cart}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.title}>{cart.storeName}</Text>
            <Text style={styles.muted}>{cart.lineCount} {cart.lineCount === 1 ? "منتج" : "منتجات"} · آخر تحديث {formatOrderDate(cart.updatedAt)}</Text>
          </View>
          <BthwaniIcon name={available ? "forward" : "warning"} color={available ? theme.interactiveText : theme.colorMuted} size={22} />
        </View>
        {!available ? <Text style={styles.unavailable}>{hint}</Text> : null}
      </Pressable>;
    })}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    list: { gap: spacing[3] },
    state: { alignItems: "center", borderRadius: radius.xl, gap: spacing[3], padding: spacing[5] },
    cart: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, backgroundColor: theme.surface, gap: spacing[2], padding: spacing[4] },
    row: { alignItems: "center", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    copy: { flex: 1, gap: spacing[1] },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    unavailable: { ...typography.caption, color: theme.warning },
  });
}
