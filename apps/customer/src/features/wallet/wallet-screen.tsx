import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatExactYer } from "../../components/format-exact-yer";
import { createWalletLifecycle, emptyWalletView } from "./wallet-lifecycle";
import { readNativeWallet, readNativeWalletTransactions } from "./wallet-read";

// Android read-only wallet: the same display lifecycle as Web, with
// native Identity/WLT reads and AppState as the visibility owner.
export default function WalletScreen() {
  const { theme } = useMobileAppearance();
  const [{ balance, history, loadingMore, moreError }, setView] = useState(emptyWalletView);
  const lifecycle = useRef<ReturnType<typeof createWalletLifecycle> | null>(null);
  useFocusEffect(useCallback(() => {
    const owner = createWalletLifecycle({
      active: () => AppState.currentState === "active",
      readBalance: (signal, actor) => readNativeWallet(signal, actor),
      readHistory: (signal, cursor, actor) => readNativeWalletTransactions(signal, cursor, actor),
    }, setView);
    lifecycle.current = owner;
    const subscription = AppState.addEventListener("change", status => {
      if (status === "active") owner.refresh();
      else owner.hide();
    });
    owner.refresh();
    return () => {
      lifecycle.current = null;
      subscription.remove();
      owner.stop();
    };
  }, []));

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
                      testID="native-wallet-more" onPress={() => lifecycle.current?.loadMore()}>
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
          <Pressable accessibilityRole="button" onPress={() => lifecycle.current?.refresh()}>
            <Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={{ color: theme.interactiveText }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
