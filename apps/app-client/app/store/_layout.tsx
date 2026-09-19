import { Stack } from "expo-router";

import ServiceCityScope from "../../src/features/service-city/service-city-scope";

export default function PublicStoreLayout() {
  return (
    <ServiceCityScope>
      <Stack screenOptions={{ headerShown: false }} />
    </ServiceCityScope>
  );
}
