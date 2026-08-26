import { NextRequest, NextResponse } from "next/server";
import { extractManuscriptFromFile, ManuscriptExtractionError } from "@/lib/kagua/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a manuscript file." }, { status: 400 });
    }

    return NextResponse.json(await extractManuscriptFromFile(file));
  } catch (error) {
    if (error instanceof ManuscriptExtractionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Manuscript extraction failed." }, { status: 502 });
  }
}
