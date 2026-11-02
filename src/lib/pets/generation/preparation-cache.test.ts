import {expect,it} from "vitest";
import {createPreparationCache} from "./preparation-cache";
it("reuses identical preparation concurrently but not a different input hash",async()=>{
  const cache=createPreparationCache(16,2);let builds=0;
  const build=async()=>{builds++;return new Map([["guide.png",Buffer.from("guide")]]);};
  const [a,b]=await Promise.all([cache.get("input-a",100,1,build),cache.get("input-a",100,1,build)]);
  expect(a.get("guide.png")?.toString()).toBe("guide");expect(b.get("guide.png")?.toString()).toBe("guide");expect(builds).toBe(1);
  await cache.get("input-b",100,1,build);expect(builds).toBe(2);
});
it("evicts expired and oversized preparations without caching failed builds",async()=>{
  const cache=createPreparationCache(4,2);let builds=0;
  const build=async()=>{builds++;return new Map([["guide",Buffer.from("1234")]]);};
  await cache.get("same",2,1,build);await cache.get("same",10,3,build);expect(builds).toBe(2);
  const huge=async()=>{builds++;return new Map([["large",Buffer.from("12345")]]);};
  await cache.get("large",100,3,huge);await cache.get("large",100,3,huge);expect(builds).toBe(4);
  await expect(cache.get("failed",100,3,async()=>{throw Error("prepare failed");})).rejects.toThrow("prepare failed");
  expect((await cache.get("failed",100,3,build)).get("guide")?.toString()).toBe("1234");
});
