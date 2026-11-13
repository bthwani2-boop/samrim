import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { BottomSheet, Button, Column, Host, Text as NativeText, Picker, Switch, TextInput } from "@expo/ui";
import { Link } from "expo-router";
import * as React from "react";
import { Modal, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

// Isolated Stage-4 renderer comparison. No API, persistence, business logic, or second theme authority.
// Compare with /lab (Tamagui) using the same Arabic controls and actual supported devices.
export default function UniversalRendererLab() {
  const { theme, themeName } = useMobileAppearance();
  const [name, setName] = React.useState("");
  const [choice, setChoice] = React.useState("first");
  const [enabled, setEnabled] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: "100%", maxWidth: 720, alignSelf: "center", gap: 16 }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 23, fontWeight: "700", textAlign: "right" }}>
            مختبر Expo UI Universal
          </Text>
          <Text style={{ color: theme.colorSecondary, textAlign: "right", lineHeight: 23 }}>
            مقارنة مع Tamagui لنموذج عربي، اختيار، تبديل، نافذة ولوحة سفلية. بيانات تجريبية فقط.
          </Text>
          <Host matchContents layoutDirection="rightToLeft" colorScheme={themeName}
            seedColor={theme.actionBackground} style={{ width: "100%" }}>
            <Column spacing={14}>
              <NativeText textStyle={{ color: theme.color, fontSize: 17, textAlign: "right" }}>
                السَّلَامُ عَلَيْكُمْ — أرقام عربية ١٢٣٤٥ — Latin ABC 2026
              </NativeText>
              <NativeText textStyle={{ color: theme.color, textAlign: "right" }}>نموذج إدخال</NativeText>
              <TextInput testID="universal-arabic-name" placeholder="اكتب نصًا عربيًا"
                onChangeText={setName} textAlign="right" />
              <Picker testID="universal-choice" selectedValue={choice} onValueChange={setChoice}>
                <Picker.Item label="الخيار الأول" value="first" />
                <Picker.Item label="الخيار الثاني" value="second" />
              </Picker>
              <Switch testID="universal-enabled" value={enabled} onValueChange={setEnabled}
                label="تبديل حالة اختبار" />
              <NativeText textStyle={{ color: theme.color, textAlign: "right" }}>
                {`النص: ${name || "لا يوجد إدخال"} — الاختيار: ${choice === "first" ? "الأول" : "الثاني"} — الحالة: ${enabled ? "مفعّلة" : "غير مفعّلة"}`}
              </NativeText>
              <Button label="فتح نافذة" onPress={() => setDialogOpen(true)} />
              <Button label="فتح لوحة سفلية" onPress={() => setSheetOpen(true)} />
            </Column>
          </Host>
          <Text style={{ color: theme.colorSecondary, textAlign: "right", fontSize: 13 }}>
            النافذة تستخدم React Native Modal لأن إصدار Universal الحالي لا يوفر Dialog عامًا؛
            وتختبر اللوحة BottomSheet الأصلية.
          </Text>
          <Link href="/lab" style={{ color: theme.interactiveText, textAlign: "right" }}>مقارنة مع مختبر Tamagui</Link>
          <Link href="/" style={{ color: theme.interactiveText, textAlign: "right" }}>العودة إلى الرئيسية</Link>
        </View>
      </ScrollView>
      <Modal visible={dialogOpen} transparent animationType="fade" onRequestClose={() => setDialogOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center",
          padding: 24, backgroundColor: theme.overlayScrim }}>
          <View style={{ backgroundColor: theme.surface, padding: 24, gap: 16,
            borderRadius: 14, width: "100%", maxWidth: 440 }}>
            <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700",
              fontSize: 20, textAlign: "right" }}>نافذة اختبار</Text>
            <Text style={{ color: theme.color, textAlign: "right" }}>التحقق من التركيز والإغلاق والاتجاه.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="إغلاق النافذة"
              onPress={() => setDialogOpen(false)}
              style={{ backgroundColor: theme.actionBackground, padding: 14, borderRadius: 10 }}>
              <Text style={{ color: theme.onAction, textAlign: "center" }}>إغلاق النافذة</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <BottomSheet isPresented={sheetOpen} onDismiss={() => setSheetOpen(false)} snapPoints={["half"]}>
        <View style={{ padding: 20, gap: 16, backgroundColor: theme.surface }}>
          <Text style={{ color: theme.color, fontSize: 19, fontWeight: "700",
            textAlign: "right" }}>لوحة اختبار</Text>
          <Text style={{ color: theme.color, textAlign: "right" }}>عرض المحتوى عبر Expo UI BottomSheet.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق اللوحة السفلية"
            onPress={() => setSheetOpen(false)}
            style={{ padding: 14, backgroundColor: theme.actionBackground, borderRadius: 10 }}>
            <Text style={{ color: theme.onAction, textAlign: "center" }}>إغلاق اللوحة</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
