import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import { CaptainOperations } from "../captain-operations/captain-operations";
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
      roleLabel="الكابتن"
      binding={identity}
      authenticatedContent={<CaptainOperations />}
    />
  );
}
