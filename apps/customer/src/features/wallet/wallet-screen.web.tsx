import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { formatExactYer } from "../../components/format-exact-yer";
import { readCustomerAdmission } from "../access/customer-session-transport";
import { createWalletLifecycle, emptyWalletView } from "./wallet-lifecycle";
import { readVerifiedWallet, readVerifiedWalletTransactions } from "./wallet-read.web";

// Web supplies only the same-origin owner reads and browser visibility.
// All display admission, cancellation and pagination live in one owner.
export default function WalletScreen() {
  const { theme } = useMobileAppearance();
  const [{ balance: state, history, loadingMore, moreError }, setView] = useState(emptyWalletView);
  const lifecycle = useRef<ReturnType<typeof createWalletLifecycle> | null>(null);
  useFocusEffect(useCallback(() => {
    const owner = createWalletLifecycle({
      active: () => document.visibilityState !== "hidden" && document.hasFocus(),
      readBalance: (signal, actor) => readVerifiedWallet(readCustomerAdmission, signal, actor),
      readHistory: (signal, cursor, actor) => readVerifiedWalletTransactions(readCustomerAdmission, signal, cursor, actor),
    }, setView);
    lifecycle.current = owner;
    const refreshVisible = () => owner.refresh();
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("blur", owner.hide);
    owner.refresh();
    return () => {
      lifecycle.current = null;
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("blur", owner.hide);
      owner.stop();
    };
  }, []));

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
                    <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => lifecycle.current?.loadMore()}>
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
          <Pressable accessibilityRole="button" onPress={() => lifecycle.current?.refresh()}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={{ color: theme.interactiveText }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
