import { ManagedIdentityGate } from "@bthwani/design-system/native";
import { activateManagedIdentity, currentIdentityState, loginManagedIdentity, logoutIdentity, requestManagedActivation, restoreIdentitySession } from "../src/identity";

export default function IdentityGate() {
  return <ManagedIdentityGate roleLabel="الشريك" requestCode={requestManagedActivation} login={loginManagedIdentity} activate={activateManagedIdentity} restore={restoreIdentitySession} currentState={currentIdentityState} logout={logoutIdentity} />;
}
