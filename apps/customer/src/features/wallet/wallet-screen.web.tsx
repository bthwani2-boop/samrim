import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { formatExactYer } from "../../components/format-exact-yer";
import { readCustomerAdmission } from "../access/customer-session-transport";
import { readVerifiedWallet, readVerifiedWalletTransactions, type WalletReadState, type WalletTransactionsReadState } from "./wallet-read.web";


export default function WalletScreen() {
  const { theme } = useMobileAppearance();
  const [state, setState] = useState<WalletReadState | null>(null);
  const [history, setHistory] = useState<WalletTransactionsReadState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const loadMoreController = useRef<AbortController | null>(null);
  const scheduleExpiry = useRef<((at: number) => void) | null>(null);
  const refreshBalance = useRef<(() => void) | null>(null);
  const refreshing = useRef(false);

  useFocusEffect(useCallback(() => {
    let pending: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let actor: string | undefined;
    function hide() {
      pending?.abort();
      pending = undefined;
      refreshing.current = false;
      actor = undefined;
      loadMoreController.current?.abort();
      loadMoreController.current = null;
      clearTimeout(expiry);
      setLoadingMore(false);
      setMoreError(false);
      setState(null);
      setHistory(null);
    }
    function expire() {
      hide();
      setState({ kind: "signed-out" });
    }
    function schedule(at: number) {
      clearTimeout(expiry);
      expiry = setTimeout(expire, Math.max(0, at - Date.now()));
    }
    scheduleExpiry.current = schedule;
    function refresh(silent = false) {
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        hide();
        return;
      }
      if (silent && (pending || loadMoreController.current)) return;
      if (!silent) hide();
      const previousActor = actor;
      const controller = new AbortController();
      pending = controller;
      refreshing.current = true;
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
      function unavailable() {
        if (pending !== controller || controller.signal.aborted) return;
        hide();
        setState({ kind: "unavailable" });
      }
      deadline.addEventListener("abort", unavailable, { once: true });
      void (async () => {
        try {
          const result = await readVerifiedWallet(readCustomerAdmission, deadline);
          if (deadline.aborted || pending !== controller) return;
          if (result.kind !== "ready") {
            hide();
            setState(result);
            return;
          }
          if ((previousActor && previousActor !== result.balance.actorId) || result.expiresAt <= Date.now()) {
            expire();
            return;
          }
          // Do not extend a previously verified display until the new history
          // and balance both belong to the same current Customer.
          if (!previousActor) {
            actor = result.balance.actorId;
            setState(result);
            schedule(result.expiresAt);
          }
          const historyResult = await readVerifiedWalletTransactions(readCustomerAdmission, deadline, undefined, result.balance.actorId);
          if (deadline.aborted || pending !== controller) return;
          if (historyResult.kind === "signed-out" ||
              (historyResult.kind === "ready" && historyResult.history.actorId !== result.balance.actorId)) {
            expire();
            return;
          }
          const expiresAt = historyResult.kind === "ready"
            ? Math.min(result.expiresAt, historyResult.expiresAt) : result.expiresAt;
          if (expiresAt <= Date.now()) { expire(); return; }
          actor = result.balance.actorId;
          setState(result);
          setHistory(historyResult);
          schedule(expiresAt);
        } catch {
          unavailable();
        } finally {
          deadline.removeEventListener("abort", unavailable);
          if (pending === controller) {
            pending = undefined;
            refreshing.current = false;
          }
        }
      })();
    }
    const refreshVisible = () => refresh();
    refreshBalance.current = refreshVisible;
    refresh();
    const interval = setInterval(() => refresh(true), 30_000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("blur", hide);
    return () => {
      refreshBalance.current = null;
      scheduleExpiry.current = null;
      hide();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("blur", hide);
    };
  }, []));

  async function loadMore() {
    if (state?.kind !== "ready" || history?.kind !== "ready" ||
      loadMoreController.current || refreshing.current) return;
    const cursor = history.history.nextCursor;
    if (!cursor) return;
    const previous = history.history;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
      const next = await readVerifiedWalletTransactions(readCustomerAdmission, deadline, cursor, state.balance.actorId);
      if (controller.signal.aborted) return;
      if (next.kind === "signed-out") {
        setState({ kind: "signed-out" });
        setHistory(null);
        return;
      }
      if (next.kind !== "ready" || next.history.actorId !== previous.actorId ||
        (next.history.nextCursor !== null && next.history.nextCursor === cursor)) {
        setMoreError(true);
        return;
      }
      const ids = new Set(previous.items.map(item => item.fundingId));
      if (next.history.items.some(item => ids.has(item.fundingId))) {
        setMoreError(true);
        return;
      }
      setHistory(current => {
        if (current?.kind !== "ready" || current.history.actorId !== previous.actorId ||
          current.history.nextCursor !== cursor) return current;
        return {
          kind: "ready",
          history: {
            ...next.history,
            items: [...current.history.items, ...next.history.items],
          },
          expiresAt: Math.min(current.expiresAt, next.expiresAt),
        };
      });
      scheduleExpiry.current?.(Math.min(state.expiresAt, history.expiresAt, next.expiresAt));
    } catch {
      if (!controller.signal.aborted) setMoreError(true);
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadingMore(false);
      }
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>المحفظة</Text>
        <View style={{ padding: 20, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.surface }}>
          {state?.kind === "ready" ? (
            <>
              <Text style={{ color: theme.colorSecondary }}>الرصيد المسجّل في البيئة التجريبية</Text>
              <Text testID="wallet-balance" style={{ color: theme.color, fontSize: 30, fontWeight: "700" }}>
                {formatExactYer(BigInt(state.balance.balanceYer))} ريال يمني
              </Text>
              <Text testID="wallet-available" style={{ color: theme.colorSecondary }}>
                المتاح بعد الحجوزات: {formatExactYer(BigInt(state.balance.availableYer))} ريال يمني
              </Text>
            </>
          ) : (
            <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
              {state?.kind === "signed-out" ? "سجّل الدخول بحساب العميل لعرض رصيدك."
                : state?.kind === "unavailable" ? "تعذّر التحقق من الرصيد لدى خدمة المحفظة."
                  : "جارٍ التحقق من الرصيد…"}
            </Text>
          )}
        </View>
        {state?.kind === "ready" ? (
          <View style={{ padding: 20, gap: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.surface }}>
            <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>
              آخر عمليات التمويل المنشورة
            </Text>
            {history?.kind === "ready" ? (
              <>
                {history.history.items.length === 0 ? (
                  <Text style={{ color: theme.colorSecondary }}>لا توجد عمليات تمويل منشورة حتى الآن.</Text>
                ) : history.history.items.map(item => (
                  <View key={item.fundingId} style={{ gap: 4, paddingVertical: 6 }}>
                    <Text style={{ color: theme.color }}>
                      {item.reversesFundingId ? "عكس تمويل −" : "+"} {formatExactYer(BigInt(item.amountYer))} ريال يمني
                    </Text>
                    <Text style={{ color: theme.colorSecondary }}>{new Date(item.postedAt).toLocaleDateString("ar-YE")}</Text>
                  </View>
                ))}
                {history.history.hasMore ? (
                  <>
                    <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()}>
                      <Text style={{ color: theme.interactiveText }}>
                        {loadingMore ? "جارٍ تحميل العمليات الأقدم…" : "عرض المزيد من العمليات"}
                      </Text>
                    </Pressable>
                    {moreError ? (
                      <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
                        تعذر تحميل المزيد من العمليات. يمكنك إعادة المحاولة.
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
                {history?.kind === "unavailable" ? "تعذر تحميل سجل العمليات حاليًا." : "جارٍ التحقق من سجل العمليات."}
              </Text>
            )}
          </View>
        ) : null}
        {state?.kind === "signed-out" ? (
          <Link href={{ pathname: "/login", params: { returnTo: "/wallet" } }} style={{ color: theme.interactiveText }}>تسجيل الدخول إلى المحفظة</Link>
        ) : state?.kind === "unavailable" || history?.kind === "unavailable" ? (
          <Pressable accessibilityRole="button" onPress={() => refreshBalance.current?.()}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={{ color: theme.interactiveText }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
