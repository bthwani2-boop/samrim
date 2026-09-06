import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import * as identity from "./identity";

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      role="partner"
      surface="app-partner"
      roleLabel="الشريك"
      binding={identity}
    />
  );
}
