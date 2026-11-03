import {beforeEach,expect,it,vi} from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pets/public-preview", async importOriginal => ({...await importOriginal<typeof import("@/lib/pets/public-preview")>(),readApprovedPetPreview:read}));
import {PublicPreviewError} from "@/lib/pets/public-preview";
import {GET,HEAD} from "./route";
const context={params:Promise.resolve({slug:"boba"})};
beforeEach(()=>{read.mockReset();read.mockResolvedValue({bytes:Buffer.from([1,2,3]),etag:'"abc"'});});
it("serves a revalidated image and HEAD without a body",async()=>{
 const response=await GET(new Request("https://pets.example/pets/boba/preview.webp"),context);
 expect(response.status).toBe(200);expect(response.headers.get("content-type")).toBe("image/webp");
 expect(response.headers.get("cache-control")).toBe("public, no-cache, max-age=0, must-revalidate");
 expect(response.headers.get("x-content-type-options")).toBe("nosniff");
 expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3]);
 const head=await HEAD(new Request("https://pets.example/pets/boba/preview.webp",{method:"HEAD"}),context);
 expect(head.headers.get("etag")).toBe('"abc"');expect((await head.arrayBuffer()).byteLength).toBe(0);
});
it.each(['"abc"','W/"abc"','"old", "abc"','*'])("validates publication before 304: %s",async etag=>{
 const response=await GET(new Request("https://pets.example/pets/boba/preview.webp",{headers:{"If-None-Match":etag}}),context);
 expect(read).toHaveBeenCalledWith("boba");expect(response.status).toBe(304);expect(await response.text()).toBe("");
 read.mockRejectedValue(new PublicPreviewError(404));
 const denied=await GET(new Request("https://pets.example/pets/boba/preview.webp",{headers:{"If-None-Match":etag}}),context);
 expect(denied.status).toBe(404);expect(denied.headers.get("cache-control")).toBe("no-store");
});
it.each([404,409,422,503] as const)("keeps error %i safe and uncacheable",async status=>{
 read.mockRejectedValue(new PublicPreviewError(status));
 const response=await GET(new Request("https://pets.example/pets/boba/preview.webp"),context);
 expect(response.status).toBe(status);expect(response.headers.get("x-robots-tag")).toBe("noindex");
 expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.text()).not.toMatch(/database|assetId|stack/);
});
