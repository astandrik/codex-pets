import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({list:vi.fn(),configured:vi.fn()}));
vi.mock('@/lib/pets/repository',()=>({listApprovedPetSitemapEntries:mocks.list}));
vi.mock('@/lib/ydb/client',()=>({isYdbConfigured:mocks.configured}));
vi.mock('@/lib/pets/mock-data',()=>({isMockPetsDataSource:()=>false}));
import {GET} from './route';
beforeEach(()=>{vi.clearAllMocks();mocks.configured.mockReturnValue(true);mocks.list.mockResolvedValue([]);});
it('does a fresh single read for each request and never reuses removed entries',async()=>{
 mocks.list.mockResolvedValueOnce([{slug:'boba',createdAt:'2026-01-01',updatedAt:null,approvedAt:null}]);
 const first=await GET();expect(await first.text()).toContain('/pets/boba/preview.webp');
 expect(first.headers.get('cache-control')).toBe('no-store');expect(first.headers.get('content-type')).toContain('application/xml');
 const second=await GET();expect(await second.text()).not.toContain('/pets/boba/preview.webp');
 expect(mocks.list).toHaveBeenCalledTimes(2);
 expect(mocks.list).toHaveBeenCalledWith({requireComplete:true});
});
it('distinguishes an empty catalog from unavailable storage/config',async()=>{
 expect((await GET()).status).toBe(200);
 mocks.configured.mockReturnValue(false);expect((await GET()).status).toBe(503);
 mocks.configured.mockReturnValue(true);mocks.list.mockRejectedValue(new Error('private database details'));
 const response=await GET();expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');
});
