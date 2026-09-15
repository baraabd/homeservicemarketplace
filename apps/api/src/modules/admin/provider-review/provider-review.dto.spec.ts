import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestProviderReviewChangesDto, ApproveProviderReviewDto } from './provider-review.dto';

const command = {
  submissionId: 'submission-1',
  expectedRevision: 'a'.repeat(64),
  idempotencyKey: 'review-key-1',
};

describe('review command edge validation', () => {
  it('rejects an empty correction list or whitespace-only provider explanation', async () => {
    const empty = plainToInstance(RequestProviderReviewChangesDto, { ...command, feedback: [] });
    expect(await validate(empty)).not.toHaveLength(0);
    const blank = plainToInstance(RequestProviderReviewChangesDto, {
      ...command,
      feedback: [{ taskId: 'WORK_AREA', reasonCode: 'INCOMPLETE', providerMessage: '   ' }],
    });
    expect(await validate(blank)).not.toHaveLength(0);
  });
  it('accepts bounded Arabic feedback and keeps internal note distinct', async () => {
    const input = plainToInstance(RequestProviderReviewChangesDto, {
      ...command,
      note: 'Internal context',
      feedback: [
        {
          taskId: 'WORK_AREA',
          reasonCode: 'INCOMPLETE',
          providerMessage: '  يرجى تحديد منطقة العمل  ',
        },
      ],
    });
    expect(await validate(input)).toEqual([]);
    expect(input.feedback[0].providerMessage).toBe('يرجى تحديد منطقة العمل');
    expect(input.note).toBe('Internal context');
  });
  it('requires the exact opaque revision on approval', async () => {
    const input = plainToInstance(ApproveProviderReviewDto, {
      ...command,
      expectedRevision: 'old-state-name',
      reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
    });
    expect(await validate(input)).not.toHaveLength(0);
  });
});
