import HomeDashboard from "../../../src/features/workspace/home-dashboard";
import { currentOperatorAccess } from "../../../src/server/current-operator-access";

// The Identity gate fails closed until an authoritative browser session exists.
export default async function OperatorDashboardPage() {
  const access = await currentOperatorAccess();
  return <HomeDashboard grants={access?.grants ?? []} />;
}
