import AccessWorkspace from "../../../src/features/access/access-workspace";

export default function Page({ searchParams }: Readonly<{
  searchParams: Promise<{ actorId?: string | string[] }>;
}>) {
  return <AccessWorkspace searchParams={searchParams} />;
}
