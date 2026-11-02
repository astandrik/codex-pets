import path from "node:path";
import {statfs} from "node:fs/promises";
import {FileResultJournal,JournalError} from "@/lib/pets/generation/result-journal";
export async function configuredResultJournal(env:Record<string,string|undefined>=process.env){
 const enabled=env.PET_GENERATION_RESULT_JOURNAL_ENABLED;
 if(enabled===undefined||enabled==="false")return undefined;
 if(enabled!=="true")throw new JournalError("journal_invalid_config");
 const directory=env.PET_GENERATION_RESULT_JOURNAL_DIR?.trim();
 if(!directory||!path.isAbsolute(directory))throw new JournalError("journal_invalid_config");
 const journal=await FileResultJournal.open(directory);
 const fs=await statfs(directory);
 if(fs.type===0x01021994)throw new JournalError("journal_requires_persistent_filesystem");
 await journal.expire();
 for(const key of await journal.list())await journal.read(key);
 return journal;
}
