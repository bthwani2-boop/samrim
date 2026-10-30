import { ManagedIdentityFlow, resolveInternalReturnPath } from "@bthwani/identity/presentation";
import { BthwaniButton } from "@bthwani/design-system/native";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type Href, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  requestManagedActivation,
  requestManagedRecovery,
  recoverManagedIdentity,
  restoreIdentitySession,
  role,
  subscribeIdentitySession,
  surface,
} from "../../bootstrap/identity";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession, requestManagedActivation, activateManagedIdentity, loginManagedIdentity, requestManagedRecovery, recoverManagedIdentity };

export default function IdentityGate() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const router = useRouter();
  const safeReturnTo = resolveInternalReturnPath(returnTo, "/orders", /^(?:\/store|\/notifications|\/orders|\/products|\/wallet|\/more|\/account|\/onboarding)$/u) as Href;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <ManagedIdentityFlow
          managedRole={role}
          surface={surface}
          binding={identity}
          authenticatedContent={<Redirect href={safeReturnTo} />}
        />
      </View>
      <SafeAreaView edges={["bottom"]} style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <BthwaniButton label="انضم كمتجر جديد دون ميداني" variant="secondary" onPress={() => router.push("/apply" as Href)} />
      </SafeAreaView>
    </View>
  );
}
