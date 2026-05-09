import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return NextResponse.json({
    error: "deprecated_route",
    message:
      "This deployment no longer uses presigned uploads. Submit directly to /api/submissions/register.",
  }, { status: 410 });
}
