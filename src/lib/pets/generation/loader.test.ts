import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
describe("actual worker Node loader",()=>{
  it("imports all worker runtime modules without a provider/YDB operation",()=>{
    const code=`import {register} from 'node:module';import{pathToFileURL}from'node:url';import path from'node:path';
register(pathToFileURL(path.resolve('scripts/lib/related-pets-typescript-loader.mjs')),{parentURL:pathToFileURL(process.cwd()+'/'),data:{sourceRootUrl:pathToFileURL(path.resolve('src')).href}});
await import(pathToFileURL(path.resolve('src/lib/pets/generation/sprite-worker.ts')));
await import(pathToFileURL(path.resolve('src/lib/pets/generation/sprite-renderer.ts')));
await import(pathToFileURL(path.resolve('src/lib/pets/generation/service.ts')));
console.log('worker-import-ok');`;
    expect(execFileSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8",env:{PATH:process.env.PATH,NODE_ENV:"test"}}).trim()).toBe("worker-import-ok");
  });
});
