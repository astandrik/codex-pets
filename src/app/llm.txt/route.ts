import { GET as getLlmsTxt } from "@/app/llms.txt/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return getLlmsTxt();
}
