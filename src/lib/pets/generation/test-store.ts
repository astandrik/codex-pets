import type { GenerationJob } from "./model";
import type { GenerationStore, GenerationTransaction, PendingGenerationSubmission } from "./store";
export class MemoryStore implements GenerationStore {
  jobs = new Map<string, GenerationJob>();
  ledger = new Map<string, { value: string; expiresAt: number }>();
  artifacts = new Map<string, { bytes: Buffer; expiresAt: number }>();
  submissions = new Map<string, PendingGenerationSubmission>();
  reservedSlugs = new Map<string, "pending" | "approved" | "rejected" | "deleted">();
  private pending: Promise<unknown> = Promise.resolve();
  transaction<T>(operation: (tx: GenerationTransaction) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const jobs = structuredClone(this.jobs);
      const ledger = structuredClone(this.ledger);
      const artifacts = new Map(this.artifacts);
      const submissions = new Map(this.submissions);
      const tx: GenerationTransaction = {
        listTakenSlugs: async slugs => slugs.filter(slug => this.reservedSlugs.has(slug) || [...submissions.values()].some(input => input.identity.slug === slug)),
        saveSubmission: async (input) => {
          if (this.reservedSlugs.has(input.identity.slug) || [...submissions.values()].some(row => row.identity.slug === input.identity.slug)) throw new Error("Duplicate pet slug");
          submissions.set(input.identity.id, input);
        },
        getJob: async (id) => jobs.get(id) ?? null,
        getJobs: async ids => {
          const result = new Map<string, GenerationJob>();
          for (const id of ids) {const job = jobs.get(id); if (job) result.set(id, job);}
          return result;
        },
        putJob: async (job) => { jobs.set(job.id, structuredClone(job)); },
        getLedger: async (key, now) => { const row = ledger.get(key); return row && row.expiresAt > now ? row.value : null; },
        putLedger: async (key, value, expiresAt) => { ledger.set(key, { value, expiresAt }); },
        getArtifact: async (id, kind, now) => { const row = artifacts.get(id + ":" + kind); return row && row.expiresAt > now ? row.bytes : null; },
        hasArtifact: async (id,kind,now) => {const row=artifacts.get(id+":"+kind);return Boolean(row&&row.expiresAt>now);},
        setArtifactExpiry: async (id, kinds, expiresAt) => {for (const kind of kinds) {const k=id+":"+kind; const row=artifacts.get(k); if(row) artifacts.set(k,{...row,expiresAt});}},
        deleteArtifacts: async id => {for(const key of artifacts.keys()) if(key.startsWith(id+":")) artifacts.delete(key);},
        putArtifact: async (id, kind, bytes, expiresAt) => { artifacts.set(id + ":" + kind, { bytes, expiresAt }); },
      };
      const value = await operation(tx);
      this.jobs = jobs; this.ledger = ledger; this.artifacts = artifacts; this.submissions = submissions;
      return value;
    });
    this.pending = result.catch(() => undefined);
    return result;
  }
  async readJob(id: string) { return this.jobs.get(id) ?? null; }
  async readArtifact(id: string, kind: string, now: number) {
    const row = this.artifacts.get(id + ":" + kind);
    return row && row.expiresAt > now ? row.bytes : null;
  }
  async cleanup(now: number) {
    for (const [id, job] of this.jobs) if (job.expiresAt <= now) this.jobs.delete(id);
    for (const [id, row] of this.artifacts) if (row.expiresAt <= now) this.artifacts.delete(id);
    for (const [id, row] of this.ledger) if (row.expiresAt <= now) this.ledger.delete(id);
  }
}
