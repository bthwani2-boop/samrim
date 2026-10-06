import FieldWallet from "../../src/features/wallet/wallet";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";

export default function FieldWalletRoute() {
  return <FieldAdmissionGate><FieldWallet /></FieldAdmissionGate>;
}
