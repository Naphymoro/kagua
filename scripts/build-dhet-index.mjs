import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import XLSX from 'xlsx';
const SOURCE_URL=process.env.DHET_SOURCE_URL||'https://www.dhet.gov.za/Policy%20and%20Development%20Support/2025-2026%20DHET%20List%20of%20%20Accerdited%20Journals.xls';
const OUTPUT=join(process.cwd(),'src/lib/kagua/data/dhet-2025-2026.json.gz');
const ISSN_RE=/\b\d{4}-?\d{3}[\dXx]\b/g;
const norm=v=>{const r=String(v||'').toUpperCase().replace(/[^0-9X]/g,'');return r.length===8?`${r.slice(0,4)}-${r.slice(4)}`:null};
const compact=v=>String(v??'').replace(/\s+/g,' ').trim();
function sourceIndex(name){const n=name.toLowerCase();if(n.includes('scopus'))return'SCOPUS';if(n.includes('web of science')||n.includes('wos')||n.includes('clarivate'))return'WOS';if(n.includes('doaj'))return'DOAJ';if(n.includes('ibss'))return'IBSS';if(n.includes('norweg'))return'NORWEGIAN';if(n.includes('scielo'))return'SCIELO_SA';if(n.includes('dhet')||n.includes('south african'))return'DHET';return name.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}
function issns(row){const out=new Set();for(const cell of row)for(const m of compact(cell).matchAll(ISSN_RE)){const i=norm(m[0]);if(i)out.add(i)}return[...out]}
function title(row){for(const cell of row.map(compact).filter(Boolean)){const s=cell.replace(ISSN_RE,'').trim();if(s.length>=4&&!/^https?:\/\//i.test(s)&&!/^(journal|title|publisher|issn|e-?issn|source|index|notes?|comments?)$/i.test(s)&&!/^\d+$/.test(s))return s}return''}
const response=await fetch(SOURCE_URL,{headers:{'User-Agent':'Kagua/1.0 DHET index builder'}});if(!response.ok)throw new Error(`DHET workbook fetch failed: ${response.status}`);
const workbook=XLSX.read(Buffer.from(await response.arrayBuffer()),{type:'buffer'}),recordsByIssn={};let matchedRows=0;
for(const sheetName of workbook.SheetNames){const index=sourceIndex(sheetName),rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});for(const row of rows){if(!Array.isArray(row))continue;const ids=issns(row),t=title(row);if(!ids.length||!t)continue;matchedRows++;for(const id of ids){const e=recordsByIssn[id];recordsByIssn[id]={title:e?.title||t,publisher:e?.publisher||null,issns:[...new Set([...(e?.issns||[]),...ids])],indices:[...new Set([...(e?.indices||[]),index])].sort(),details:{sheet:sheetName}}}}}
if(Object.keys(recordsByIssn).length<10000)throw new Error(`DHET parse produced only ${Object.keys(recordsByIssn).length} ISSNs; refusing production build.`);
const data={source:'South African Department of Higher Education and Training',edition:'2025-2026',retrievedAt:new Date().toISOString(),sourceUrl:SOURCE_URL,matchedRows,recordsByIssn};mkdirSync(dirname(OUTPUT),{recursive:true});writeFileSync(OUTPUT,gzipSync(Buffer.from(JSON.stringify(data)),{level:9}));console.log(`DHET index ready: ${Object.keys(recordsByIssn).length} ISSN keys.`);
