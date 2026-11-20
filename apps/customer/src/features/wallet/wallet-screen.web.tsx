import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { readCustomerAdmission } from "../access/customer-session-transport";
import { readVerifiedWallet, type WalletReadState } from "./wallet-read.web";

const displayYER = new Intl.NumberFormat("ar-YE");

export default function WalletScreen() {
  const { theme } = useMobileAppearance();
  const [state, setState] = useState<WalletReadState | null>(null);
  const refreshBalance = useRef<(() => void) | null>(null);

  useFocusEffect(useCallback(() => {
    let pending: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function hide() {
      pending?.abort();
      clearTimeout(expiry);
      setState(null);
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
          expiry = setTimeout(() => setState({ kind: "signed-out" }), Math.max(0, result.expiresAt - Date.now()));
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
      pending?.abort();
      clearTimeout(expiry);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", hide);
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
