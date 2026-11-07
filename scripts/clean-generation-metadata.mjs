import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {register} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {writeRecoveryBackup} from './recover-generation-result.mjs';

export function parseMetadataCleanupArgs(args){
  const values=new Map();
  for(const argument of args){
    const match=/^--(ids-file|manifest|backup|expected-manifest-sha256)=(.+)$/.exec(argument);
    const key=match?.[1]??argument;
    if(values.has(key)||(!match&&!['--apply','--restore','--scan'].includes(argument)))throw Error('invalid_arguments');
    values.set(key,match?match[2]:true);
  }
  const apply=values.has('--apply'),restore=values.has('--restore'),scan=values.has('--scan');
  const idsFile=values.get('ids-file'),manifest=values.get('manifest'),backup=values.get('backup'),expectedHash=values.get('expected-manifest-sha256');
  if(apply&&restore || scan&&(apply||restore||idsFile) || (apply||restore)&&(!manifest||!backup||!expectedHash) ||
    !apply&&!restore&&!scan&&!idsFile || !apply&&!restore&&(backup||expectedHash) ||
    expectedHash&&!/^[a-f0-9]{64}$/.test(expectedHash) || [idsFile,manifest,backup].some(value=>value&&!path.isAbsolute(value)))throw Error('invalid_arguments');
  return {apply,restore,scan,idsFile,manifest,backup,expectedHash};
}
async function privateRead(file){
  const parent=await lstat(path.dirname(file));
  if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)!==0)throw Error('private_directory_required');
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('private_file_required');return await handle.readFile('utf8');}
  finally{await handle.close();}
}
export async function runMetadataCleanup(args,deps){
  const options=parseMetadataCleanupArgs(args);
  const now=deps.now??Date.now;
  if(!options.apply&&!options.restore){
    const ids=options.scan?await deps.listIds(now()):JSON.parse(await readFile(options.idsFile,'utf8'));
    if(!Array.isArray(ids)||(!ids.length&&!options.scan)||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(ids).size!==ids.length)throw Error('invalid_ids');
    const manifest=await deps.plan(ids,now);
    if(options.manifest)await writeRecoveryBackup(options.manifest,manifest);
    return {mode:'dry-run',manifest,manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
  }
  const manifest=JSON.parse(await privateRead(options.manifest));
  if(createHash('sha256').update(JSON.stringify(manifest)).digest('hex')!==options.expectedHash)throw Error('manifest_changed');
  let backup;
  if(options.restore){backup=JSON.parse(await privateRead(options.backup));}
  else{
    try{await lstat(options.backup);backup=JSON.parse(await privateRead(options.backup));}
    catch(error){
      if(error?.code!=='ENOENT')throw error;
      backup=await deps.backup(manifest,now);
      await writeRecoveryBackup(options.backup,backup);
      backup=JSON.parse(await privateRead(options.backup));
    }
  }
  if(JSON.stringify(backup.manifest)!==JSON.stringify(manifest))throw Error('backup_manifest_mismatch');
  return {mode:options.restore?'restore':'apply',changed:await deps.apply(backup,now,options.restore)};
}
async function main(){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src');
  register(new URL('./lib/related-pets-typescript-loader.mjs',import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
  const load=name=>import(pathToFileURL(path.join(root,name)).href);
  const [{metadataCleanupStore:store,listLiveMetadataJobIds},operations,{destroyYdbDriver}]=await Promise.all([
    load('lib/pets/generation/metadata-cleanup-store.ts'),load('lib/pets/generation/metadata-cleanup.ts'),load('lib/ydb/client.ts')]);
  try{
    const result=await runMetadataCleanup(process.argv.slice(2),{
      listIds:listLiveMetadataJobIds,
      plan:(ids,now)=>operations.createCleanupManifest(store,ids,now),
      backup:(manifest,now)=>operations.prepareCleanupBackup(store,operations.cleanupManifestSchema.parse(manifest),now),
      apply:(backup,now,restore)=>operations.applyMetadataCleanup(store,operations.cleanupBackupSchema.parse(backup),now,restore),
    });
    console.log(JSON.stringify(result));
  }catch(error){console.error(JSON.stringify({error:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'metadata_cleanup_failed'}));process.exitCode=1;}
  finally{await destroyYdbDriver();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
