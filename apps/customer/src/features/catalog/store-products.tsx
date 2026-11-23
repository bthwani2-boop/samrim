import type { PublicOffer, PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { formatExactYer } from "../../components/format-exact-yer";
import { summarizeCartPreview } from "../cart/cart-preview";
import type { useStoreCart } from "../cart/use-store-cart";
import ProductDetail from "./product-detail";

type StoreCart = ReturnType<typeof useStoreCart>;

export default function StoreProducts({ offers, store, session }: Readonly<{
  offers: readonly PublicOffer[];
  store: PublicStore;
  session: StoreCart;
}>) {
  // A verified draft Cart can be edited even while checkout is unavailable.
  // A known pause or closed schedule still disables additions on this surface.
  const canAdjust = session.cart !== null &&
    store.orderabilityStatus !== "PAUSED" && store.orderabilityStatus !== "CLOSED_BY_SCHEDULE";
  const linesByOffer = new Map(session.cart?.lines.map(line => [line.offerId, line]));
  return <>{offers.map(offer => {
    const line = linesByOffer.get(offer.id);
    const matches = !line || line.variantId === offer.variantId;
    return <ProductDetail key={offer.id}
      offer={matches && line?.previewAvailable ? { ...offer, priceYer: line.previewUnitYer } : offer}
      quantity={matches ? line?.quantity ?? 0 : 0}
      disabled={session.busy || session.pending}
      {...(canAdjust && offer.available && matches ? { onAdjust: (direction: -1 | 1) => session.adjust(offer, direction) } : {})} />;
  })}</>;
}

export function StoreCartBar({ storeId, session }: Readonly<{ storeId: string; session: StoreCart }>) {
  const { theme } = useMobileAppearance();
  const { cart, confirm, busy, message } = session;
  if (!(cart?.lines.length || confirm || message)) return null;
  const summary = cart && summarizeCartPreview(cart.lines);
  return <View testID="store-cart-bar" style={{ paddingHorizontal: 18, paddingVertical: 10, borderTopWidth: 1,
    borderColor: theme.borderColor, backgroundColor: theme.surface, gap: 8 }}>
    {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
    {confirm ? <Pressable accessibilityRole="button" disabled={busy} onPress={confirm}
      style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ التحقق…" : "تحقق من آخر تعديل"}</Text>
    </Pressable> : null}
    {cart && (cart.lines.length > 0 || confirm) ? (
      <Link href={{ pathname: "/cart/[storeId]", params: { storeId } }} asChild>
        <Pressable accessibilityRole="link" style={{ minHeight: 48, padding: 12, flexDirection: "row", flexWrap: "wrap",
          alignItems: "center", justifyContent: "space-between", backgroundColor: theme.actionBackground, borderRadius: 10, gap: 6 }}>
          <Text style={{ color: theme.onAction, fontWeight: "700" }}>مراجعة السلة</Text>
          {summary && cart.lines.length > 0 ? <Text style={{ color: theme.onAction }}>
            {summary.unavailableLines === 0
              ? `${formatExactYer(summary.availableSubtotalYer)} ريال يمني`
              : "راجع توفر المنتجات"}
          </Text> : null}
        </Pressable>
      </Link>
    ) : null}
  </View>;
}
