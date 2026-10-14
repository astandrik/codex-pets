import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({principal:vi.fn(),isAdmin:vi.fn(),inspect:vi.fn(),grant:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({getCurrentPrincipal:mocks.principal,isAdminUser:mocks.isAdmin}));
vi.mock("./quota-admin",()=>({quotaAdmin:{inspect:mocks.inspect,grant:mocks.grant}}));
import { POST as inspectQuota } from "@/app/api/admin/generation-quotas/route";
import { POST as grantQuota } from "@/app/api/admin/generation-quotas/grants/route";
import { GenerationError } from "./model";
const body={ip:"203.0.113.5",amount:2,day:"2026-10-11",requestId:"6d6f97f1-d421-4d5f-9d35-e0dc716f718f"};
function request(value:unknown=body,headers:Record<string,string>={}) {return new Request("https://pets.example/api/admin/generation-quotas/grants",{method:"POST",headers:{origin:"https://pets.example","content-type":"application/json",...headers},body:typeof value==='string'?value:JSON.stringify(value)});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_APP_URL','https://pets.example');mocks.principal.mockResolvedValue({userId:'admin-from-session'});mocks.isAdmin.mockReturnValue(true);mocks.grant.mockResolvedValue({requestId:body.requestId,amount:2});mocks.inspect.mockResolvedValue({ipUsed:3,ipLimit:5});});
afterEach(()=>vi.unstubAllEnvs());
describe('private admin quota routes',()=>{
 it('uses the admin session actor and never accepts an actor from the body',async()=>{
  const r=await grantQuota(request());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');
  expect(mocks.grant).toHaveBeenCalledWith(body,'admin-from-session');
  expect((await grantQuota(request({...body,actorId:'other'}))).status).toBe(400);
  expect(mocks.grant).toHaveBeenCalledTimes(1);
 });
 it('denies anonymous and non-admin users before reading or granting',async()=>{
  mocks.principal.mockResolvedValueOnce(null);expect((await grantQuota(request())).status).toBe(403);
  mocks.isAdmin.mockReturnValue(false);expect((await inspectQuota(request({ip:body.ip}))).status).toBe(403);
  expect(mocks.grant).not.toHaveBeenCalled();expect(mocks.inspect).not.toHaveBeenCalled();
 });
 it.each<Record<string,string>>([{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'},{origin:''}])('rejects cross-site input %j',async headers=>{
  expect((await grantQuota(request(body,headers))).status).toBe(403);expect(mocks.grant).not.toHaveBeenCalled();
 });
 it('rejects oversized malformed/nonJSON bodies without mutation',async()=>{
  expect((await grantQuota(request(' '.repeat(1025)))).status).toBe(413);
  expect((await grantQuota(request('{'))).status).toBe(400);
  expect((await grantQuota(request(body,{'content-type':'text/plain'}))).status).toBe(400);
  expect(mocks.grant).not.toHaveBeenCalled();
 });
 it('inspects an IP only from the POST body and never grants',async()=>{
  const r=await inspectQuota(request({ip:body.ip}));expect(await r.json()).toEqual({quota:{ipUsed:3,ipLimit:5}});
  expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(body.ip);expect(mocks.grant).not.toHaveBeenCalled();
 });
 it('keeps unknown failures private and exposes actionable day/conflict errors',async()=>{
  mocks.grant.mockRejectedValueOnce(Error('private IP/key provider body'));
  let r=await grantQuota(request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private IP');
  mocks.grant.mockRejectedValueOnce(new GenerationError('quota_day_changed'));r=await grantQuota(request());expect(r.status).toBe(409);expect((await r.json()).code).toBe('quota_day_changed');
 });
});
