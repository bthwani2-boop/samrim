import EmployeesWorkspace from "../../../../src/features/hr/employees-workspace";

export default function Page({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  return <EmployeesWorkspace searchParams={searchParams} />;
}
