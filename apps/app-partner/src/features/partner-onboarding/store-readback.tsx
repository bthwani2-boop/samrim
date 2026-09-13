import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { isPartnerBootstrapNotFound, readOwnPartnerBootstrap } from "./store-readback-client";

export function StoreReadback() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; value: Awaited<ReturnType<typeof readOwnPartnerBootstrap>> }
    | { kind: "empty" }
    | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void readOwnPartnerBootstrap().then(
      (value) => { if (active) setState({ kind: "ready", value }); },
      (error) => { if (active) setState({ kind: isPartnerBootstrapNotFound(error) ? "empty" : "error" }); },
    );
    return () => { active = false; };
  }, []);

  if (state.kind === "loading") return <ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" />;
  if (state.kind === "empty") return <Text>لم يُنشأ المتجر الأول للشريك بعد.</Text>;
  if (state.kind === "error") return <Text accessibilityRole="alert">تعذر قراءة بيانات الشريك من DSH.</Text>;
  return (
    <View>
      <Text>المتجر الأول</Text>
      <Text>{state.value.firstStore.name}</Text>
      <Text>حالة النشر: {state.value.firstStore.publicationState}</Text>
      <Text>الإصدار الكانوني: {state.value.firstStore.version}</Text>
    </View>
  );
}
