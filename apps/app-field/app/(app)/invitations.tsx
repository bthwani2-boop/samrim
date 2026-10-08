import { StoreAccessInvitationInbox } from "../../src/features/account/store-access-invitations";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldInvitationsRoute() {
  return <FieldAdmissionGate><FieldScrollScreen><StoreAccessInvitationInbox showTitle={false} /></FieldScrollScreen></FieldAdmissionGate>;
}
