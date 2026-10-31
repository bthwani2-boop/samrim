import { Stack } from "expo-router";

// The root layout already owns the one canonical Service City scope.
export default function PublicStoreLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
