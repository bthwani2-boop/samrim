"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { IdentitySurface, LoadingState, UnavailableState } from "./components/public-shell";
import { useSession } from "./components/session-provider";

export default function Home() {
  const router = useRouter();
  const { state, busy, restore } = useSession();

  useEffect(() => {
    if (state.kind === "authenticated") router.replace("/workspace");
  }, [router, state.kind]);

  if (state.kind === "loading") {
    return <LoadingState />;
  }

  if (state.kind === "unavailable") {
    return <UnavailableState message={state.message} onRetry={() => void restore()} busy={busy} />;
  }

  if (state.kind === "authenticated") {
    return <LoadingState title="جارٍ فتح مساحة العمل" message="ننقلك إلى المساحة الموثقة." />;
  }

  return <IdentitySurface />;
}
