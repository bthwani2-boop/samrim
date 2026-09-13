import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { isJoiningCaseNotFound, readOwnJoiningCase } from "./store-readback-client";
import { JoiningCaseCorrection } from "./joining-case-correction";
import { StoreAssortmentManagement } from "../store-assortment/store-assortment";

export function StoreReadback() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; value: Awaited<ReturnType<typeof readOwnJoiningCase>> }
    | { kind: "empty" }
    | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void readOwnJoiningCase().then(
      (value) => { if (active) setState({ kind: "ready", value }); },
      (error) => { if (active) setState({ kind: isJoiningCaseNotFound(error) ? "empty" : "error" }); },
    );
    return () => { active = false; };
  }, []);

  if (state.kind === "loading") return <ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" />;
  if (state.kind === "empty") return <Text>لم يُنشأ المتجر الأول للشريك بعد.</Text>;
  if (state.kind === "error") return <Text accessibilityRole="alert">تعذر قراءة بيانات الشريك من DSH.</Text>;
  return (
    <View>
      <Text>حالة انضمام الشريك</Text>
      <Text>{state.value.case.businessName}</Text>
      <Text>الحالة: {state.value.case.state}</Text>
      <JoiningCaseCorrection value={state.value} onUpdated={(value) => setState({ kind: "ready", value })} />
      {state.value.case.store ? <><Text>المتجر الأول: {state.value.case.store.name}</Text><Text>حالة النشر: {state.value.case.store.publicationState}</Text><Text>جاهزية النشر: {state.value.case.store.publicationReadiness.ready ? "جاهز" : "محجوب"}</Text><Text>الإصدار الكانوني: {state.value.case.store.version}</Text><StoreAssortmentManagement storeId={state.value.case.store.id} /></> : null}
    </View>
  );
}
