import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCaptainWorkspace } from "../access/protected-route";

/** Present verified account readiness, never infer a delivery assignment. */
export default function CaptainHomeScreen({ children }: Readonly<{ children?: ReactNode }> = {}) {
  const { theme } = useMobileAppearance();
  const workspace = useCaptainWorkspace();
  if (!workspace) return null;

  const standing = workspace.standing?.actorId === workspace.session.actorId &&
    workspace.standing.status === "APPROVED" &&
    Number.isSafeInteger(workspace.standing.version) && workspace.standing.version > 0;
  const expires = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(workspace.session.sessionExpiresAt));

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{
        padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center",
      }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>
          الرئيسية
        </Text>
        <View style={{
          borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14,
          padding: 16, gap: 10, backgroundColor: theme.surface,
        }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>
            حالة الحساب
          </Text>
          {standing ? (
            <Text testID="captain-standing-verified" style={{ color: theme.successText, fontWeight: "700" }}>
              حساب الكابتن معتمد
            </Text>
          ) : (
            <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
              تعذّر التحقق من اعتماد الكابتن. لا يمكن بدء مهام التوصيل.
            </Text>
          )}
          <Text style={{ color: theme.colorSecondary }}>{`تنتهي الجلسة الحالية في ${expires}`}</Text>
        </View>
        {standing ? children : null}
        <View style={{
          borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14,
          padding: 16, gap: 10, backgroundColor: theme.surface,
        }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>
            مهام التوصيل
          </Text>
          <Text style={{ color: theme.colorSecondary, lineHeight: 26 }}>
            خدمة استقبال مهام التوصيل غير متاحة حاليًا. لا يمكن قبول مهمة أو بدء توصيل من هذه الشاشة.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
