import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateParticipantDisputeDto } from './dispute-intake.dto';
const input = { bookingId: 'booking', idempotencyKey: 'd34936e4-fb90-44ef-b8e7-c923c794b5a9', policyVersion: 'policy:hash', issueCode: 'OTHER', requestedOutcome: 'REVIEW', statement: 'A sufficiently detailed statement.' };
const check = (value: unknown) => validate(plainToInstance(CreateParticipantDisputeDto, value), { whitelist: true, forbidNonWhitelisted: true });
it('accepts only the participant intake contract', async () => { expect(await check(input)).toHaveLength(0); });
it.each(['openedById', 'role', 'status', 'priority', 'resolution'])('rejects client authority field %s', async (key) => { expect((await check({ ...input, [key]: 'admin' })).length).toBeGreaterThan(0); });
it.each([{ idempotencyKey: 'not-a-uuid' }, { issueCode: 'APPROVE' }, { requestedOutcome: 'PAY_NOW' }, { statement: 'x' }, { statement: 'x'.repeat(4001) }])('rejects invalid command %#', async (patch) => { expect((await check({ ...input, ...patch })).length).toBeGreaterThan(0); });
