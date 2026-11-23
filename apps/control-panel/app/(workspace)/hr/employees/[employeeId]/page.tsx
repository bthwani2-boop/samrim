import EmployeeDetail from "../../../../../src/features/hr/employee-detail";

export default async function Page({ params }: Readonly<{ params: Promise<{ employeeId: string }> }>) {
  return <EmployeeDetail id={(await params).employeeId} />;
}
