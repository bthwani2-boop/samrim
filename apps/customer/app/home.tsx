import { Redirect } from "expo-router";

// Preserve the historical /home deep link without creating another Home screen.
export default function LegacyHomeRoute() {
  return <Redirect href="/" />;
}
