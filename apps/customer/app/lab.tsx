import * as React from "react";
import { SafeAreaView, ScrollView } from "react-native";
import { Link } from "expo-router";
import { Button, Card, Dialog, H2, Input, Paragraph, Select, Sheet, Switch, Text, XStack, YStack } from "tamagui";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";

// Stage-4 renderer-only acceptance fixture. No API, identity, commercial data, or product workflow.
export default function ComponentLab() {
  const { theme } = useMobileAppearance();
  const [name, setName] = React.useState("");
  const [choice, setChoice] = React.useState("first");
  const [enabled, setEnabled] = React.useState(false);
  const [dialog, setDialog] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20 }} keyboardShouldPersistTaps="handled">
        <YStack gap="4" style={{ maxWidth: 720 }}>
          <H2 color="color">مختبر مكونات Tamagui</H2>
          <Paragraph color="colorWeak">اختبار هندسي لتخطيط RTL والوصول والثيم. لا توجد بيانات تجارية.</Paragraph>
          <Paragraph color="color">السَّلَامُ عَلَيْكُمْ — أرقام عربية ١٢٣٤٥ — Latin ABC 2026</Paragraph>
          <Card backgroundColor="background" gap="3" style={{ padding: 16, borderWidth: 1, borderColor: theme.borderColor }}>
            <Text color="color" fontWeight="600">نموذج إدخال</Text>
            <Input aria-label="نص عربي للاختبار" value={name} onChangeText={setName} placeholder="اكتب نصًا عربيًا" />
            <Select value={choice} onValueChange={setChoice}>
              <Select.Trigger aria-label="اختيار عنصر اختباري">
                <Select.Value placeholder="اختر حالة" />
              </Select.Trigger>
              <Select.Content>
                <Select.Viewport>
                  <Select.Item value="first">
                    <Select.ItemText>الخيار الأول</Select.ItemText>
                  </Select.Item>
                  <Select.Item value="second">
                    <Select.ItemText>الخيار الثاني</Select.ItemText>
                  </Select.Item>
                </Select.Viewport>
              </Select.Content>
            </Select>
            <XStack gap="3" style={{ alignItems: "center" }}>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="تبديل حالة اختبار">
                <Switch.Thumb />
              </Switch>
              <Paragraph color="color">الحالة: {enabled ? "مفعّلة" : "غير مفعّلة"}</Paragraph>
            </XStack>
            <Text color="colorWeak">النص: {name || "لا يوجد إدخال"} — الاختيار: {choice === "first" ? "الأول" : "الثاني"}</Text>
          </Card>
          <XStack gap="3" flexWrap="wrap">
            <Dialog open={dialog} onOpenChange={setDialog}>
              <Dialog.Trigger asChild>
                <Button>فتح نافذة</Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay backgroundColor="color" opacity={0.24} />
                <Dialog.Content bordered elevate backgroundColor="background" style={{ padding: 16 }}>
                  <Dialog.Title color="color">نافذة اختبار</Dialog.Title>
                  <Dialog.Description color="colorWeak">التحقق من التركيز والإغلاق والاتجاه.</Dialog.Description>
                  <Dialog.Close asChild>
                    <Button>إغلاق النافذة</Button>
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog>
            <Button onPress={() => setSheet(true)}>فتح لوحة سفلية</Button>
          </XStack>
          <Sheet open={sheet} onOpenChange={setSheet} modal snapPoints={[50]} dismissOnSnapToBottom>
            <Sheet.Overlay backgroundColor="color" opacity={0.24} />
            <Sheet.Container backgroundColor="background" gap="4" style={{ padding: 16 }}>
              <Sheet.Handle />
              <H2 color="color">لوحة اختبار</H2>
              <Paragraph color="colorWeak">عرض المحتوى عبر Sheet من Tamagui.</Paragraph>
              <Button onPress={() => setSheet(false)}>إغلاق اللوحة</Button>
            </Sheet.Container>
          </Sheet>
          <Link href="/">العودة إلى الرئيسية</Link>
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}