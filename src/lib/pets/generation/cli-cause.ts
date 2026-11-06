import {z} from "zod";

export const cliCauseSchema=z.object({
  kind:z.enum(["timeout","connection_reset","connection_refused","broken_pipe","tls_error","dns_error","incomplete_response","remote_disconnected","invalid_json","invalid_encoding","io_error","http_error","invalid_response_shape","missing_image","invalid_image","transport_error","unclassified"]),
  errno:z.number().int().min(-4096).max(4096).optional(),
  httpStatus:z.number().int().min(400).max(599).optional(),
  requestSent:z.literal(false).optional(),
}).strict().refine(value=>value.requestSent===undefined||(value.kind==="tls_error"&&value.httpStatus===undefined));
export type CliCause=z.infer<typeof cliCauseSchema>;
export function isUnsentTlsHandshake(cause: CliCause | undefined): boolean {
  return cause?.kind === "tls_error" && cause.requestSent === false;
}
export function isUnsentImageFailure(failure: {code: string; cliCause?: CliCause; providerFailure?: unknown}): boolean {
  return failure.code === "provider_not_sent" && isUnsentTlsHandshake(failure.cliCause) && failure.providerFailure === undefined;
}
export function isRetryableImageCause(cause:CliCause|undefined):boolean{
  return cause?.kind==="remote_disconnected"||cause?.kind==="incomplete_response"
    ||(cause?.kind==="http_error"&&(cause.httpStatus===500||cause.httpStatus===520));
}
export function isRetryableImageFailure(failure: {code: string; cliCause?: CliCause; providerFailure?: unknown}): boolean {
  if (failure.code === "provider_not_sent") {
    return isUnsentImageFailure(failure) && failure.cliCause?.errno === 8;
  }
  return failure.code === "outcome_unknown" && isRetryableImageCause(failure.cliCause);
}
export function readCliCause(value:unknown):CliCause|undefined{
  if(!value||typeof value!=="object")return undefined;
  const fields:Record<string,unknown>={};
  for(const key of ["kind","errno","httpStatus","requestSent"])if(Object.hasOwn(value,key))fields[key]=Reflect.get(value,key);
  const parsed=cliCauseSchema.safeParse(fields);
  return parsed.success?parsed.data:undefined;
}

export const errorDetailsSchema=z.object({
  chain:z.array(z.object({
    type:z.enum(["SystemExit","RemoteDisconnected","ConnectionResetError","ConnectionRefusedError","BrokenPipeError","TimeoutError","SSLError","SSLCertVerificationError","gaierror","IncompleteRead","JSONDecodeError","UnicodeDecodeError","URLError","HTTPError","OSError","UnknownException"]),
    message:z.enum(["Remote end closed connection without response","Connection reset","Connection refused","Broken pipe","Operation timed out","TLS error; private details omitted","DNS resolution failed","Incomplete HTTP response","Invalid JSON response; document omitted","Invalid response encoding","HTTP error; response body omitted","CLI exited; private message omitted","I/O error; private details omitted","Exception message omitted"]),
    frames:z.array(z.object({file:z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),function:z.string().regex(/^[A-Za-z0-9_.<>]{1,80}$/),line:z.number().int().min(1).max(1_000_000)}).strict()).max(8),
  }).strict()).max(4),
}).strict();
export type ErrorDetails=z.infer<typeof errorDetailsSchema>;
export function readErrorDetails(value:unknown):ErrorDetails|undefined{
  const parsed=errorDetailsSchema.safeParse(value);return parsed.success?parsed.data:undefined;
}
