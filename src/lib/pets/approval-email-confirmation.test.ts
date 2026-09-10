import { describe, expect, it } from 'vitest';
import { createApprovalPreparationsRepository } from '@/lib/pets/approval-preparations-repository';

const text = (value: string) => ({ textValue: value });
const row = { resultSets: [{ rows: [{ items: [
  ...['approval-1', 'pet-1', 'pet-1', 'version-1', 'admin-1', 'ranking-1', 'generation-1', '', 'queued'].map(text),
  { uint32Value: 0 }, ...['now', '', '', '', 'now', 'now'].map(text), { boolValue: true },
] }] }] };

describe('async email approval handoff', () => {
  it('persists the moderator confirmation in the same queued preparation', async () => {
    let inserted = false;
    let params: Record<string, unknown> = {};
    const execute = async (statement: string, values: Record<string, unknown>) => {
      if (statement.includes('INSERT INTO codex_pet_approval_preparations')) {
        inserted = true;
        params = values;
      }
      return inserted ? row : { resultSets: [] };
    };
    const repository = createApprovalPreparationsRepository({
      isConfigured: () => true,
      values: { utf8: (v: string) => v, uint32: (v: number) => v, bool: (v: boolean) => v },
      execute,
      transaction: async (callback) => callback(execute),
    });
    const input = { petId: 'pet-1', petSlug: 'pet-1', petUpdatedAt: 'version-1', reviewerId: 'admin-1',
      rankingRevision: 'ranking-1', expectedActiveGenerationId: 'generation-1', now: 'now', publishRequestedEmail: true };
    const queued = await repository.enqueue(input);
    expect(params.$publish_requested_email).toBe(true);
    expect(queued).toMatchObject({ publishRequestedEmail: true, reviewerId: 'admin-1', petUpdatedAt: 'version-1' });
  });
});
