import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatExactYer } from "../../components/format-exact-yer";
import {
  type NativeWalletHistoryRead, type NativeWalletRead,
  readNativeWallet, readNativeWalletTransactions,
} from "./wallet-read";


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
  const moreTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const concealRef = useRef<(() => void) | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const scheduleExpiryRef = useRef<((expiresAt: number) => void) | null>(null);

  useFocusEffect(useCallback(() => {
    let actor: string | undefined;
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    function hide() {
      generation.current++;
      pending.current?.abort();
      morePending.current?.abort();
      pending.current = null;
      morePending.current = null;
      clearTimeout(moreTimeout.current);
      moreTimeout.current = undefined;
      actor = undefined;
      clearTimeout(refreshTimeout);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
      setBalance(null);
      setHistory(null);
      setLoadingMore(false);
      setMoreError(false);
    }
    function conceal() {
      hide();
      setBalance({ kind: "signed-out" });
    }
    function scheduleExpiry(expiresAt: number) {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(conceal, Math.max(0, expiresAt - Date.now()));
    }
    function refresh(silent = false) {
      if (AppState.currentState !== "active") {
        hide();
        return;
      }
      if (silent && (pending.current || morePending.current)) return;
      if (!silent) hide();
      const previousActor = actor;
      const current = generation.current;
      const controller = new AbortController();
      pending.current = controller;
      const stillCurrent = () => !controller.signal.aborted && generation.current === current && pending.current === controller;
      function unavailable() {
        if (!stillCurrent()) return;
        hide();
        setBalance({ kind: "unavailable" });
      }
      refreshTimeout = setTimeout(unavailable, 12000);
      void (async () => {
        try {
          const result = await readNativeWallet(controller.signal);
          if (!stillCurrent()) return;
          if (result.kind !== "ready") {
            hide();
            setBalance(result);
            return;
          }
          if ((previousActor && previousActor !== result.balance.actorId) || result.expiresAt <= Date.now()) {
            hide();
            setBalance({ kind: "signed-out" });
            return;
          }
          if (!previousActor) {
            actor = result.balance.actorId;
            setBalance(result);
            scheduleExpiry(result.expiresAt);
          }
          const transactions = await readNativeWalletTransactions(controller.signal, undefined, result.balance.actorId);
          if (!stillCurrent()) return;
          if (transactions.kind !== "ready") {
            hide();
            setBalance({ kind: transactions.kind });
            return;
          }
          const expiresAt = Math.min(result.expiresAt, transactions.expiresAt);
          if (transactions.history.actorId !== result.balance.actorId || expiresAt <= Date.now()) {
            hide();
            setBalance({ kind: "signed-out" });
            return;
          }
          actor = result.balance.actorId;
          setBalance(result);
          setHistory(transactions);
          setMoreError(false);
          scheduleExpiry(expiresAt);
        } catch {
          unavailable();
        } finally {
          if (pending.current === controller) {
            clearTimeout(refreshTimeout);
            pending.current = null;
          }
        }
      })();
    }
    scheduleExpiryRef.current = scheduleExpiry;
    concealRef.current = conceal;
    refreshRef.current = refresh;
    const subscription = AppState.addEventListener("change", status => {
      if (status === "active") refresh();
      else hide();
    });
    refresh();
    const interval = setInterval(() => refresh(true), 30000);
    return () => {
      clearInterval(interval);
      refreshRef.current = null;
      scheduleExpiryRef.current = null;
      concealRef.current = null;
      subscription.remove();
      hide();
    };
  }, []));

  async function loadMore() {
    if (balance?.kind !== "ready" || history?.kind !== "ready" ||
      !history.history.nextCursor || morePending.current || pending.current) return;
    const cursor = history.history.nextCursor;
    const actorId = history.history.actorId;
    const current = generation.current;
    const controller = new AbortController();
    morePending.current = controller;
    setLoadingMore(true);
    setMoreError(false);
    const stillCurrent = () => !controller.signal.aborted && generation.current === current && morePending.current === controller;
    // A non-cooperative transport must not hold the foreground verification lock.
    moreTimeout.current = setTimeout(() => {
      if (!stillCurrent()) return;
      controller.abort();
      clearTimeout(moreTimeout.current);
      moreTimeout.current = undefined;
      morePending.current = null;
      setLoadingMore(false);
      setMoreError(true);
    }, 12000);
    try {
      const next = await readNativeWalletTransactions(controller.signal, cursor, balance.balance.actorId);
      if (!stillCurrent()) return;
      if (next.kind === "signed-out" || (next.kind === "ready" &&
          (next.history.actorId !== actorId || Math.min(balance.expiresAt, history.expiresAt, next.expiresAt) <= Date.now()))) {
        concealRef.current?.();
        return;
      }
      if (next.kind !== "ready" ||
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
      if (stillCurrent()) setMoreError(true);
    } finally {
      if (morePending.current === controller) {
        clearTimeout(moreTimeout.current);
        moreTimeout.current = undefined;
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
              <Text style={{ color: theme.colorSecondary }}>الرصيد المسجّل في المحفظة</Text>
              <Text testID="native-wallet-balance" style={{ color: theme.color, fontSize: 30, fontWeight: "700" }}>
                {formatExactYer(BigInt(balance.balance.balanceYer))} ريال يمني
              </Text>
              <Text testID="native-wallet-available" style={{ color: theme.colorSecondary }}>
                المتاح بعد الحجوزات: {formatExactYer(BigInt(balance.balance.availableYer))} ريال يمني
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
                      {item.reversesFundingId ? "عكس تمويل −" : "+"} {formatExactYer(BigInt(item.amountYer))} ريال يمني
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
          <Link href={{ pathname: "/login", params: { returnTo: "/wallet" } }} style={{ color: theme.interactiveText }}>تسجيل الدخول إلى المحفظة</Link>
        ) : balance?.kind === "unavailable" || history?.kind === "unavailable" ? (
          <Pressable accessibilityRole="button" onPress={() => refreshRef.current?.()}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={{ color: theme.interactiveText }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
