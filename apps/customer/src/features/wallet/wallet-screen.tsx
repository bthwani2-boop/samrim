import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  type NativeWalletHistoryRead, type NativeWalletRead,
  readNativeWallet, readNativeWalletTransactions,
} from "./wallet-read";

const displayYER = new Intl.NumberFormat("ar-YE");

// Android read-only wallet: Identity is verified on each owner read and WLT
// remains the only money writer. No Cash-In/payment mutation is exposed.
export default function WalletScreen() {
  const { theme } = useMobileAppearance();
  const [balance, setBalance] = useState<NativeWalletRead | null>(null);
  const [history, setHistory] = useState<NativeWalletHistoryRead | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const morePending = useRef<AbortController | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const scheduleExpiryRef = useRef<((expiresAt: number) => void) | null>(null);

  useFocusEffect(useCallback(() => {
    function hide() {
      generation.current++;
      pending.current?.abort();
      morePending.current?.abort();
      pending.current = null;
      morePending.current = null;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
      setBalance(null);
      setHistory(null);
      setLoadingMore(false);
      setMoreError(false);
    }
    function scheduleExpiry(expiresAt: number) {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => {
        hide();
        setBalance({ kind: "signed-out" });
      }, Math.max(0, expiresAt - Date.now()));
    }
    function refresh() {
      hide();
      if (AppState.currentState !== "active") return;
      const current = generation.current;
      const controller = new AbortController();
      pending.current = controller;
      void (async () => {
        try {
          const result = await readNativeWallet(controller.signal);
          if (controller.signal.aborted || generation.current !== current) return;
          setBalance(result);
          if (result.kind !== "ready") return;
          scheduleExpiry(result.expiresAt);
          const transactions = await readNativeWalletTransactions(controller.signal);
          if (controller.signal.aborted || generation.current !== current) return;
          if (transactions.kind === "signed-out") {
            hide();
            setBalance({ kind: "signed-out" });
            return;
          }
          if (transactions.kind === "ready") {
            if (transactions.history.actorId !== result.balance.actorId) {
              hide();
              setBalance({ kind: "signed-out" });
              return;
            }
            scheduleExpiry(Math.min(result.expiresAt, transactions.expiresAt));
          }
          setHistory(transactions);
        } catch {
          if (controller.signal.aborted || generation.current !== current) return;
          setBalance(previous => previous?.kind === "ready" ? previous : { kind: "unavailable" });
          setHistory({ kind: "unavailable" });
        }
      })();
    }
    scheduleExpiryRef.current = scheduleExpiry;
    refreshRef.current = refresh;
    const subscription = AppState.addEventListener("change", status => {
      if (status === "active") refresh();
      else hide();
    });
    refresh();
    return () => {
      refreshRef.current = null;
      scheduleExpiryRef.current = null;
      subscription.remove();
      hide();
    };
  }, []));

  async function loadMore() {
    if (balance?.kind !== "ready" || history?.kind !== "ready" ||
      !history.history.nextCursor || morePending.current) return;
    const cursor = history.history.nextCursor;
    const actorId = history.history.actorId;
    const current = generation.current;
    const controller = new AbortController();
    morePending.current = controller;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const next = await readNativeWalletTransactions(controller.signal, cursor);
      if (controller.signal.aborted || generation.current !== current) return;
      if (next.kind === "signed-out") {
        pending.current?.abort();
        setBalance({ kind: "signed-out" });
        setHistory(null);
        return;
      }
      if (next.kind !== "ready" || next.history.actorId !== actorId ||
        (next.history.nextCursor !== null && next.history.nextCursor === cursor)) {
        setMoreError(true);
        return;
      }
      const seen = new Set(history.history.items.map(item => item.fundingId));
      if (next.history.items.some(item => seen.has(item.fundingId))) {
        setMoreError(true);
        return;
      }
      setHistory(previous => {
        if (previous?.kind !== "ready" || previous.history.actorId !== actorId ||
          previous.history.nextCursor !== cursor) return previous;
        return { kind: "ready", history: {
          ...next.history, items: [...previous.history.items, ...next.history.items],
        }, expiresAt: Math.min(previous.expiresAt, next.expiresAt) };
      });
      scheduleExpiryRef.current?.(Math.min(balance.expiresAt, history.expiresAt, next.expiresAt));
    } catch {
      if (!controller.signal.aborted && generation.current === current) setMoreError(true);
    } finally {
      if (morePending.current === controller) {
        morePending.current = null;
        setLoadingMore(false);
      }
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, width: "100%", maxWidth: 720, alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>المحفظة</Text>
        <View style={{ padding: 20, gap: 8, borderRadius: 14, borderWidth: 1,
          borderColor: theme.borderColor, backgroundColor: theme.surface }}>
          {balance?.kind === "ready" ? (
            <>
              <Text style={{ color: theme.colorSecondary }}>رصيدك المتاح من التمويل المؤكد</Text>
              <Text testID="native-wallet-balance" style={{ color: theme.color, fontSize: 30, fontWeight: "700" }}>
                {displayYER.format(BigInt(balance.balance.balanceYer))} ريال يمني
              </Text>
            </>
          ) : (
            <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
              {balance?.kind === "signed-out" ? "يرجى تسجيل الدخول إلى حساب العميل."
                : balance?.kind === "unavailable" ? "خدمة المحفظة غير متاحة في هذه البيئة."
                  : "جارٍ التحقق من المحفظة."}
            </Text>
          )}
        </View>
        {balance?.kind === "ready" ? (
          <View style={{ padding: 20, gap: 10, borderRadius: 14, borderWidth: 1,
            borderColor: theme.borderColor, backgroundColor: theme.surface }}>
            <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>
              سجل التمويل المؤكد
            </Text>
            {history?.kind === "ready" ? (
              <>
                {history.history.items.length === 0 ? (
                  <Text style={{ color: theme.colorSecondary }}>لا توجد عمليات تمويل مؤكدة حتى الآن.</Text>
                ) : history.history.items.map(item => (
                  <View key={item.fundingId} style={{ gap: 4, paddingVertical: 6 }}>
                    <Text style={{ color: theme.color }}>
                      + {displayYER.format(BigInt(item.amountYer))} ريال يمني
                    </Text>
                    <Text style={{ color: theme.colorSecondary }}>
                      {new Date(item.postedAt).toLocaleDateString("ar-YE")}
                    </Text>
                  </View>
                ))}
                {history.history.hasMore && (
                  <>
                    <Pressable accessibilityRole="button" disabled={loadingMore}
                      testID="native-wallet-more" onPress={() => void loadMore()}>
                      <Text style={{ color: theme.interactiveText }}>
                        {loadingMore ? "جارٍ تحميل معاملات أقدم." : "عرض المزيد من المعاملات"}
                      </Text>
                    </Pressable>
                    {moreError && <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
                      تعذّر تحميل الصفحة. يمكنك إعادة المحاولة.
                    </Text>}
                  </>
                )}
              </>
            ) : (
              <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
                {history?.kind === "unavailable" ? "تعذر قراءة سجل المعاملات حاليًا."
                  : "جارٍ التحقق من سجل المعاملات."}
              </Text>
            )}
          </View>
        ) : null}
        {balance?.kind === "signed-out" ? (
          <Link href="/account" style={{ color: theme.interactiveText }}>الانتقال إلى الحساب</Link>
        ) : balance ? (
          <Pressable accessibilityRole="button" onPress={() => refreshRef.current?.()}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={{ color: theme.interactiveText }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
