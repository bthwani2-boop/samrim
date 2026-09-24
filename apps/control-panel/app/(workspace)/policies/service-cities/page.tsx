"use client";

import { ServiceCityPanel } from "../../../../src/features/service-city/service-city-panel";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyServiceCitiesPage() {
  return <PoliciesWorkspace resource="service-cities"><ServiceCityPanel /></PoliciesWorkspace>;
}
