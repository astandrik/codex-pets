import {expect,it} from 'vitest';import {configuredResultJournal} from './result-journal-runtime';
it('leaves the feature off by default and rejects incomplete or invalid enabled configuration',async()=>{
 expect(await configuredResultJournal({})).toBeUndefined();expect(await configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'false'})).toBeUndefined();
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'yes'})).rejects.toThrow();
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'true'})).rejects.toThrow();
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'true',PET_GENERATION_RESULT_JOURNAL_DIR:'relative'})).rejects.toThrow();
});
