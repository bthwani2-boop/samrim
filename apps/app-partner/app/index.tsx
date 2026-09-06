import { ManagedIdentityGate } from "@bthwani/design-system/native";
import { activateManagedIdentity, currentIdentityState, loginManagedIdentity, logoutIdentity, recoverManagedIdentity, requestManagedActivation, requestManagedRecovery, restoreIdentitySession } from "../src/identity";

export default function IdentityGate() {
  return <ManagedIdentityGate roleLabel="الشريك" requestCode={requestManagedActivation} requestRecovery={requestManagedRecovery} recover={recoverManagedIdentity} login={loginManagedIdentity} activate={activateManagedIdentity} restore={restoreIdentitySession} currentState={currentIdentityState} logout={logoutIdentity} />;
}
