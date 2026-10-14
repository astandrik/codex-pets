import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {StageName} from './model';

const requestIdPattern=/^(?:req_[a-f0-9]{32}|[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const cfRayPattern=/^[a-f0-9]{12,32}-[A-Z]{3}$/;
const size=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const schema=z.object({
  status:z.number().int().min(100).max(599).nullable(),
  expectedBodyBytes:size.nullable(),receivedBodyBytes:size,
  receivedBodyBytesExact:z.boolean(),bodyComplete:z.boolean(),chunked:z.boolean(),
  phase:z.enum(['before_headers','body','complete']),
  requestId:z.string().regex(requestIdPattern).nullable(),cfRay:z.string().regex(cfRayPattern).nullable(),
});
export type HttpDiagnostic=z.infer<typeof schema>;
export function readHttpDiagnostic(value:unknown):HttpDiagnostic|undefined{
  if(!value||typeof value!=='object')return undefined;
  const fields:Record<string,unknown>={};
  for(const key of Object.keys(schema.shape))if(Object.hasOwn(value,key))fields[key]=Reflect.get(value,key);
  for(const [key,pattern]of [['requestId',requestIdPattern],['cfRay',cfRayPattern]]as const){
    const id=fields[key];fields[key]=typeof id==='string'&&pattern.test(id)?id:null;
  }
  const parsed=schema.safeParse(fields);return parsed.success?parsed.data:undefined;
}
export function logSpriteHttpDiagnostic(stderr:string,context:{generationId:string;stage:StageName;attempt:number},write:(line:string)=>void=console.log):void{
  try{
    if(context.attempt!==1&&context.attempt!==2)return;
    const prefix='PET_HTTP_DIAGNOSTIC ';
    for(const line of stderr.split('\n')){
      if(!line.startsWith(prefix)||line.length>4096)continue;
      let input:unknown;try{input=JSON.parse(line.slice(prefix.length));}catch{continue;}
      const diagnostic=readHttpDiagnostic(input);if(!diagnostic)continue;
      write(JSON.stringify({operation:'pet-generation-http',at:Date.now(),targetHash:createHash('sha256').update(context.generationId).digest('hex'),stage:context.stage,attempt:context.attempt,...diagnostic}));
      return;
    }
  }catch{
    // Diagnostics must never turn a provider result into another paid attempt.
  }
}
