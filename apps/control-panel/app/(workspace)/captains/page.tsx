import { redirect } from "next/navigation";

export default async function CaptainsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string,string|string[]|undefined>> }>) {
  const search = await searchParams;
  const query = new URLSearchParams({view:"captains"});
  for (const key of ["captain","captainCursor","q","enabled","sort"]) {
    const raw = search[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key,value.slice(0,160));
  }
  redirect("/operations?"+query.toString());
}

export const metadata = { title: "الكباتن — العمليات" };
