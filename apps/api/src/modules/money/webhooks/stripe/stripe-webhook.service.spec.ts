import { fixture } from '../../../../../test/support/r29-stripe.fixture';
import type { MoneyCommandService } from '../../application/money-command.service';
import { StripeWebhookService } from './stripe-webhook.service';
describe('R29 durable acknowledgement boundary', () => {
  function setup() {
    const f = fixture();
    const commands = {
      acceptExternalEvent: jest.fn().mockResolvedValue({ eventId: 'stored', status: 'RECEIVED' }),
      processExternalEvent: jest.fn(),
    };
    return {
      ...f,
      commands,
      service: new StripeWebhookService(f.config, commands as unknown as MoneyCommandService),
    };
  }
  it('acknowledges only durable receipt, never activation or in-memory scheduling', async () => {
    const f = setup();
    expect(await f.service.receive(f.envelope().payload, 'signed')).toEqual({
      received: true,
      processing: 'PENDING',
    });
    expect(f.commands.processExternalEvent).not.toHaveBeenCalled();
  });
  it('waits for commit before acknowledging', async () => {
    const f = setup();
    let commit!: (v: unknown) => void;
    f.commands.acceptExternalEvent.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    let settled = false;
    const request = f.service.receive(f.envelope().payload, 'signed').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    commit({ eventId: 'id', status: 'RECEIVED' });
    await request;
    expect(settled).toBe(true);
  });
  it('returns failure on commit rejection without echoing SQL or secrets', async () => {
    const f = setup();
    f.commands.acceptExternalEvent.mockRejectedValue(new Error('password=private SQL'));
    await expect(f.service.receive(f.envelope().payload, 'signed')).rejects.toMatchObject({
      status: 503,
      details: { reason: 'STRIPE_INBOX_UNAVAILABLE' },
    });
  });
  it('recognizes replay only when the durable inbox says processed', async () => {
    const f = setup();
    f.commands.acceptExternalEvent.mockResolvedValue({ eventId: 'id', status: 'PROCESSED' });
    expect(await f.service.receive(f.envelope().payload, 'signed')).toEqual({
      received: true,
      processing: 'COMPLETE',
    });
  });
  it.each([{}, undefined, 'parsed'])('refuses a non-raw body %#', async (body) => {
    const f = setup();
    await expect(f.service.receive(body, 'signed')).rejects.toThrow();
    expect(f.commands.acceptExternalEvent).not.toHaveBeenCalled();
  });
});
