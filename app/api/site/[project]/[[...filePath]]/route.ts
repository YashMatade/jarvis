import { NextRequest, NextResponse } from "next/server";
import { readSitePreviewFile } from "@/lib/site-preview";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ project: string; filePath?: string[] }> },
) {
  const { project, filePath = [] } = await params;
  const file = await readSitePreviewFile(project, filePath);
  if (!file) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(file.data, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "no-store",
    },
  });
}
