import{NextRequest,NextResponse}from"next/server";import{dhetRegistry}from"@/lib/kagua/evidence";import{publisherGroup,publisherLabel}from"@/lib/kagua/publishers";
export const runtime="nodejs";

export async function GET(req:NextRequest){const q=(req.nextUrl.searchParams.get("q")||"").toLowerCase().trim(),quartiles=(req.nextUrl.searchParams.get("quartiles")||"").split(",").filter(Boolean),publisher=(req.nextUrl.searchParams.get("publisher")||"").trim(),jmin=Number(req.nextUrl.searchParams.get("jifMin")),jmax=Number(req.nextUrl.searchParams.get("jifMax")),hasMin=req.nextUrl.searchParams.has("jifMin")&&!Number.isNaN(jmin),hasMax=req.nextUrl.searchParams.has("jifMax")&&!Number.isNaN(jmax),verified=req.nextUrl.searchParams.get("verifiedJif")==="true",limit=Math.min(500,Math.max(20,Number(req.nextUrl.searchParams.get("limit")||100)));let rows=dhetRegistry();

const publisherCounts = new Map<string, number>();
for (const r of rows as any[]) {
  const group = r.publisher ? publisherGroup(r.publisher) : null;
  if (group) publisherCounts.set(group, (publisherCounts.get(group) || 0) + 1);
}
const publishers = [...publisherCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([group, count]) => ({ value: group, label: publisherLabel(group), count }));

if(q)rows=rows.filter((r:any)=>`${r.title} ${r.publisher||""} ${(r.issns||[]).join(" ")} ${(r.indices||[]).join(" ")}`.toLowerCase().includes(q));if(publisher)rows=rows.filter((r:any)=>r.publisher&&publisherGroup(r.publisher)===publisher);if(quartiles.length)rows=rows.filter((r:any)=>r.quartile&&quartiles.includes(r.quartile));if(verified||hasMin||hasMax)rows=rows.filter((r:any)=>r.impactFactor!=null);if(hasMin)rows=rows.filter((r:any)=>r.impactFactor>=jmin);if(hasMax)rows=rows.filter((r:any)=>r.impactFactor<=jmax);return NextResponse.json({total:rows.length,returned:Math.min(rows.length,limit),rows:rows.slice(0,limit),publishers});}
