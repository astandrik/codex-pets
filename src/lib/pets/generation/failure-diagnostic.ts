import {z} from "zod";

export const failureDiagnosticSchema=z.object({
  boundary:z.enum(["provider_cli","provider_report","provider_image","renderer_process","renderer_reply","artifact","checkpoint","intent","lease"]),
  reason:z.enum(["process_timeout","process_exit","process_spawn","output_buffer_limit","invalid_json","invalid_schema","invalid_identity","unexpected_dimensions","invalid_image","missing_file","invalid_size","missing_duration","io_error","unconfirmed_write","unclassified","expired_lease","heartbeat_failed"]),
  elapsedMs:z.number().int().min(0).max(600_000).optional(),
  exitCode:z.number().int().min(-255).max(255).optional(),
  signal:z.enum(["SIGTERM","SIGKILL","SIGSEGV","SIGABRT","SIGBUS"]).optional(),
  width:z.number().int().min(0).max(32768).optional(),
  height:z.number().int().min(0).max(32768).optional(),
  bytes:z.number().int().min(0).max(1_073_741_824).optional(),
  usageAvailable:z.boolean().optional(),
}).strict();
export type FailureDiagnostic=z.infer<typeof failureDiagnosticSchema>;

export function readFailureDiagnostic(value:unknown):FailureDiagnostic|undefined{
  if(!value||typeof value!=="object")return undefined;
  const fields:Record<string,unknown>={};
  for(const key of Object.keys(failureDiagnosticSchema.shape)){
    if(Object.hasOwn(value,key))fields[key]=Reflect.get(value,key);
  }
  const result=failureDiagnosticSchema.safeParse(fields);
  return result.success?result.data:undefined;
}
