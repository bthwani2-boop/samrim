import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { readCustomerAdmission } from "../access/customer-session-transport";
import { readVerifiedWallet, readVerifiedWalletTransactions, type WalletReadState, type WalletTransactionsReadState } from "./wallet-read.web";

const displayYER = new Intl.NumberFormat("ar-YE");

export default function WalletScreen() {
  const { theme } = useMobileAppearance();
  const [state, setState] = useState<WalletReadState | null>(null);
  const [history, setHistory] = useState<WalletTransactionsReadState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const loadMoreController = useRef<AbortController | null>(null);
  const scheduleExpiry = useRef<((at: number) => void) | null>(null);
  const refreshBalance = useRef<(() => void) | null>(null);

  useFocusEffect(useCallback(() => {
    let pending: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function expire() {
      pending?.abort();
      loadMoreController.current?.abort();
      setState({ kind: "signed-out" });
      setHistory(null);
    }
    function schedule(at: number) {
      clearTimeout(expiry);
      expiry = setTimeout(expire, Math.max(0, at - Date.now()));
    }
    scheduleExpiry.current = schedule;
    function hide() {
      pending?.abort();
      loadMoreController.current?.abort();
      loadMoreController.current = null;
      clearTimeout(expiry);
      setLoadingMore(false);
      setMoreError(false);
      setState(null);
      setHistory(null);
    }
    function refresh() {
      hide();
      if (document.visibilityState === "hidden" || !document.hasFocus()) return;
      const controller = new AbortController();
      pending = controller;
      const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
      void readVerifiedWallet(readCustomerAdmission, deadline).then(result => {
        if (controller.signal.aborted) return;
        if (deadline.aborted) {
          setState({ kind: "unavailable" });
          return;
        }
        setState(result);
        if (result.kind === "ready") {
          schedule(result.expiresAt);
          void readVerifiedWalletTransactions(readCustomerAdmission, deadline, undefined, result.balance.actorId).then(historyResult => {
            if (controller.signal.aborted || deadline.aborted) return;
            if (historyResult.kind === "signed-out") {
              expire();
              return;
            }
            setHistory(historyResult);
            if (historyResult.kind === "ready") {
              schedule(Math.min(result.expiresAt, historyResult.expiresAt));
            }
          }).catch(() => {
            if (!controller.signal.aborted) setHistory({ kind: "unavailable" });
          });
        }
      }).catch(() => {
        if (!controller.signal.aborted) setState({ kind: "unavailable" });
      });
    }
    refreshBalance.current = refresh;
    refresh();
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", hide);
    return () => {
      refreshBalance.current = null;
      scheduleExpiry.current = null;
      loadMoreController.current?.abort();
      pending?.abort();
      clearTimeout(expiry);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", hide);
    };
  }, []));

  async function loadMore() {
    if (state?.kind !== "ready" || history?.kind !== "ready" ||
      loadMoreController.current) return;
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
      if (next.kind !== "ready" || next.history.actorId !== previous.actorId) {
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
      scheduleExpiry.current?.(Math.min(history.expiresAt, next.expiresAt));
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
                {displayYER.format(BigInt(state.balance.balanceYer))} ريال يمني
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
                      {item.reversesFundingId ? "عكس تمويل −" : "+"} {displayYER.format(BigInt(item.amountYer))} ريال يمني
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
          <Link href="/account" style={{ color: theme.interactiveText }}>انتقال إلى الحساب</Link>
        ) : state ? (
          <Pressable accessibilityRole="button" onPress={() => refreshBalance.current?.()}>
            <Text style={{ color: theme.interactiveText }}>تحديث الرصيد</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={{ color: theme.interactiveText }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
