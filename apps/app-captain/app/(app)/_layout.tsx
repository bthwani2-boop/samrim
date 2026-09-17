import { useCallback } from "react";
import { useRouter } from "expo-router";

import { AuthenticatedMobileBoundary } from "@bthwani/identity/presentation";
import CaptainShell from "../../src/shell/captain-shell";
import { currentIdentityState, restoreIdentitySession, subscribeIdentitySession } from "../../src/bootstrap/identity";

const identity = { restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession };
export default function CaptainAppLayout() { const router = useRouter(); const onUnauthenticated = useCallback(() => router.replace("/"), [router]); return <AuthenticatedMobileBoundary binding={identity} onUnauthenticated={onUnauthenticated}><CaptainShell /></AuthenticatedMobileBoundary>; }
