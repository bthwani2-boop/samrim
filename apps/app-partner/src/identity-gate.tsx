import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  logoutIdentity,
  recoverManagedIdentity,
  requestManagedActivation,
  requestManagedRecovery,
  restoreIdentitySession,
  role,
  surface,
} from "./identity";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, logoutIdentity, requestManagedActivation, activateManagedIdentity, loginManagedIdentity, requestManagedRecovery, recoverManagedIdentity };

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      managedRole={role}
      surface={surface}
      roleLabel="الشريك"
      binding={identity}
    />
  );
}
