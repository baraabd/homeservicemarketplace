import { Readable } from 'node:stream';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfigService } from '../../src/config/app-config.service';
import { MetricsService } from '../../src/infrastructure/telemetry/metrics.service';
import { TelemetryService } from '../../src/infrastructure/telemetry/telemetry.service';
import { instrumentStorage } from '../../src/infrastructure/storage/storage-telemetry';
import { NodemailerMailAdapter } from '../../src/infrastructure/mail/nodemailer-mail.adapter';
import { ClamAvMalwareScanner } from '../../src/modules/provider/verification/media/clamav-scanner.adapter';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }) }));
const config = {
  get: (key: string) =>
    ({ SMTP_HOST: 'fixture.test', CLAMAV_HOST: 'fixture.test', SMTP_FROM: 'fixture@example.test' })[
      key as 'SMTP_HOST'
    ],
  isProduction: false,
} as AppConfigService;

it('SMTP telemetry preserves the transport result and exact failure without leaking the envelope', async () => {
  const metrics = new MetricsService();
  const telemetry = new TelemetryService(metrics);
  const mail = new NodemailerMailAdapter(config, telemetry);
  mail.onModuleInit();
  sendMail.mockResolvedValueOnce({ response: '250 accepted' });
  await expect(
    mail.send({ to: 'recipient@example.test', subject: 'fixture', text: 'private-body' }),
  ).resolves.toEqual({ smtpCode: 250 });
  const failure = new Error('private-relay-address');
  sendMail.mockRejectedValueOnce(failure);
  await expect(
    mail.send({ to: 'recipient@example.test', subject: 'fixture', text: 'private-body' }),
  ).rejects.toBe(failure);
  const text = await metrics.metrics();
  expect(text).toContain('dependency="smtp",operation="send",outcome="success"');
  expect(text).toContain('dependency="smtp",operation="send",outcome="error"');
  expect(text).not.toMatch(/private-body|recipient@example|private-relay/);
});
it('S3 middleware keeps requests and errors intact and emits bounded operation labels', async () => {
  const metrics = new MetricsService();
  const telemetry = new TelemetryService(metrics);
  const handle = jest
    .fn()
    .mockResolvedValueOnce({ response: { statusCode: 200, headers: {}, body: Readable.from([]) } });
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:19000',
    credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' },
    maxAttempts: 1,
    requestHandler: { handle },
  });
  instrumentStorage(client, telemetry);
  await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: 'private-bucket', Key: 'private-key' }),
  );
  expect(handle).not.toHaveBeenCalled();
  expect(await metrics.metrics()).not.toContain('dependency="storage",operation="put_object"');
  await client.send(new HeadObjectCommand({ Bucket: 'private-bucket', Key: 'private-key' }));
  const failure = new Error('private-storage-host');
  handle.mockRejectedValueOnce(failure);
  await expect(
    client.send(new HeadObjectCommand({ Bucket: 'private-bucket', Key: 'private-key' })),
  ).rejects.toBe(failure);
  handle.mockResolvedValueOnce({
    response: {
      statusCode: 403,
      headers: { 'content-type': 'application/xml' },
      body: Readable.from([
        '<Error><Code>AccessDenied</Code><Message>private-denial</Message></Error>',
      ]),
    },
  });
  await expect(
    client.send(new HeadObjectCommand({ Bucket: 'private-bucket', Key: 'private-key' })),
  ).rejects.toMatchObject({ name: 'AccessDenied' });
  const text = await metrics.metrics();
  expect(text).toContain('dependency="storage",operation="head_object",outcome="success"');
  expect(text).toContain('dependency="storage",operation="head_object",outcome="error"');
  expect(text).not.toMatch(/private-bucket|private-key|private-storage-host|private-denial/);
  client.destroy();
});
it('scanner telemetry retains the fail-closed verdict on an unavailable scanner', async () => {
  const metrics = new MetricsService();
  const scanner = new ClamAvMalwareScanner(config, new TelemetryService(metrics));
  jest
    .spyOn(scanner as unknown as { converse: (bytes: Uint8Array) => Promise<string> }, 'converse')
    .mockRejectedValueOnce(new Error('private-host'));
  await expect(
    scanner.scan({ bytes: new Uint8Array([1]), assetId: 'private-id' }),
  ).resolves.toMatchObject({ state: 'FAILED' });
  const text = await metrics.metrics();
  expect(text).toContain('dependency="scanner",operation="scan",outcome="error"');
  expect(text).not.toMatch(/private-host|private-id/);
});

it('outbox tick emits success and failure metrics while retaining its existing retry loop', async () => {
  const { OutboxWorker } = await import('../../src/infrastructure/outbox/outbox.worker');
  const metrics = new MetricsService();
  const worker = new OutboxWorker(
    {} as never,
    {} as never,
    config,
    metrics,
    [],
    new TelemetryService(metrics),
  );
  const run = jest
    .spyOn(worker, 'runOnce')
    .mockResolvedValueOnce(0)
    .mockRejectedValueOnce(new Error('synthetic database outage'));
  const internals = worker as unknown as {
    tick(): Promise<void>;
    scheduleNext(delay: number): void;
  };
  const schedule = jest.spyOn(internals, 'scheduleNext').mockImplementation(() => undefined);
  await internals.tick();
  await internals.tick();
  expect(run).toHaveBeenCalledTimes(2);
  expect(schedule).toHaveBeenCalledTimes(2);
  const text = await metrics.metrics();
  expect(text).toContain('job_name="outbox.tick",outcome="success"');
  expect(text).toContain('job_name="outbox.tick",outcome="failure"');
});
