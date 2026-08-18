import { NextResponse } from "next/server";
import { evidenceHealth } from "@/lib/kagua/evidence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){const evidence=evidenceHealth();return NextResponse.json({status:"ok",service:"kagua",evidenceEngine:"v1",...evidence,configured:{crossrefContact:Boolean(process.env.KAGUA_CONTACT_EMAIL),openAlexApiKey:Boolean(process.env.OPENALEX_API_KEY),institutionalEvidenceAdapter:Boolean(process.env.KAGUA_EVIDENCE_ADAPTER_URL),serverCloudLlm:Boolean(process.env.KAGUA_CLOUD_API_KEY)},timestamp:new Date().toISOString()})}
