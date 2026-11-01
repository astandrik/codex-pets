import {createHash}from'node:crypto';
import{describe,it,expect,vi}from'vitest';
import{readHttpDiagnostic,logSpriteHttpDiagnostic}from'./http-diagnostic';
const requestId='req_'+'a'.repeat(32),cfRay='1234567890abcdef-AMS';
const data={status:520,expectedBodyBytes:160,receivedBodyBytes:0,receivedBodyBytesExact:true,bodyComplete:false,chunked:false,phase:'body',requestId,cfRay};
const context={generationId:'1'.repeat(64),stage:'waving' as const,attempt:1};
describe('private HTTP diagnostics',()=>{
 it('supports configured attempts through 51 and rejects out-of-range attempts',()=>{
  const write=vi.fn(),line='PET_HTTP_DIAGNOSTIC '+JSON.stringify(data);
  for(const attempt of [3,4,5,51,52,0,1.5])logSpriteHttpDiagnostic(line,{...context,attempt},write);
  expect(write.mock.calls.map(([value])=>JSON.parse(value).attempt)).toEqual([3,4,5,51]);
 });
 it('keeps only allowed metadata and valid provider trace identifiers',()=>{
  expect(readHttpDiagnostic({...data,body:'private body',headers:{Authorization:'Bearer secret'}})).toEqual(data);
  expect(readHttpDiagnostic({...data,requestId:'Bearer secret',cfRay:'https://private.example/secret'})).toEqual({...data,requestId:null,cfRay:null});
 });
 it('keeps unknown sizes distinct from zero and preserves inexact counts',()=>{
  expect(readHttpDiagnostic({...data,status:null,expectedBodyBytes:null,receivedBodyBytesExact:false,phase:'before_headers',requestId:null,cfRay:null})).toMatchObject({status:null,expectedBodyBytes:null,receivedBodyBytes:0,receivedBodyBytesExact:false});
 });
 it.each([{status:true},{status:600},{receivedBodyBytes:-1},{expectedBodyBytes:Number.MAX_SAFE_INTEGER+1},{phase:'private payload'},{bodyComplete:1}])('drops malformed core metadata without changing generation outcomes: %j',invalid=>{
  expect(readHttpDiagnostic({...data,...invalid})).toBeUndefined();
 });
 it('logs a task hash, stage and attempt without capability identifiers or private contents',()=>{
  const write=vi.fn();logSpriteHttpDiagnostic('ignored warning\nPET_HTTP_DIAGNOSTIC '+JSON.stringify({...data,body:'private body',headers:{Authorization:'Bearer secret'}}),context,write);
  expect(write).toHaveBeenCalledTimes(1);const line=write.mock.calls[0][0];expect(JSON.parse(line)).toEqual({operation:'pet-generation-http',at:expect.any(Number),targetHash:createHash('sha256').update(context.generationId).digest('hex'),stage:'waving',attempt:1,...data});
  expect(line).not.toContain(context.generationId);expect(line).not.toMatch(/Bearer|private body|Authorization|headers|generationId/);
 });
 it('ignores non-protocol stderr and emits at most one record per attempt',()=>{
  const write=vi.fn();logSpriteHttpDiagnostic('raw secret\nPET_HTTP_DIAGNOSTIC invalid\nPET_HTTP_DIAGNOSTIC '+JSON.stringify(data)+'\nPET_HTTP_DIAGNOSTIC '+JSON.stringify(data),context,write);expect(write).toHaveBeenCalledTimes(1);
  write.mockClear();logSpriteHttpDiagnostic('PET_HTTP_DIAGNOSTIC '+JSON.stringify({...data,body:'x'.repeat(5000)}),context,write);expect(write).not.toHaveBeenCalled();
 });
 it('does not throw when log output fails',()=>{
  expect(()=>logSpriteHttpDiagnostic('PET_HTTP_DIAGNOSTIC '+JSON.stringify(data),context,()=>{throw Error('log unavailable');})).not.toThrow();
 });
});
