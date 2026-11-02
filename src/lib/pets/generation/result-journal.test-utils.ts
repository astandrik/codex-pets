import {readdir} from "node:fs/promises";
import path from "node:path";

export async function journalRecordDirectory(root:string,key:string){
  const folder=path.join(root,"records",key);
  const entries=await readdir(folder,{withFileTypes:true});
  const owned=entries.find(entry=>entry.isDirectory()&&/^[a-f0-9]{32}$/.test(entry.name));
  return owned?path.join(folder,owned.name):folder;
}
