import {afterEach,expect,it,vi} from "vitest";
import {buildPetImageSitemap} from "./pet-image-sitemap";
afterEach(()=>vi.unstubAllEnvs());
it("contains every approved entry beyond the catalog page limit",()=>{
 const entries=Array.from({length:501},(_,i)=>({slug:`pet-${i}`,createdAt:"2026-01-01T00:00:00Z",updatedAt:null,approvedAt:null}));
 const xml=buildPetImageSitemap(entries);
 expect(xml.match(/<image:image>/g)).toHaveLength(501);
 expect(xml).toContain('<image:loc>http://localhost:3000/pets/pet-500/preview.webp</image:loc>');
 expect(xml).not.toContain('/api/');
});
it("deduplicates slugs, skips invalid slugs and omits invalid dates",()=>{
 const entry={slug:"legacy-",createdAt:"bad",updatedAt:null,approvedAt:null};
 const xml=buildPetImageSitemap([entry,entry,{...entry,slug:"../private"}]);
 expect(xml.match(/<url>/g)).toHaveLength(1);expect(xml).not.toContain('<lastmod>');
 expect(buildPetImageSitemap([])).toContain('</urlset>');
});
it("rejects a feed beyond the sitemap URL limit instead of silently truncating it", () => {
 const entries=Array.from({length:50_001},(_,i)=>({slug:`pet-${i}`,createdAt:"2026-01-01",updatedAt:null,approvedAt:null}));
 expect(()=>buildPetImageSitemap(entries)).toThrow();
});
it("escapes XML and applies the configured origin and base path",async()=>{
 vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_APP_URL','https://pets.example');vi.stubEnv('NEXT_PUBLIC_BASE_PATH','/a&b');
 const {buildPetImageSitemap:build}=await import('./pet-image-sitemap');
 const xml=build([{slug:"boba",createdAt:"2026-01-01",updatedAt:null,approvedAt:null}]);
 expect(xml).toContain('https://pets.example/a&amp;b/pets/boba/preview.webp');
 expect(xml).toContain('http://www.google.com/schemas/sitemap-image/1.1');
});
