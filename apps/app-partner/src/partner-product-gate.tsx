import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { isPartnerBootstrapNotFound, readOwnPartnerBootstrap } from "./partner-product";

export function PartnerProductReadback() {
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
  if (state.kind === "empty") return <Text>لم تُنشأ منظمة الشريك وأول متجر بعد.</Text>;
  if (state.kind === "error") return <Text accessibilityRole="alert">تعذر قراءة بيانات الشريك من DSH.</Text>;
  return (
    <View>
      <Text>المتجر الأول</Text>
      <Text>{state.value.firstStore.name}</Text>
      <Text>الحالة: مقروءة من DSH</Text>
    </View>
  );
}
