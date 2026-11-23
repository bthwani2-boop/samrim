import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCaptainWorkspace } from "../access/protected-route";

/** Current owner facts only. A DSH standing is not a dispatch assignment. */
export default function CaptainHomeScreen() {
  const { theme } = useMobileAppearance();
  const workspace = useCaptainWorkspace();
  if (!workspace) return null;

  const standing = workspace.standing?.actorId === workspace.session.actorId &&
    workspace.standing.status === "APPROVED" ? workspace.standing : null;
  const expires = new Intl.DateTimeFormat("ar", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(workspace.session.sessionExpiresAt));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{
        padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center",
      }}>
        <Text accessibilityRole="header" style={{
          color: theme.color, fontSize: 28, fontWeight: "700",
        }}>الرئيسية</Text>
        <View style={{
          borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14,
          padding: 18, gap: 12, backgroundColor: theme.surface,
        }}>
          <Text style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>
            الاعتماد والجلسة
          </Text>
          {standing ? (
            <Text testID="captain-standing-verified" style={{
              color: theme.successText, fontWeight: "700",
            }}>
              {["اعتماد DSH ساري — نسخة السجل ", String(standing.version)].join("")}
            </Text>
          ) : (
            <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
              لا تتوفر بيانات اعتماد حية لهذا الكابتن. لا يمكن بدء أي مهمة.
            </Text>
          )}
          <Text style={{ color: theme.colorSecondary }}>
            {["تنتهي جلسة Identity في: ", expires].join("")}
          </Text>
        </View>
        <View style={{
          borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14,
          padding: 18, gap: 10, backgroundColor: theme.surface,
        }}>
          <Text style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>
            مهام التوصيل
          </Text>
          <Text style={{ color: theme.colorSecondary, lineHeight: 26 }}>
            لا يمكن عرض عروض أو مهمات مسندة حتى يتوفر عقد DSH للتوزيع الفعلي.
            اعتماد الكابتن لا يعني وجود مهمة، ولا يمنح إذن الاستلام أو التسليم.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
