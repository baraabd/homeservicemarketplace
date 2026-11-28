import type { PrismaTx } from '@homeservicemarketplace/database';
import type { MailPort } from '../mail/mail.port';
import type { AuthChannelService } from './auth-channel.service';
import { OtpDeliveryService, type OtpDeliveryInput } from './otp-delivery.service';

function harness() {
  const messages = {
    enqueue: jest.fn().mockResolvedValue({ deliveryId: 'delivery-1', intent: null }),
    dispatch: jest.fn(),
  };
  const channels = { assertWhatsAppReady: jest.fn() };
  const service = new OtpDeliveryService(
    messages as unknown as MailPort,
    channels as unknown as AuthChannelService,
  );
  return { messages, channels, service };
}

const emailContact: OtpDeliveryInput = {
  channel: 'email',
  destination: 'owner@example.test',
  userId: 'user-1',
  rawCode: '012345',
  purpose: 'EMAIL_CONTACT_OTP',
  expiresAt: new Date('2026-11-18T08:00:00Z'),
};

describe('OTP purpose delivery boundary', () => {
  it('queues email enrollment as its own template in the caller transaction', async () => {
    const h = harness();
    const tx = {} as PrismaTx;
    await h.service.enqueue(emailContact, tx);
    expect(h.messages.enqueue).toHaveBeenCalledWith(
      {
        channel: 'email',
        to: 'owner@example.test',
        userId: 'user-1',
        template: 'auth.email_contact_otp',
        vars: { code: '012345', minutes: 5 },
        expiresAt: emailContact.expiresAt,
      },
      tx,
    );
    expect(h.channels.assertWhatsAppReady).not.toHaveBeenCalled();
    expect(h.messages.dispatch).not.toHaveBeenCalled();
  });

  it('never proves email ownership by delivering a code through WhatsApp', () => {
    const h = harness();
    expect(() => h.service.enqueue({ ...emailContact, channel: 'whatsapp' })).toThrow(
      'Email contact verification requires email delivery.',
    );
    expect(h.messages.enqueue).not.toHaveBeenCalled();
  });
});
