import type { AppConfigService } from '../../config/app-config.service';
import { NodemailerMailAdapter } from './nodemailer-mail.adapter';
import * as nodemailer from 'nodemailer';

// Mock nodemailer at the module level so `createTransport` returns a fake.
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const mockedCreateTransport = jest.mocked(nodemailer.createTransport);

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_FROM: 'noreply@test.local',
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

describe('NodemailerMailAdapter', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockedCreateTransport.mockClear();
  });

  it('calls transporter.sendMail with correct from/to/subject/text', async () => {
    const adapter = new NodemailerMailAdapter(makeConfig());
    adapter.onModuleInit();

    await adapter.send({
      to: 'user@example.com',
      subject: 'Verify your email',
      text: 'Click here: https://example.com/verify?token=abc',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'noreply@test.local',
      to: 'user@example.com',
      subject: 'Verify your email',
      text: 'Click here: https://example.com/verify?token=abc',
    });
  });

  it('propagates sendMail errors to the caller', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    const adapter = new NodemailerMailAdapter(makeConfig());
    adapter.onModuleInit();

    await expect(adapter.send({ to: 'x@x.com', subject: 's', text: 't' })).rejects.toThrow(
      'SMTP connection refused',
    );
  });

  it('does not include auth when SMTP_USER/SMTP_PASS are absent', () => {
    const adapter = new NodemailerMailAdapter(
      makeConfig({ SMTP_USER: undefined, SMTP_PASS: undefined }),
    );
    adapter.onModuleInit();

    const opts = mockedCreateTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('auth');
  });

  it('includes auth when SMTP_USER and SMTP_PASS are both set', () => {
    const adapter = new NodemailerMailAdapter(makeConfig({ SMTP_USER: 'u', SMTP_PASS: 'p' }));
    adapter.onModuleInit();

    const opts = mockedCreateTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).toHaveProperty('auth', { user: 'u', pass: 'p' });
  });
});
