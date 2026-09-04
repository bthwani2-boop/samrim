import React, { useEffect } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import "./platform/dsh-capabilities";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MobileUiProvider } from "@bthwani/ui-kit/mobile";
import { registerIdentityBeforeSessionEndHook } from "@bthwani/core-identity";
import {
  BthwaniQueryProvider,
  clearBthwaniQueryClient,
  createBthwaniQueryClient,
  wireNetInfoOnlineManager,
} from "@bthwani/data-runtime";
import { initSentry } from "./observability/sentry";
import { configureBthwaniSensitiveStorage } from "@bthwani/data-runtime/sensitive-storage-adapter";
import { createBthwaniBrowserSensitiveStorage } from "@bthwani/data-runtime/browser-sensitive-storage";

export const sentryEnabled = initSentry();

configureBthwaniSensitiveStorage(
  Platform.OS === "web"
    ? createBthwaniBrowserSensitiveStorage()
    : {
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) => SecureStore.setItemAsync(key, value),
        removeItem: (key) => SecureStore.deleteItemAsync(key),
      },
);

const APP_KEY = "app-client";
const queryClient = createBthwaniQueryClient();
const queryPersistenceKey = `bthwani-query-cache:v3:${APP_KEY}`;

export function MobileRuntimeProviders({ children }: { readonly children: React.ReactNode }) {
  useEffect(() => {
    const detachNetwork = wireNetInfoOnlineManager(queryClient);
    const detachSession = registerIdentityBeforeSessionEndHook(async () => {
      await clearBthwaniQueryClient(queryClient, queryPersistenceKey);
    });
    return () => {
      detachNetwork();
      detachSession();
    };
  }, []);

  return React.createElement(
    SafeAreaProvider,
    null,
    React.createElement(
      BthwaniQueryProvider,
      { client: queryClient, persistenceKey: queryPersistenceKey },
      React.createElement(MobileUiProvider, null, children),
    ),
  );
}
