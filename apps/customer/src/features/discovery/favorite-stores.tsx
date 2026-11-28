import { DshPublicError, getPublicStore, type PublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { resolvePublicStoreOrigin } from "../stores/public-store-origin";
import { readFavoriteStore, readFavoriteStores, verifyFavoriteSession, writeFavoriteStore } from "./favorite-stores-transport";

type Detail = { kind: "detail"; actor: string; storeId: string; favorite: boolean; expiresAt: number };
type Page = { kind: "list"; actor: string; items: PublicStore[]; next?: string | undefined; expiresAt: number };
type ReadState = Detail | Page;

// One admission rule for publishing, rendering and acting on private owner proof.
// Timers schedule revalidation; they are not evidence that a view is still valid.
function isLiveFavoriteView(view: ReadState | null): view is ReadState {
  return view !== null && Number.isFinite(view.expiresAt) && view.expiresAt > Date.now();
}

async function publicDetails(ids: readonly string[], signal: AbortSignal): Promise<PublicStore[]> {
  const origin = resolvePublicStoreOrigin();
  const rows = await Promise.all(ids.map(async id => {
    try { return await getPublicStore(origin, id, signal); }
    catch (error) { if (error instanceof DshPublicError && error.status === 404) return null; throw error; }
  }));
  signal.throwIfAborted();
  return rows.filter((row): row is PublicStore => row !== null);
}

export default function FavoriteStores({ storeId }: Readonly<{ storeId?: string }>) {
  const { theme } = useMobileAppearance();
  const [view, setView] = useState<ReadState | null>(null);
  // Invalidate superseded callbacks synchronously, before React renders the next confirmed view.
  const currentView = useRef<ReadState | null>(null);
  const publishView = useCallback((next: ReadState | null) => {
    if (next !== null && !isLiveFavoriteView(next)) throw new Error("FAVORITE_VIEW_EXPIRED");
    currentView.current = next;
    setView(next);
  }, []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const scope = useRef<AbortController | null>(null);
  const action = useRef<AbortController | null>(null);
  const expires = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => {
    scope.current?.abort();
    scope.current = null;
    action.current?.abort();
    action.current = null;
    clearTimeout(expires.current);
    publishView(null);
    setBusy(false);
  }, [publishView]);
  const reload = useCallback(() => { clear(); setRetry(v => v + 1); }, [clear]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately re-reads the current actor's owner state.
  useFocusEffect(useCallback(() => {
    clear();
    setMessage("");
    const controller = new AbortController();
    scope.current = controller;
    async function read() {
      if (storeId !== undefined) {
        const result = await readFavoriteStore(controller.signal, storeId);
        if (!controller.signal.aborted) publishView({
          kind: "detail", actor: result.value.actorId, storeId, favorite: result.value.favorite, expiresAt: result.expiresAt,
        });
      } else {
        const result = await readFavoriteStores(controller.signal);
        const items = await publicDetails(result.value.storeIds, controller.signal);
        const session = await verifyFavoriteSession(controller.signal, result.value.actorId);
        if (!controller.signal.aborted) publishView({
          kind: "list", actor: result.value.actorId, items,
          ...(result.value.nextCursor ? { next: result.value.nextCursor } : {}),
          expiresAt: Math.min(result.expiresAt, Date.parse(session.sessionExpiresAt)),
        });
      }
    }
    void read().catch(() => {
      if (!controller.signal.aborted) setMessage("سجّل الدخول أو أعد المحاولة للتحقق من المفضلة.");
    });
    return clear;
  }, [storeId, retry, clear, publishView]));

  useEffect(() => {
    if (Platform.OS === "web") {
      const visibility = () => { if (document.visibilityState === "hidden") clear(); else reload(); };
      window.addEventListener("blur", clear);
      window.addEventListener("focus", reload);
      document.addEventListener("visibilitychange", visibility);
      return () => {
        window.removeEventListener("blur", clear);
        window.removeEventListener("focus", reload);
        document.removeEventListener("visibilitychange", visibility);
      };
    }
    const sub = AppState.addEventListener("change", state => { if (state === "active") reload(); else clear(); });
    return () => sub.remove();
  }, [clear, reload]);

  useEffect(() => {
    if (!view) return;
    clearTimeout(expires.current);
    const controller = scope.current;
    const ownsView = () => controller !== null && !controller.signal.aborted &&
      scope.current === controller && currentView.current === view;
    expires.current = setTimeout(() => { if (ownsView()) reload(); },
      Math.max(0, Math.min(2147483647, view.expiresAt - Date.now())));
    let checking = false;
    const timer = setInterval(() => {
      if (!controller || !ownsView()) return;
      if (!isLiveFavoriteView(view)) { reload(); return; }
      if (checking || action.current) return;
      checking = true;
      void verifyFavoriteSession(controller.signal, view.actor).catch(() => {
        if (ownsView()) { clear(); setMessage("تغيّرت الجلسة؛ أعد التحقق من المفضلة."); }
      }).finally(() => { checking = false; });
    }, 15000);
    return () => { clearInterval(timer); clearTimeout(expires.current); };
  }, [view, reload, clear]);

  const renderedScope = scope.current;
  function isCurrentScope() {
    return renderedScope !== null && scope.current === renderedScope && !renderedScope.signal.aborted &&
      currentView.current === view && isLiveFavoriteView(view);
  }

  async function changeFavorite(id: string, favorite: boolean) {
    if (!isCurrentScope() || !view || action.current) return;
    if (view.kind === "detail" ? view.storeId !== storeId || view.storeId !== id || favorite === view.favorite :
      storeId !== undefined || favorite || !view.items.some(item => item.id === id)) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const result = await writeFavoriteStore(controller.signal, view.actor, id, favorite);
      if (controller.signal.aborted) return;
      if (result.value.actorId !== view.actor || result.value.storeId !== id || result.value.favorite !== favorite ||
        !(result.expiresAt > Date.now())) throw new Error("FAVORITE_RECEIPT_UNCONFIRMED");
      const expiresAt = Math.min(view.expiresAt, result.expiresAt);
      publishView(view.kind === "detail" ? { ...view, favorite, expiresAt } :
        { ...view, items: view.items.filter(item => item.id !== id), expiresAt });
    } catch (error) {
      if (!controller.signal.aborted) {
        clear();
        setMessage(error instanceof Error && error.message === "FAVORITE_VIEW_EXPIRED"
          ? "انتهت صلاحية التحقق من المفضلة. أعد قراءتها قبل تعديل جديد."
          : "لم تتأكد نتيجة التغيير. أعد قراءة المفضلة قبل تعديل جديد.");
      }
    } finally {
      if (action.current === controller) { action.current = null; setBusy(false); }
    }
  }

  async function more() {
    if (!isCurrentScope() || view?.kind !== "list" || !view.next || action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    try {
      const result = await readFavoriteStores(controller.signal, view.actor, view.next);
      const items = await publicDetails(result.value.storeIds, controller.signal);
      const session = await verifyFavoriteSession(controller.signal, view.actor);
      if (!controller.signal.aborted) publishView({
        ...view, items: [...view.items, ...items],
        ...(result.value.nextCursor ? { next: result.value.nextCursor } : { next: undefined }),
        expiresAt: Math.min(view.expiresAt, result.expiresAt, Date.parse(session.sessionExpiresAt)),
      });
    } catch {
      if (!controller.signal.aborted) { clear(); setMessage("تعذّر قراءة المفضلة. أعد المحاولة."); }
    } finally {
      if (action.current === controller) { action.current = null; setBusy(false); }
    }
  }

  const visible = isLiveFavoriteView(view) && currentView.current === view &&
    (view.kind === "detail" ? view.storeId === storeId : storeId === undefined) ? view : null;
  const button = { minHeight: 44, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10, padding: 12, justifyContent: "center" as const };
  return <View testID={storeId ? "favorite-store-action" : "favorite-store-list"} style={{ gap: 8 }}>
    {storeId === undefined ? <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700" }}>المتاجر المفضلة</Text> : null}
    {visible?.kind === "detail" ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, selected: visible.favorite }}
      accessibilityLabel={visible.favorite ? "إزالة المتجر من المفضلة" : "إضافة المتجر إلى المفضلة"} disabled={busy} onPress={() => void changeFavorite(visible.storeId, !visible.favorite)} style={button}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ التحقق…" : visible.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}</Text>
    </Pressable> : null}
    {visible?.kind === "list" ? <>
      {!visible.items.length && !visible.next ? <Text style={{ color: theme.colorSecondary }}>لا توجد متاجر مفضلة متاحة.</Text> : null}
      {visible.items.map(item => <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Link href={{ pathname: "/storefront/[storeId]", params: { storeId: item.id } }} asChild>
          <Pressable accessibilityRole="link" style={{ ...button, flex: 1 }}><Text style={{ color: theme.color }}>{item.name}</Text></Pressable>
        </Link>
        <Pressable accessibilityRole="button" accessibilityLabel={"إزالة " + item.name + " من المفضلة"} disabled={busy}
          onPress={() => void changeFavorite(item.id, false)} style={button}>
          <Text style={{ color: theme.interactiveText }}>إزالة</Text>
        </Pressable>
      </View>)}
      {visible.next ? <Pressable accessibilityRole="button" accessibilityLabel="عرض المزيد" disabled={busy} onPress={() => void more()} style={button}>
        <Text style={{ color: theme.interactiveText }}>عرض المزيد</Text>
      </Pressable> : null}
    </> : null}
    {message ? <><Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={reload} style={button}><Text style={{ color: theme.interactiveText }}>إعادة التحقق من المفضلة</Text></Pressable></> : null}
    {!visible && !message ? <Text style={{ color: theme.colorSecondary }}>جارٍ التحقق من المفضلة…</Text> : null}
  </View>;
}
