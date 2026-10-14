import {describe,expect,it} from "vitest";
import {readFailureDiagnostic} from "./failure-diagnostic";
describe("private bounded failure diagnostics",()=>{
 it("retains only fixed labels and bounded measurements",()=>{
  expect(readFailureDiagnostic({boundary:"provider_image",reason:"unexpected_dimensions",width:1024,height:1024,elapsedMs:1234,usageAvailable:true,message:"private prompt",apiKey:"secret",url:"https://private.invalid"})).toEqual({boundary:"provider_image",reason:"unexpected_dimensions",width:1024,height:1024,elapsedMs:1234,usageAvailable:true});
 });
 it("rejects arbitrary labels and unsafe numeric fields",()=>{
  for(const value of [{boundary:"private",reason:"unclassified"},{boundary:"provider_cli",reason:"private_response"},{boundary:"provider_cli",reason:"process_exit",exitCode:"secret"},{boundary:"provider_image",reason:"unexpected_dimensions",width:Infinity}])expect(readFailureDiagnostic(value)).toBeUndefined();
 });
});
