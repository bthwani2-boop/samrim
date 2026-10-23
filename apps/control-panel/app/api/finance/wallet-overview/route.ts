import { NextResponse } from "next/server";
import { dshErrorPayload, isDshClientError, listOperatorFinancialStatementSummaries } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

const actorTypes = ["customer", "partner", "captain", "field"] as const;
const maxPages = 30;
type Group = Readonly<{type: typeof actorTypes[number]; count: number; amount: number; held: number; available: number; complete: boolean; pages: number; error?: string}>;
export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
  if (identity.role !== "operator" || !identity.permissions?.includes("finance")) return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
  const query = new URL(request.url).searchParams;
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return NextResponse.json({error:{code:"INVALID_DATE_RANGE"}},{status:400});
  const groups = await Promise.all(actorTypes.map(async(type):Promise<Group>=>{
    let cursor = "", count=0, amount=0, held=0, available=0, pages=0;
    const visited = new Set<string>();
    try {
      while (pages < maxPages) {
        const response = await listOperatorFinancialStatementSummaries(type,from,to,cursor,{operatorActorId:identity.subject});
        pages++;
        for (const row of response.summaries) {
          count++;
          amount += row.currentBalanceMinor;
          held += row.heldMinor;
          available += row.availableMinor;
        }
        if (![amount,held,available].every(Number.isSafeInteger)) throw new Error("AMOUNT_OVERFLOW");
        const next = response.nextCursor ?? "";
        if (!next) return {type,count,amount,held,available,complete:true,pages};
        if (visited.has(next)) throw new Error("CURSOR_CYCLE");
        visited.add(next);cursor=next;
      }
      return {type,count,amount,held,available,complete:false,pages};
    } catch (error) {
      if (isDshClientError(error)) return {type,count,amount,held,available,complete:false,pages,error:dshErrorPayload(error).code};
      return {type,count,amount,held,available,complete:false,pages,error:"INCOMPLETE_SOURCE"};
    }
  }));
  return NextResponse.json({groups,complete:groups.every(group=>group.complete),maxPages},{headers:{"Cache-Control":"private, no-store"}});
}
