import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import { FieldOperations } from "../field-operations/field-operations";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  logoutIdentity,
  requestManagedActivation,
  restoreIdentitySession,
  subscribeIdentitySession,
  role,
  surface,
} from "../../bootstrap/identity";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession, logoutIdentity, requestManagedActivation, activateManagedIdentity, loginManagedIdentity };

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      managedRole={role}
      surface={surface}
      roleLabel="الميدان"
      binding={identity}
      authenticatedContent={<FieldOperations />}
    />
  );
}
