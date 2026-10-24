import { redirect } from "next/navigation";

export default async function CaptainDetailPage({ params }: Readonly<{ params: Promise<{actorId:string}> }>) {
  const {actorId} = await params;
  redirect("/operations?view=captains&captain="+encodeURIComponent(actorId));
}

export const metadata={title:"ملف الكابتن — العمليات"};
