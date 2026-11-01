import {petGeneration} from "@/lib/pets/generation/service";
import {readGenerationClientIp} from "@/lib/pets/generation/model";
import {assertGenerationOrigin,GENERATION_HEADERS,generationHttpError,readGenerationJson} from "@/lib/pets/generation/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){
  try{
    const id=(await params).id,requestId=new URL(request.url).searchParams.get("requestId");
    const result=requestId===null?{options:await petGeneration.getBaseRetryOptions(id)}:await petGeneration.findBaseRetry(id,requestId);
    return Response.json(result,{headers:GENERATION_HEADERS});
  }catch(error){return generationHttpError(error,true);}
}
export async function POST(request:Request,{params}:Context){
  try{
    assertGenerationOrigin(request);
    const input=await readGenerationJson(request,16*1024);
    const result=await petGeneration.retryBaseGeneration((await params).id,input,readGenerationClientIp(request.headers));
    return Response.json(result,{status:202,headers:GENERATION_HEADERS});
  }catch(error){return generationHttpError(error,true);}
}
