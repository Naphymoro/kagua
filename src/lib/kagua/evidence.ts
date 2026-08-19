import{readFileSync}from"node:fs";import{join}from"node:path";import{gunzipSync}from"node:zlib";import type{AfricaAuthorshipSignal,AnalysisRequest,CustomJournalEntry,EvidenceItem,Journal,JournalScore,SimilarWork}from"./types";type DhetRecord={title:string;publisher?:string|null;issns:string[];indices:string[];metrics?:{impactFactor?:number|null;impactFactorYear?:number|null;quartile?:"Q1"|"Q2"|"Q3"|"Q4"|null};details?:any};type DhetIndex={source?:string;edition:string;retrievedAt:string;sourceUrl:string;recordsByIssn:Record<string,DhetRecord>};const DHET=JSON.parse(gunzipSync(readFileSync(join(process.cwd(),"src/lib/kagua/data/dhet-2025-2026.json.gz"))).toString("utf8"))as DhetIndex;const CR="https://api.crossref.org/v1",OA="https://api.openalex.org",DOAJ="https://doaj.org/api",now=()=>new Date().toISOString(),norm=(v:unknown)=>{const s=String(v??"").toUpperCase().replace(/[^0-9X]/g,"");return s.length===8?`${s.slice(0,4)}-${s.slice(4)}`:null},txt=(v:unknown)=>String(v??"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();async function json(url:string,headers:Record<string,string>={}){const c=new AbortController(),id=setTimeout(()=>c.abort(),12000);try{const r=await fetch(url,{headers,signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.json()}finally{clearTimeout(id)}}
const contactEmail=()=>process.env.KAGUA_CONTACT_EMAIL||"",mailtoQS=()=>{const e=contactEmail();return e?`&mailto=${encodeURIComponent(e)}`:""};
// A single analyze run can fan out to 80+ candidate journals, each needing
// its own OpenAlex/DOAJ lookup — firing all of them at once (the previous
// behaviour) is exactly the kind of burst that trips rate limits and comes
// back as silent empty results downstream (e.g. the "similar work" panel
// just disappearing with no evidence of why). pLimit caps real concurrency
// while still running everything in one Promise.all-shaped call.
function pLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{const results:R[]=new Array(items.length);let next=0;async function worker(){while(next<items.length){const i=next++;results[i]=await fn(items[i])}}return Promise.all(new Array(Math.min(limit,items.length)).fill(0).map(worker)).then(()=>results)}
async function crossref(r:AnalysisRequest){const email=process.env.KAGUA_CONTACT_EMAIL||"",q=txt(`${r.title} ${(r.keywords||[]).join(" ")} ${r.abstract}`).slice(0,1400),d=await json(`${CR}/works?query.bibliographic=${encodeURIComponent(q)}&filter=type:journal-article&rows=300${email?`&mailto=${encodeURIComponent(email)}`:""}`,{"User-Agent":`Kagua/1.0${email?` (mailto:${email})`:""}`})as any,m=new Map<string,any>();for(const w of d?.message?.items||[]){const ids=(w.ISSN||[]).map(norm).filter(Boolean)as string[],name=txt(w["container-title"]?.[0]);if(!ids.length||!name)continue;const k=ids[0],x=m.get(k)||{name,publisher:txt(w.publisher),issns:new Set<string>(),works:0,citations:0,topics:[]};ids.forEach(i=>x.issns.add(i));x.works++;x.citations+=Number(w["is-referenced-by-count"]||0);x.topics.push(txt(w.title?.[0]));m.set(k,x)}return[...m.values()].map(x=>({...x,issns:[...x.issns]}))}
async function openalex(r:AnalysisRequest){const p=new URLSearchParams({search:txt(`${r.title} ${(r.keywords||[]).join(" ")} ${r.abstract}`).slice(0,1100),"per-page":"200"});if(process.env.OPENALEX_API_KEY)p.set("api_key",process.env.OPENALEX_API_KEY);const e=contactEmail();if(e)p.set("mailto",e);const d=await json(`${OA}/works?${p}`)as any,m=new Map<string,any>();for(const w of d?.results||[]){const s=w?.primary_location?.source,ids=(Array.isArray(s?.issn)?s.issn:[s?.issn_l]).map(norm).filter(Boolean)as string[];if(!s?.display_name||!ids.length)continue;const k=ids[0],x=m.get(k)||{name:txt(s.display_name),publisher:txt(s.host_organization_name),issns:new Set<string>(),works:0,citations:0,topics:[],sourceId:s.id};ids.forEach(i=>x.issns.add(i));x.works++;x.citations+=Number(w.cited_by_count||0);if(w.primary_topic?.display_name)x.topics.push(txt(w.primary_topic.display_name));m.set(k,x)}return[...m.values()].map(x=>({...x,issns:[...x.issns]}))}
async function metrics(id?:string){if(!id)return null;try{const e=contactEmail();return await json(`${OA}/sources/${id.split("/").pop()}${e?`?mailto=${encodeURIComponent(e)}`:""}`)as any}catch{return null}}async function doaj(ids:string[]){for(const id of ids)try{const d=await json(`${DOAJ}/search/journals/${encodeURIComponent(`issn:${id}`)}?pageSize=1`)as any,b=d?.results?.[0]?.bibjson;if(!b)continue;const prices=Array.isArray(b.apc?.max)?b.apc.max:[],usd=prices.find((x:any)=>String(x.currency).toUpperCase()==="USD");return{usd:b.apc?.has_apc===false?0:usd?Number(usd.price):null,display:b.apc?.has_apc===false?"No APC":prices.length?prices.map((x:any)=>`${x.price} ${x.currency}`).join(" / "):null}}catch{}return null}
function dhet(ids:string[]){for(const id of ids){const x=DHET.recordsByIssn[id];if(x)return x}return null}
// DHET's own workbook carries zero JIF/quartile rows this edition (it's an
// accreditation list, not a bibliometric database — see build-dhet-index.mjs
// logging "0 rows with explicit JIF/quartile evidence"), and modern
// publisher sites overwhelmingly render their stated metrics client-side
// (verified directly: ScienceDirect ships no figure in its static HTML,
// MDPI blocks unauthenticated crawlers outright) so a lightweight
// server-side fetch+regex crawler cannot reliably read them either. This
// is the one path that actually works without a paid Clarivate/Scopus API
// licence: let researchers upload the metrics their own library already
// has (e.g. a Journal Citation Reports export), reusing the same
// ISSN-matched upload flow as the eligibility list.
function customListMetrics(r:AnalysisRequest){const m=new Map<string,CustomJournalEntry>();for(const e of r.customJournalList?.entries||[]){if(e.impactFactor==null&&!e.quartile)continue;for(const id of e.issns||[])if(!m.has(id))m.set(id,e)}return m}type Inst={issn:string;quartile?:"Q1"|"Q2"|"Q3"|"Q4";impactFactor?:number;impactFactorYear?:number;impactFactorPercentile?:number;apcUsd?:number;firstDecisionDays?:number;sourceUrl?:string;observedAt?:string;confidence?:number};async function institutional(rows:any[]){const url=process.env.KAGUA_EVIDENCE_ADAPTER_URL,m=new Map<string,Inst>();if(!url)return m;try{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(process.env.KAGUA_EVIDENCE_ADAPTER_TOKEN?{Authorization:`Bearer ${process.env.KAGUA_EVIDENCE_ADAPTER_TOKEN}`}:{})},body:JSON.stringify({journals:rows.map(x=>({name:x.name,issns:x.issns}))})});if(!r.ok)return m;const d=await r.json()as any;for(const x of d.journals||[]){const id=norm(x.issn);if(id)m.set(id,{...x,issn:id})}}catch{}return m}
export async function buildEvidenceJournals(r:AnalysisRequest){const settled=await Promise.allSettled([crossref(r),openalex(r)]),cr=settled[0].status==="fulfilled"?settled[0].value:[],oa=settled[1].status==="fulfilled"?settled[1].value:[],sources:string[]=[];if(cr.length)sources.push("Crossref");if(oa.length)sources.push("OpenAlex");if(!sources.length)throw new Error("Live scholarly evidence providers are unavailable; Kagua does not substitute seed data.");const merged=new Map<string,any>();for(const[source,rows]of[["Crossref",cr],["OpenAlex",oa]]as const)for(const z of rows){const k=z.issns[0],x=merged.get(k)||{...z,providers:new Set<string>(),topics:[],works:0,citations:0};x.providers.add(source);x.works=Math.max(x.works,z.works);x.citations=Math.max(x.citations,z.citations);x.topics=[...new Set([...x.topics,...z.topics])].slice(0,30);x.issns=[...new Set([...(x.issns||[]),...z.issns])];if(!x.sourceId&&z.sourceId)x.sourceId=z.sourceId;merged.set(k,x)}const excluded=new Set((r.excludeJournalIds||[]).map(norm).filter(Boolean)),pool=[...merged.values()].sort((a,b)=>b.works-a.works||b.citations-a.citations).filter(x=>!excluded.has(norm(x.issns[0]))).slice(0,80),ms=await pLimit(pool,8,async x=>{const sid=x.sourceId||await resolveSourceId(x.issns);if(sid&&!x.sourceId)x.sourceId=sid;return metrics(sid)}),ds=await pLimit(pool,8,x=>doaj(x.issns)),im=await institutional(pool),cl=customListMetrics(r);if(ds.some(Boolean))sources.push("DOAJ");if(im.size)sources.push("Institutional evidence adapter");if(cl.size)sources.push(`Uploaded list (${r.customJournalList?.name||"institution metrics"})`);const journals:Journal[]=pool.map((x,i)=>{const dh=dhet(x.issns),m=ms[i],dj=ds[i],ie=x.issns.map((id:string)=>im.get(id)).find(Boolean),cle=x.issns.map((id:string)=>cl.get(id)).find(Boolean),dqm=dh?.metrics,e:EvidenceItem[]=[];for(const p of x.providers as Set<string>)e.push({source:p as"Crossref"|"OpenAlex",field:"manuscript_match",value:x.works,observedAt:now(),confidence:.87,note:"Relevant publications found for this journal in the live manuscript search."});if(dh)e.push({source:"DHET",field:"recognition",value:dh.indices.join(", "),observedAt:DHET.retrievedAt,confidence:1,url:DHET.sourceUrl,note:`Official ${DHET.edition} workbook; ISSN match.`});if(dqm?.quartile)e.push({source:"DHET",field:"quartile",value:dqm.quartile,observedAt:DHET.retrievedAt,confidence:1,url:DHET.sourceUrl,note:`Explicit quartile column in official ${DHET.edition} workbook; ISSN match.`});if(dqm?.impactFactor!=null)e.push({source:"DHET",field:"journal_impact_factor",value:dqm.impactFactor,observedAt:DHET.retrievedAt,confidence:1,url:DHET.sourceUrl,note:`Explicit Impact Factor column in official ${DHET.edition} workbook${dqm.impactFactorYear?`; metric year ${dqm.impactFactorYear}`:""}; ISSN match.`});if(m)e.push({source:"OpenAlex",field:"source_metrics",value:Number(m.works_count||0),observedAt:now(),confidence:.9,url:m.id,note:`OpenAlex h-index ${Number(m.summary_stats?.h_index||0)}.`});if(dj)e.push({source:"DOAJ",field:"article_processing_charge",value:dj.display??"Not stated",observedAt:now(),confidence:.9,note:"DOAJ APC metadata."});if(ie?.quartile)e.push({source:"LicensedRanking",field:"quartile",value:ie.quartile,observedAt:ie.observedAt||now(),confidence:ie.confidence??.95,url:ie.sourceUrl,note:"Authorised institutional evidence."});if(ie?.impactFactor!=null)e.push({source:"LicensedRanking",field:"journal_impact_factor",value:ie.impactFactor,observedAt:ie.observedAt||now(),confidence:ie.confidence??.98,url:ie.sourceUrl,note:"Authorised JIF evidence; OpenAlex is never relabelled JIF."});if(cle?.quartile)e.push({source:"UniversityList",field:"quartile",value:cle.quartile,observedAt:now(),confidence:.88,note:`From the uploaded ${r.customJournalList?.name||"institution"} list; ISSN match. Only as reliable as that upload.`});if(cle?.impactFactor!=null)e.push({source:"UniversityList",field:"journal_impact_factor",value:cle.impactFactor,observedAt:now(),confidence:.88,note:`From the uploaded ${r.customJournalList?.name||"institution"} list${cle.impactFactorYear?`; metric year ${cle.impactFactorYear}`:""}; ISSN match. Only as reliable as that upload — verify against its original source before relying on it.`});let conf=.48+x.providers.size*.12;if(dh)conf+=.17;if(m)conf+=.08;if(dj)conf+=.07;if(ie||dqm?.impactFactor!=null||dqm?.quartile)conf+=.12;if(cle)conf+=.08;conf=Math.min(1,conf);return{id:norm(x.issns[0])||x.issns[0],name:dh?.title||x.name,publisher:dh?.publisher||cle?.publisher||x.publisher||"Publisher not resolved",issns:x.issns,domains:x.topics,topics:x.topics,sourceId:x.sourceId||null,quartile:dqm?.quartile||ie?.quartile||cle?.quartile||"Unverified",impactFactor:dqm?.impactFactor??ie?.impactFactor??cle?.impactFactor??null,impactFactorYear:dqm?.impactFactorYear??ie?.impactFactorYear??cle?.impactFactorYear??null,impactFactorPercentile:ie?.impactFactorPercentile??null,openAlexHIndex:m?.summary_stats?.h_index!=null?Number(m.summary_stats.h_index):null,openAlexTwoYearMeanCitedness:m?.summary_stats?.["2yr_mean_citedness"]!=null?Number(m.summary_stats["2yr_mean_citedness"]):null,prestige:.5,apcUsd:ie?.apcUsd??dj?.usd??null,apcDisplay:ie?.apcUsd!=null?`$${ie.apcUsd.toLocaleString()} USD`:dj?.display??null,firstDecisionDays:ie?.firstDecisionDays??null,dhet:dh?"Recognised":"Not found in current DHET index",dhetIndices:dh?.indices||[],integrity:dh?.93:.82,evidenceConfidence:conf,matchedWorks:x.works,matchedCitations:x.citations,evidence:e}});return{journals:r.dhetOnly?journals.filter(j=>j.dhet==="Recognised"):journals,sources}}
// 54 UN-recognised African states, ISO 3166-1 alpha-2. Used only to read
// OpenAlex author-institution country codes already present in the API
// response — no new personal data is collected, just a country-level
// aggregate over a small live sample.
const AFRICA_CODES=new Set(["DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","CI","DJ","EG","GQ","ER","SZ","ET","GA","GM","GH","GN","GW","KE","LS","LR","LY","MG","MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW","ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW"]);
function workHasAfricaAuthor(w:any):boolean{for(const a of w?.authorships||[])for(const inst of a?.institutions||[])if(AFRICA_CODES.has(String(inst?.country_code||"").toUpperCase()))return true;return false}
function workUrl(w:any):string|null{const doi=w?.doi?String(w.doi).replace(/^https?:\/\/doi\.org\//,""):null;return doi?`https://doi.org/${doi}`:w?.id||null}
// The initial broad discovery search (openalex() above) only assigns a
// sourceId to a journal when one of its OWN matched-manuscript works
// happened to come from OpenAlex with a resolvable source — OpenAlex's
// full-text search is narrow enough that this is often empty even when
// Crossref/DOAJ evidence exists. Resolving the source by ISSN directly
// decouples this enrichment step from that upstream gap.
async function resolveSourceId(issns:string[]):Promise<string|null>{for(const id of issns){try{const d=await json(`${OA}/sources?filter=issn:${encodeURIComponent(id)}&per-page=1${mailtoQS()}`)as any,hit=d?.results?.[0];if(hit?.id)return hit.id as string}catch{}}return null}

// Runs only on the final shortlist actually shown to the researcher (top 5
// per batch, not the full 50-row explorer) — informational only, does not
// feed back into KPOS/KTS ranking. Answers two questions per journal: what
// does this journal's most topically similar recent work actually look
// like, and does that journal have a track record of publishing
// Africa-affiliated authors? Both are sample-based (the same handful of
// live-search results), stated as such in the evidence note rather than
// implied to be a full journal census.
// OpenAlex's `search` param, once a `filter` is also present, compiles to a
// strict full-text CONTAINS match on the whole string (visible directly in
// the API's own returned oql: "full text has (<entire query>)"), not a
// tokenised relevance ranking. A 20+ word query built from title+keywords
// therefore matches almost nothing — confirmed by reproducing it live
// against the API: a 3-4 word query returned 11-100+ hits on the exact
// same journal where the long query returned zero. Keep this short.
function shortTopicQuery(r:AnalysisRequest):string{
  // Title and abstract are each independently optional now (a researcher
  // can search on either alone) — keywords first, then whichever of
  // title/abstract is actually present, so this never degenerates to an
  // empty search string.
  const fromKeywords=(r.keywords||[]).slice(0,4).join(" ");
  const fromTitle=txt(r.title||"").split(/\s+/).filter(Boolean).slice(0,6).join(" ");
  const fromAbstract=txt(r.abstract||"").split(/\s+/).filter(Boolean).slice(0,6).join(" ");
  return txt(fromKeywords||fromTitle||fromAbstract).slice(0,120);
}
async function journalWorks(shortId:string,search:string|null,email:string):Promise<any[]>{
  const params=new URLSearchParams({"per-page":"6"});
  if(email)params.set("mailto",email);
  if(search)params.set("search",search);
  params.set("filter",`primary_location.source.id:${shortId}`);
  if(!search)params.set("sort","publication_date:desc");
  const d=await json(`${OA}/works?${params}`)as any;
  return(d?.results||[])as any[];
}
export async function enrichSimilarWork(top:JournalScore[],r:AnalysisRequest):Promise<JournalScore[]>{
  const email=contactEmail(),q=shortTopicQuery(r);
  const settled=await Promise.allSettled(top.map(async(j)=>{
    const sourceId=j.sourceId||await resolveSourceId(j.issns);
    if(!sourceId)return{...j,similarWorks:[],africaAuthorship:null};
    const shortId=sourceId.split("/").pop() as string;
    let items=await journalWorks(shortId,q,email),topicMatched=true;
    // A short query can still legitimately miss (small journal, unusual
    // vocabulary) — fall back to this journal's most recent work rather
    // than showing nothing, but say plainly that it isn't topic-matched.
    if(!items.length){items=await journalWorks(shortId,null,email);topicMatched=false}
    if(!items.length)return{...j,similarWorks:[],africaAuthorship:null};
    const similarWorks:SimilarWork[]=items.slice(0,3).map(w=>({title:txt(w?.title||"Untitled work"),year:w?.publication_year??null,url:workUrl(w),hasAfricaAuthor:workHasAfricaAuthor(w),topicMatched})),africaCount=items.filter(workHasAfricaAuthor).length,africaAuthorship:AfricaAuthorshipSignal={sampleSize:items.length,africaCount,sharePct:Math.round((africaCount/items.length)*100)};
    return{...j,similarWorks,africaAuthorship,evidence:[...j.evidence,{source:"OpenAlex"as const,field:"africa_authorship_sample",value:`${africaCount}/${items.length}`,observedAt:now(),confidence:topicMatched?.75:.55,note:`Share of this journal's ${items.length} most ${topicMatched?"topically similar":"recent (topic search returned no hits, fell back to recency)"} articles (live OpenAlex search) with at least one Africa-affiliated author institution. Sample-based, not a full journal census.`}]};
  }));
  return settled.map((res,i)=>res.status==="fulfilled"?res.value:{...top[i],similarWorks:[],africaAuthorship:null});
}

export const DHET_EDITION=DHET.edition;export function evidenceHealth(){return{dhetDataset:DHET.edition,dhetIssnKeys:Object.keys(DHET.recordsByIssn).length}}
export function dhetRegistry(){const seen=new Set<string>(),rows:any[]=[];for(const r of Object.values(DHET.recordsByIssn)){const key=(r.issns||[]).slice().sort().join("|")||r.title;if(seen.has(key))continue;seen.add(key);rows.push({title:r.title,publisher:r.publisher||null,issns:r.issns||[],indices:r.indices||[],quartile:r.metrics?.quartile||null,impactFactor:r.metrics?.impactFactor??null,impactFactorYear:r.metrics?.impactFactorYear??null,source:"DHET",edition:DHET.edition,sourceUrl:DHET.sourceUrl,retrievedAt:DHET.retrievedAt,matchedBy:"ISSN",details:r.details||null})}return rows.sort((a,b)=>a.title.localeCompare(b.title))}
