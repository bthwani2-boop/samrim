import { BthwaniIconButton } from "@bthwani/design-system/native";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { StoreAccessInvitationInbox } from "../../src/features/account/store-access-invitations";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldInvitationsRoute() {
  const router = useRouter();
  return <FieldAdmissionGate><FieldScrollScreen><View style={{ gap: 12, paddingTop: 16 }}><BthwaniIconButton icon="back" label="العودة إلى الحساب" onPress={() => router.back()} /><StoreAccessInvitationInbox /></View></FieldScrollScreen></FieldAdmissionGate>;
}
