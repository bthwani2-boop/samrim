import { type CustomerCart, type CustomerCartChange, DshCartError, type PublicOffer } from "@bthwani/dsh";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { pendingCartChange } from "./cart-session";
import { readVerifiedCart, replaceVerifiedCart } from "./cart-transport";

export function useStoreCart(storeId: string | undefined) {
  const [snapshot, setSnapshot] = useState<CustomerCart | null>(null);
  const currentCart = useRef<CustomerCart | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  const [revision, setRevision] = useState(0);
  const cart = snapshot?.storeId === storeId ? snapshot : null;
  const pending = cart && pendingCartChange(cart.actorId, cart.storeId);

  useEffect(() => {
    const reload = () => refresh.current?.();
    if (Platform.OS === "web") {
      window.addEventListener("focus", reload);
      return () => window.removeEventListener("focus", reload);
    }
    const listener = AppState.addEventListener("change", status => {
      if (status === "active") reload();
    });
    return () => listener.remove();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a conflict or session change requires a fresh owner read.
  useFocusEffect(useCallback(() => {
    currentCart.current = null;
    setSnapshot(null);
    if (!storeId) return;
    const currentStoreId = storeId;
    function load() {
      read.current?.abort();
      request.current?.abort();
      request.current = null;
      currentCart.current = null;
      setSnapshot(null);
      setBusy(false);
      const controller = new AbortController();
      read.current = controller;
      void readVerifiedCart(currentStoreId, controller.signal).then(result => {
        if (!controller.signal.aborted && result.kind === "ready" && result.cart.storeId === storeId) {
          currentCart.current = result.cart;
          setSnapshot(result.cart);
        }
      }).catch(() => {}).finally(() => {
        if (read.current === controller) read.current = null;
      });
    }
    refresh.current = load;
    load();
    return () => {
      refresh.current = null;
      read.current?.abort();
      read.current = null;
      request.current?.abort();
      request.current = null;
      currentCart.current = null;
      setSnapshot(null);
      setBusy(false);
    };
  }, [storeId, revision]));

  async function send(change: CustomerCartChange) {
    if (!cart || currentCart.current !== cart || request.current || read.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const result = await replaceVerifiedCart(cart.storeId, change, cart.actorId, controller.signal);
      if (!controller.signal.aborted) {
        currentCart.current = result.cart;
        setSnapshot(result.cart);
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      const code = reason instanceof DshCartError ? reason.code : undefined;
      switch (code) {
        case "UNAUTHORIZED":
          currentCart.current = null;
          setSnapshot(null);
          setMessage("تغيّر الحساب. جارٍ التحقق من السلة الحالية.");
          setRevision(value => value + 1);
          break;
        case "CART_VERSION_OR_OPERATION_CONFLICT":
          currentCart.current = null;
          setSnapshot(null);
          setMessage("تغيّرت السلة. جارٍ تحديثها من DSH.");
          setRevision(value => value + 1);
          break;
        case "STORE_OR_OFFER_NOT_AVAILABLE":
          setMessage("المنتج أو الكمية المطلوبة غير متاحة الآن.");
          break;
        default:
          setMessage(pendingCartChange(cart.actorId, cart.storeId)
            ? "لم تتأكد نتيجة التعديل. تحقّق منها قبل تعديل السلة مرة أخرى."
            : "تعذّر تحديث السلة. حاول مجددًا.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  function adjust(offer: PublicOffer, direction: -1 | 1) {
    if (!cart || currentCart.current !== cart || request.current || read.current || offer.storeId !== cart.storeId || !offer.available ||
      pendingCartChange(cart.actorId, cart.storeId)) return;
    const line = cart.lines.find(item => item.offerId === offer.id);
    if (line && line.variantId !== offer.variantId) return;
    const quantity = (line?.quantity ?? 0) + direction;
    if (quantity < 0) return;
    if (quantity > 2147483647 || (!line && cart.lines.length >= 20)) {
      setMessage("وصلت إلى الحد المسموح في سلة المتجر.");
      return;
    }
    const lines = cart.lines.filter(item => item.offerId !== offer.id)
      .map(item => ({ offerId: item.offerId, quantity: item.quantity }));
    if (quantity > 0) lines.push({ offerId: offer.id, quantity });
    void send({ operationId: `cart-${randomUUID()}`, expectedVersion: cart.version, lines });
  }

  return {
    cart, busy, message, adjust, pending: Boolean(pending),
    confirm: pending ? () => void send(pending) : undefined,
  };
}
