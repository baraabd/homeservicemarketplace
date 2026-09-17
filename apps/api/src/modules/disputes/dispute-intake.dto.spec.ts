import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DISPUTE_ISSUE_CODES, DISPUTE_REQUESTED_OUTCOMES } from '@homeservicemarketplace/contracts';
import { CreateParticipantDisputeDto } from './dispute-intake.dto';

const input = {
  bookingId: 'booking', idempotencyKey: 'd34936e4-fb90-44ef-b8e7-c923c794b5a9',
  policyVersion: 'policy:hash', issueCode: 'OTHER', requestedOutcome: 'REVIEW',
  statement: 'A sufficiently detailed statement.',
};
const check = (value: unknown) => validate(plainToInstance(CreateParticipantDisputeDto, value), {
  whitelist: true, forbidNonWhitelisted: true,
});
it('accepts only the participant intake contract', async () => {
  expect(await check(input)).toHaveLength(0);
});
it('loads the exact published domain choices, not administrative decision codes', () => {
  expect(DISPUTE_ISSUE_CODES).toEqual(['SERVICE_QUALITY', 'MISSED_APPOINTMENT', 'SCOPE_DISAGREEMENT', 'PROPERTY_CONCERN', 'COMMUNICATION', 'OTHER']);
  expect(DISPUTE_REQUESTED_OUTCOMES).toEqual(['CLARIFICATION', 'RESCHEDULE', 'REPERFORM', 'PARTIAL_REMEDY', 'CANCELLATION', 'REVIEW']);
});
it.each(['openedById', 'role', 'status', 'priority', 'resolution'])('rejects client authority field %s', async (key) => {
  expect((await check({ ...input, [key]: 'admin' })).length).toBeGreaterThan(0);
});
it.each([
  { idempotencyKey: 'not-a-uuid' }, { issueCode: 'APPROVE' },
  { requestedOutcome: 'PAY_NOW' }, { statement: 'x' }, { statement: 'x'.repeat(4001) },
])('rejects invalid command %#', async (patch) => {
  const errors = await check({ ...input, ...patch });
  expect(errors.map((error) => error.property)).toContain(Object.keys(patch)[0]);
});
it.each(['APPROVE', 'constructor', '__proto__', '', null, 1, ['OTHER']].map((value) => ({ value })))('rejects invalid issue value %# through the actual Nest validation pipe', async ({ value: issueCode }) => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  await expect(pipe.transform({ ...input, issueCode }, {
    type: 'body', metatype: CreateParticipantDisputeDto,
  })).rejects.toBeInstanceOf(BadRequestException);
});
it.each(DISPUTE_ISSUE_CODES)('accepts the allowed issue %s', async (issueCode) => {
  expect(await check({ ...input, issueCode })).toHaveLength(0);
});
