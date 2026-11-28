import { type CustomerCart, type CustomerCartChange, DshCartError, type PublicOffer } from "@bthwani/dsh";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { pendingCartChange } from "./cart-session";
import { readVerifiedCart, replaceVerifiedCart } from "./cart-transport";

type CartView = Readonly<{
  storeId: string | undefined;
  status: "idle" | "loading" | "ready" | "signed-out" | "unavailable";
  cart: CustomerCart | null;
  busy: boolean;
  message: string;
}>;

function emptyView(storeId: string | undefined, status: CartView["status"], message = ""): CartView {
  return { storeId, status, cart: null, busy: false, message };
}

export function useStoreCart(storeId: string | undefined) {
  const [snapshot, setSnapshot] = useState<CartView>(emptyView(storeId, storeId ? "loading" : "idle"));
  const current = useRef<CartView>(snapshot);
  const request = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  const refresh = useRef<((message?: string) => void) | null>(null);
  const view = snapshot.storeId === storeId ? snapshot : emptyView(storeId, storeId ? "loading" : "idle");
  const { cart, status, busy, message } = view;
  const pending = cart && pendingCartChange(cart.actorId, cart.storeId);

  const publish = useCallback((next: CartView) => {
    current.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    const reload = () => refresh.current?.();
    if (Platform.OS === "web") {
      window.addEventListener("focus", reload);
      return () => window.removeEventListener("focus", reload);
    }
    const listener = AppState.addEventListener("change", value => {
      if (value === "active") reload();
    });
    return () => listener.remove();
  }, []);

  useFocusEffect(useCallback(() => {
    if (!storeId) {
      publish(emptyView(undefined, "idle"));
      return;
    }
    const currentStoreId = storeId;
    function load(message = "") {
      read.current?.abort();
      request.current?.abort();
      request.current = null;
      const controller = new AbortController();
      read.current = controller;
      publish(emptyView(currentStoreId, "loading", message));
      void readVerifiedCart(currentStoreId, controller.signal).then(result => {
        if (controller.signal.aborted || read.current !== controller) return;
        if (result.kind === "ready" && result.cart.storeId === currentStoreId) {
          publish({ ...emptyView(currentStoreId, "ready"), cart: result.cart });
        } else {
          publish(emptyView(currentStoreId, result.kind === "signed-out" ? "signed-out" : "unavailable"));
        }
      }).catch(() => {
        if (!controller.signal.aborted && read.current === controller)
          publish(emptyView(currentStoreId, "unavailable"));
      }).finally(() => {
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
      publish(emptyView(currentStoreId, "idle"));
    };
  }, [storeId, publish]));

  async function send(change: CustomerCartChange) {
    if (!cart || current.current !== view || request.current || read.current) return;
    const controller = new AbortController();
    request.current = controller;
    const sending = { ...view, busy: true, message: "" };
    publish(sending);
    try {
      const result = await replaceVerifiedCart(cart.storeId, change, cart.actorId, controller.signal);
      if (!controller.signal.aborted && request.current === controller) {
        publish({ ...sending, cart: result.cart, busy: false });
      }
    } catch (reason) {
      if (controller.signal.aborted || request.current !== controller) return;
      const code = reason instanceof DshCartError ? reason.code : undefined;
      switch (code) {
        case "UNAUTHORIZED":
          refresh.current?.("تغيّر الحساب. جارٍ التحقق من السلة الحالية.");
          break;
        case "CART_VERSION_OR_OPERATION_CONFLICT":
          refresh.current?.("تغيّرت السلة. جارٍ تحديثها من DSH.");
          break;
        case "STORE_OR_OFFER_NOT_AVAILABLE":
          publish(emptyView(cart.storeId, "unavailable", "المنتج أو الكمية المطلوبة غير متاحة الآن."));
          break;
        default:
          publish({ ...sending, busy: false, message: pendingCartChange(cart.actorId, cart.storeId)
            ? "لم تتأكد نتيجة التعديل. تحقّق منها قبل تعديل السلة مرة أخرى."
            : "تعذّر تحديث السلة. حاول مجددًا." });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function adjust(offer: PublicOffer, direction: -1 | 1) {
    if (!cart || current.current !== view || request.current || read.current || offer.storeId !== cart.storeId || !offer.available ||
      pendingCartChange(cart.actorId, cart.storeId)) return;
    const line = cart.lines.find(item => item.offerId === offer.id);
    if (line && line.variantId !== offer.variantId) return;
    const quantity = (line?.quantity ?? 0) + direction;
    if (quantity < 0) return;
    if (quantity > 2147483647 || (!line && cart.lines.length >= 20)) {
      publish({ ...view, message: "وصلت إلى الحد المسموح في سلة المتجر." });
      return;
    }
    const lines = cart.lines.filter(item => item.offerId !== offer.id)
      .map(item => ({ offerId: item.offerId, quantity: item.quantity }));
    if (quantity > 0) lines.push({ offerId: offer.id, quantity });
    void send({ operationId: `cart-${randomUUID()}`, expectedVersion: cart.version, lines });
  }

  return {
    status, cart, busy, message, adjust, pending: Boolean(pending),
    retry: status === "unavailable" ? () => {
      if (current.current === view && !request.current) refresh.current?.();
    } : undefined,
    confirm: pending ? () => void send(pending) : undefined,
  };
}
