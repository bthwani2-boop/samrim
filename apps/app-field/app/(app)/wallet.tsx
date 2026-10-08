import { spacing } from "@bthwani/design-system";
import { ScrollView } from "react-native";
import FieldWallet from "../../src/features/wallet/wallet";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";

export default function FieldWalletRoute() {
  return <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator><FieldAdmissionGate><FieldWallet /></FieldAdmissionGate></ScrollView>;
}
