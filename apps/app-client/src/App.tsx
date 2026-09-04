import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  DshClientApplication,
  type DshClientNavigation,
  type DshClientPlatform,
  type DshClientRoute,
} from "@bthwani/dsh/app-client";
import { secureRandomId } from "@bthwani/dsh/mobile-capabilities";
import {
  configureIdentityDeviceFingerprintProvider,
  configureIdentitySession,
  configureIdentitySessionStorage,
  type SessionStorageAdapter,
  resolveIdentityApiBaseUrl,
} from "@bthwani/core-identity";
import {
  createClientEphemeralId,
  openClientExternalUrl,
  performClientSelectionHaptic,
  shareClientTextDocument,
} from "./platform/client-platform-actions";
import { ClientRemoteImage } from "./media/ClientRemoteImage";
import { getOrCreateClientDeviceFingerprint } from "./config/client-device-fingerprint";

const CLIENT_PUSH_SCHEME = "bthwani-client-next";

function createSecureStoreSessionStorageAdapter(): SessionStorageAdapter {
  return {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

if (Platform.OS !== "web") {
  configureIdentitySessionStorage(createSecureStoreSessionStorageAdapter());
  configureIdentityDeviceFingerprintProvider(() =>
    getOrCreateClientDeviceFingerprint(
      {
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) => SecureStore.setItemAsync(key, value),
      },
      secureRandomId,
    ),
  );
}
configureIdentitySession(resolveIdentityApiBaseUrl());

export type ClientAppProps = {
  readonly route: DshClientRoute;
  readonly navigation: DshClientNavigation;
};

const clientPlatform: DshClientPlatform = {
  RemoteImage: ClientRemoteImage,
  createEphemeralId: createClientEphemeralId,
  selectionHaptic: performClientSelectionHaptic,
  openExternalUrl: openClientExternalUrl,
  shareTextDocument: shareClientTextDocument,
};

export default function App(props: ClientAppProps) {
  return (
    <DshClientApplication
      {...props}
      platform={clientPlatform}
      pushScheme={CLIENT_PUSH_SCHEME}
    />
  );
}
