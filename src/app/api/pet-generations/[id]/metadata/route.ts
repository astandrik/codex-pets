import {petGeneration} from "@/lib/pets/generation/service";
import {assertGenerationOrigin,GENERATION_HEADERS,generationHttpError,readGenerationJson} from "@/lib/pets/generation/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
  try{assertGenerationOrigin(request);const input=await readGenerationJson(request,4096);return Response.json({metadata:await petGeneration.editMetadata((await params).id,input)},{headers:GENERATION_HEADERS});}
  catch(error){return generationHttpError(error,true);}
}
