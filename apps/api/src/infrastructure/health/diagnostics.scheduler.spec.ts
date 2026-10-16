import type { AppConfigService } from '../../config/app-config.service';
import type { MailPort } from '../mail/mail.port';
import type { StoragePort } from '../storage/storage.port';
import { MetricsService } from '../telemetry/metrics.service';
import { DiagnosticsScheduler } from './diagnostics.scheduler';
const config = {
  get: (key: string) => (key === 'SMTP_HOST' ? 'fixture.test' : undefined),
} as AppConfigService;
afterEach(() => jest.useRealTimers());
it('bounds a hung probe, prevents overlap, and continues after failure', async () => {
  jest.useFakeTimers();
  const metrics = new MetricsService();
  const verify = jest.fn().mockImplementation(() => new Promise(() => undefined));
  const scheduler = new DiagnosticsScheduler(
    config,
    metrics,
    { verify } as unknown as MailPort,
    {} as StoragePort,
  );
  const first = scheduler.tick();
  expect(scheduler.tick()).toBe(first);
  await jest.advanceTimersByTimeAsync(3001);
  await first;
  expect(verify).toHaveBeenCalledTimes(1);
  verify.mockRejectedValueOnce(new Error('private-relay-details'));
  await scheduler.tick();
  expect(verify).toHaveBeenCalledTimes(2);
  const text = await metrics.metrics();
  expect(text).toContain('dependency_up{dependency="smtp"} 0');
  expect(text).not.toContain('private-relay-details');
  await scheduler.onModuleDestroy();
  await scheduler.tick();
  expect(verify).toHaveBeenCalledTimes(2);
});
it('records configured probes without probing absent payment rails', async () => {
  const metrics = new MetricsService();
  const scheduler = new DiagnosticsScheduler(
    config,
    metrics,
    { verify: jest.fn().mockResolvedValue(undefined) } as unknown as MailPort,
    { headBuckets: jest.fn().mockResolvedValue(undefined) } as unknown as StoragePort,
  );
  await scheduler.tick();
  const text = await metrics.metrics();
  expect(text).toContain('dependency_up{dependency="smtp"} 1');
  expect(text).toContain('dependency_up{dependency="storage"} 1');
  expect(text).not.toContain('dependency_up{dependency="payment"}');
  await scheduler.onModuleDestroy();
});
