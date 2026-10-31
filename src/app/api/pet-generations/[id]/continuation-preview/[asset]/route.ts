import {petGeneration} from "@/lib/pets/generation/service";
import {GENERATION_HEADERS,generationHttpError} from "@/lib/pets/generation/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string;asset:string}>}){
 try{const {id,asset}=await params;const result=await petGeneration.getContinuationPreview(id,asset,new URL(request.url).searchParams.get("v")??"");return new Response(new Uint8Array(result.bytes),{headers:{...GENERATION_HEADERS,"Content-Type":result.contentType}});}
 catch(error){return generationHttpError(error);}
}
