import type { Metadata } from "expo-router/server";
import MerchantIdentityGate from "../src/features/access/identity-gate";

export function generateMetadata(): Metadata {
  return { title: "بثواني — التاجر", description: "بوابة التاجر في بثواني." };
}

export default function MerchantEntry() {
  return <MerchantIdentityGate />;
}
