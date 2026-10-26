import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import { type Href, Stack, usePathname, useRouter } from "expo-router";
import { useCallback } from "react";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";
import { FieldAdmissionProvider } from "../../src/features/field-operations/use-field-admission";
import { FieldStackHeader } from "../../src/shell/field-shell";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };

export default function FieldAppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const onUnauthenticated = useCallback(() => router.replace(pathname === "/" ? "/" : `/?returnTo=${encodeURIComponent(pathname)}` as Href), [pathname, router]);
  return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><FieldAdmissionProvider><Stack screenOptions={{ headerShown: false }}><Stack.Screen name="(tabs)" options={{ headerShown: false }} /><Stack.Screen name="new-case" options={{ header: (props) => <FieldStackHeader {...props} /> }} /></Stack></FieldAdmissionProvider></AuthenticatedMobileBoundary>;
}
