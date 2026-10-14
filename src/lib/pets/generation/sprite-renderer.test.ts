import { afterEach, describe, expect, it, vi } from "vitest";
import { spritegenEnvironment, parseSpritegenReply, processFailureDiagnostic } from "./sprite-renderer";

afterEach(() => vi.unstubAllEnvs());
describe("sprite renderer private transport", () => {
  it("accepts the dedicated per-request SSH proxy without leaking unrelated environment", () => {
    vi.stubEnv("PET_GENERATION_PROXY_URL", "http://172.17.0.1:18090");
    expect(spritegenEnvironment("synthetic-key").HTTPS_PROXY).toBe("http://172.17.0.1:18090");
  });
  it("keeps allowlisted renderer diagnostics but never raw messages",()=>{
    try{parseSpritegenReply(JSON.stringify({error:"outcome_unknown",failureDiagnostic:{boundary:"provider_cli",reason:"process_timeout",elapsedMs:220000,message:"private stderr",command:"secret"}}));expect.unreachable();}
    catch(error){expect(error).toMatchObject({code:"outcome_unknown",diagnostic:{boundary:"provider_cli",reason:"process_timeout",elapsedMs:220000}});expect(JSON.stringify(error)).not.toMatch(/private stderr|secret|command/);}
  });
  it("distinguishes malformed renderer output without including it",()=>{
    try{parseSpritegenReply('private raw output');expect.unreachable();}
    catch(error){expect(error).toMatchObject({code:"outcome_unknown",diagnostic:{boundary:"renderer_reply",reason:"invalid_json"}});expect(JSON.stringify(error)).not.toContain('private raw output');}
  });
  it.each([
    [{killed:true,signal:"SIGTERM"},230001,"process_timeout"],
    [{code:"ERR_CHILD_PROCESS_STDIO_MAXBUFFER",killed:true},10,"output_buffer_limit"],
    [{code:"ENOENT"},1,"process_spawn"],
    [{code:1,signal:"SIGSEGV"},120,"process_exit"],
  ])("classifies process failures without private exception fields",(fields,elapsed,reason)=>{
    const diagnostic=processFailureDiagnostic({...fields,message:"secret prompt",stderr:"private response",cmd:"private path"},elapsed);
    expect(diagnostic).toMatchObject({boundary:"renderer_process",reason,elapsedMs:elapsed});
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret|private|stderr|cmd/);
  });
  it.each(["http://172.17.0.1:18091", "http://example.invalid:18090", "http://user:pass@172.17.0.1:18090"])("refuses unapproved proxy %s", (proxy) => {
    vi.stubEnv("PET_GENERATION_PROXY_URL", proxy);
    expect(() => spritegenEnvironment("synthetic-key")).toThrow("proxy_not_configured");
  });
  it("refuses absent proxy rather than falling back to direct OpenAI", () => {
    vi.stubEnv("PET_GENERATION_PROXY_URL", "");
    expect(() => spritegenEnvironment("synthetic-key")).toThrow("proxy_not_configured");
  });
  it("passes only explicit worker configuration and no inherited base URL", () => {
    vi.stubEnv("PET_GENERATION_PROXY_URL", "http://172.17.0.1:18089");
    vi.stubEnv("OPENAI_BASE_URL", "https://attacker.invalid");
    vi.stubEnv("PRIVATE_UNRELATED_SECRET", "not-for-child");
    const env = spritegenEnvironment("synthetic-key");
    expect(env.HTTPS_PROXY).toBe("http://172.17.0.1:18089");
    expect(env).not.toHaveProperty("OPENAI_BASE_URL");
    expect(env).not.toHaveProperty("PRIVATE_UNRELATED_SECRET");
    expect(env.OPENAI_API_KEY).toBe("synthetic-key");
  });
  it("does not surface provider text or accept negative usage", () => {
    expect(() => parseSpritegenReply('{"error":"provider_rejected","private":"secret"}')).toThrow("provider_rejected");
    expect(() => parseSpritegenReply('private response secret')).toThrow("outcome_unknown");
    expect(() => parseSpritegenReply('{"generationMs":1,"usage":{"costUsd":-1}}')).toThrow("outcome_unknown");
  });
  it("keeps only allowlisted provider failure fields", () => {
    try {
      parseSpritegenReply(JSON.stringify({ error: "provider_rejected", providerFailure: {
        httpStatus: 403, code: "unsupported_country_region_territory", message: "private prompt", apiKey: "secret",
      } }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "provider_rejected", providerFailure: {
        httpStatus: 403, code: "unsupported_country_region_territory",
      } });
      expect(JSON.stringify(error)).not.toMatch(/private prompt|secret|apiKey/);
    }
    expect(() => parseSpritegenReply('{"error":"outcome_unknown","providerFailure":{"httpStatus":503,"code":"server_is_overloaded"}}'))
      .toThrow("outcome_unknown");
  });
});

it("rejects arbitrary CLI categories and numeric fields while dropping private text",()=>{
 for(const cliCause of [{kind:'private text'},{kind:'io_error',errno:'secret'},{kind:'http_error',httpStatus:999}]){
  try{parseSpritegenReply(JSON.stringify({error:'outcome_unknown',cliCause}));expect.unreachable();}
  catch(error){expect(error).toMatchObject({code:'outcome_unknown'});expect(error).not.toHaveProperty('cliCause',cliCause);}
 }
 try{parseSpritegenReply(JSON.stringify({error:'outcome_unknown',cliCause:{kind:'tls_error',errno:1,url:'secret'}}));expect.unreachable();}
 catch(error){expect(error).toHaveProperty('cliCause',{kind:'tls_error',errno:1});}
});
it('accepts structured redacted detail and rejects a raw private message',()=>{
 const details={chain:[{type:'RemoteDisconnected',message:'Remote end closed connection without response',frames:[{file:'client.py',function:'_read_status',line:299}]}]};
 try{parseSpritegenReply(JSON.stringify({error:'outcome_unknown',errorDetails:details}));expect.unreachable();}catch(error){expect(error).toHaveProperty('details',details);}
 try{parseSpritegenReply(JSON.stringify({error:'outcome_unknown',errorDetails:{chain:[{type:'SystemExit',message:'Bearer private prompt',frames:[]}]}}));expect.unreachable();}catch(error){expect(error).toHaveProperty('details',undefined);expect(JSON.stringify(error)).not.toContain('private prompt');}
});
