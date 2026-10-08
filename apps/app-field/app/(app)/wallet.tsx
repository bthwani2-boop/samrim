import FieldWallet from "../../src/features/wallet/wallet";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldWalletRoute() {
  return <FieldAdmissionGate><FieldScrollScreen><FieldWallet /></FieldScrollScreen></FieldAdmissionGate>;
}
