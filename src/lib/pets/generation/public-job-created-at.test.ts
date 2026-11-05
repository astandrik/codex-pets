import {expect,it} from 'vitest';
import {jobSchema} from './model';
import {publicJob} from './public-job';
it('reports immutable task creation time without changing the job or attempts',()=>{
 const job=jobSchema.parse({id:'a'.repeat(64),prompt:'private',displayName:'Pet',status:'queued',createdAt:1000,expiresAt:86401000,worker:'',pipelineVersion:2,promptRevision:'test',stages:[]});
 const before=structuredClone(job);
 expect(publicJob(job,2000)).toMatchObject({generationId:job.id,createdAt:new Date(1000).toISOString(),expiresAt:new Date(86401000).toISOString()});
 expect(publicJob(job,3000).createdAt).toBe(new Date(1000).toISOString());expect(job).toEqual(before);
});
