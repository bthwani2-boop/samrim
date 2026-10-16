"use client";

import { useParams } from "next/navigation";
import { EmployeeProfileWorkspace } from "../../../../../src/features/hr/employee-profile-workspace";

export default function EmployeeProfilePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  return <EmployeeProfileWorkspace employeeId={employeeId} />;
}
