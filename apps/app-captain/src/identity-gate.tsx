import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import * as identity from "./identity";

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      role="captain"
      surface="app-captain"
      roleLabel="الكابتن"
      binding={identity}
    />
  );
}
