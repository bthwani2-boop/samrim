import type { CatalogStoreOffer, PublicDiscoveryContentView } from "@bthwani/dsh";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState } from "../../bootstrap/identity";
import { addCatalogOfferToCart, readPublicStoreCatalog, resolvePublicDiscoveryContentTarget } from "./store-discovery-client";
import { StoreProductSheet } from "./store-product-sheet";

type Product = CatalogStoreOffer;
type ProductLoad = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; storeId: string; offers: ReadonlyArray<Product> };
type ProductProps = {
  content: PublicDiscoveryContentView | null;
  cityId: string;
  onClose: () => void;
  onOpenStore: (storeId: string, productId: string) => void;
  onGoToCart: (storeId: string) => void;
  onRequireLogin: (storeId: string, productId: string) => void;
};

function validSelections(offer: Product, selected: ReadonlyArray<string>): string {
  if (new Set(selected).size !== selected.length) return "توجد إضافة مكررة.";
  for (const group of offer.modifierGroups) {
    const options = group.options.filter(option => selected.includes(option.id));
    if (options.length < group.minSelections || options.length > group.maxSelections || options.some(option => !option.availability)) {
      return "اختر الإضافات المطلوبة والمتاحة لهذا المنتج.";
    }
  }
  return "";
}

/** Reuses the canonical store product sheet and DSH cart mutation.
 * Neither reel prices nor reel captions are accepted as commerce facts. */
export function DiscoveryReelShop({ content, cityId, onClose, onOpenStore, onGoToCart, onRequireLogin }: ProductProps) {
  const [load, setLoad] = useState<ProductLoad>({ kind: "loading" });
  const [offerId, setOfferId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!content || !cityId || content.targetType !== "PRODUCT") return;
    let alive = true;
    setLoad({ kind: "loading" });
    setOfferId("");
    setSelectedOptions([]);
    setAdded(false);
    setError("");
    void (async () => {
      try {
        const target = await resolvePublicDiscoveryContentTarget(content.id, cityId);
        if (target.targetType !== "PRODUCT" || !target.storeId || !target.targetId) {
          throw new Error("PRODUCT_TARGET_UNAVAILABLE");
        }
        const catalog = await readPublicStoreCatalog(target.storeId, cityId, "", "", 30, "", target.targetId);
        const offers = catalog.offers.filter(offer => offer.productId === target.targetId && offer.availability);
        if (!offers.length) throw new Error("PRODUCT_UNAVAILABLE");
        if (!alive) return;
        const first = offers[0]!;
        setLoad({ kind: "ready", storeId: target.storeId, offers });
        setOfferId(first.offerId);
        setQuantity(first.quantityMinBaseUnits);
      } catch {
        if (alive) setLoad({ kind: "error", message: "المنتج غير متاح للطلب حاليًا. يمكنك متابعة المشاهدة." });
      }
    })();
    return () => { alive = false; };
  }, [content?.id, content?.targetType, cityId]);

  if (!content) return null;
  if (load.kind !== "ready") {
    return <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.status}>
          <Text style={styles.message}>{load.kind === "loading" ? "جارٍ تحميل المنتج من المتجر…" : load.message}</Text>
          <Pressable accessibilityRole="button" style={styles.dismiss} onPress={onClose}>
            <Text style={styles.dismissText}>العودة للمشاهدة</Text>
          </Pressable>
        </View>
      </View>
    </Modal>;
  }
  const storeId = load.storeId;
  const offer = load.offers.find(item => item.offerId === offerId) ?? load.offers[0] ?? null;
  if (!offer) return null;

  const chooseOffer = (nextId: string) => {
    const next = load.offers.find(item => item.offerId === nextId);
    if (!next) return;
    setOfferId(next.offerId);
    setQuantity(next.quantityMinBaseUnits);
    setSelectedOptions([]);
    setError("");
    setAdded(false);
  };
  const toggleOption = (groupId: string, optionId: string, maxSelections: number) => {
    const group = offer.modifierGroups.find(item => item.id === groupId);
    const option = group?.options.find(item => item.id === optionId);
    if (!group || !option?.availability) return;
    setSelectedOptions(current => {
      if (current.includes(optionId)) return current.filter(id => id !== optionId);
      const other = new Set(group.options.map(item => item.id));
      const existing = current.filter(id => other.has(id));
      if (existing.length >= maxSelections) return current;
      return [...current, optionId];
    });
    setError("");
    setAdded(false);
  };
  const add = async () => {
    if (busy) return;
    if (currentIdentityState().kind !== "authenticated") {
      onRequireLogin(storeId, offer.productId);
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity < offer.quantityMinBaseUnits || quantity > offer.quantityMaxBaseUnits ||
      (quantity - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits !== 0) {
      setError("اختر كمية صحيحة.");
      return;
    }
    const selectionError = validSelections(offer, selectedOptions);
    if (selectionError) { setError(selectionError); return; }
    setBusy(true);
    setError("");
    setAdded(false);
    try {
      await addCatalogOfferToCart(storeId, offer, quantity, selectedOptions);
      setAdded(true);
    } catch {
      setError("تعذر إضافة المنتج. تحقق من التوفر أو حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  return <StoreProductSheet
    offer={offer}
    galleryOffers={load.offers}
    onBrowseOffer={chooseOffer}
    isFavorite={() => false}
    favoriteBusy={false}
    onToggleFavorite={() => onOpenStore(storeId, offer.productId)}
    onShareOffer={() => onOpenStore(storeId, offer.productId)}
    onQuickAdd={chooseOffer}
    presentation="quick"
    onShopOtherStore={() => onOpenStore(storeId, offer.productId)}
    quantityBaseUnits={quantity}
    selectedOptionIds={selectedOptions}
    busy={busy}
    added={added}
    fulfillmentSelected={true}
    orderingUnavailableMessage=""
    error={error}
    onQuantityChange={setQuantity}
    onToggleModifier={toggleOption}
    onAdd={() => { void add(); }}
    onClose={onClose}
    onGoToCart={() => onGoToCart(storeId)}
  />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0009", alignItems: "center", justifyContent: "flex-end" },
  status: { width: "100%", minHeight: 160, gap: 16, padding: 24, paddingBottom: 44, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: "#11131a" },
  message: { color: "#fff", fontSize: 16, textAlign: "right" },
  dismiss: { minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dismissText: { fontWeight: "700", color: "#11131a" },
});
