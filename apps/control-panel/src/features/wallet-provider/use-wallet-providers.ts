"use client";

import { useCallback, useEffect, useState } from "react";

export type WalletProviderOption = Readonly<{ key: string; displayNameAr: string; active: boolean; version: number }>;
type WalletProviderListResponse = Readonly<{ walletProviders: ReadonlyArray<WalletProviderOption> }>;

export function useWalletProviders() {
  const [walletProviders, setWalletProviders] = useState<ReadonlyArray<WalletProviderOption>>([]);
  const [walletProvidersLoading, setWalletProvidersLoading] = useState(true);
  const [walletProvidersError, setWalletProvidersError] = useState("");
  const loadWalletProviders = useCallback(async () => {
    setWalletProvidersLoading(true);
    setWalletProvidersError("");
    try {
      const response = await fetch("/api/wallet-providers", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      const payload = await response.json() as WalletProviderListResponse;
      if (!Array.isArray(payload.walletProviders)) throw new Error("shape");
      setWalletProviders(payload.walletProviders.filter((provider) => provider.active && typeof provider.key === "string" && typeof provider.displayNameAr === "string"));
    } catch {
      setWalletProvidersError("تعذر قراءة قائمة المحافظ الرسمية.");
    } finally {
      setWalletProvidersLoading(false);
    }
  }, []);
  useEffect(() => { void loadWalletProviders(); }, [loadWalletProviders]);
  return { walletProviders, walletProvidersLoading, walletProvidersError, loadWalletProviders } as const;
}

export function walletProviderLabel(providerKey: string, providers: ReadonlyArray<WalletProviderOption> = []): string {
  const key = providerKey.trim();
  return providers.find((provider) => provider.key === key)?.displayNameAr ?? (key.replaceAll("_", " ") || "—");
}
