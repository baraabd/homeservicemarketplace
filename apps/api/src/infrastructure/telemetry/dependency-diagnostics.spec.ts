// Probe adapters are exercised with CONTRACT DOUBLES (functions shaped like
// nodemailer's verify(), an S3 HeadBucket call and a clamd PING). Real SMTP,
// storage and scanner reachability is target-specific evidence, recorded as
// pending in docs/production-readiness/r23/ACCEPTANCE.md.

import {
  paymentProbe,
  runDiagnostics,
  scannerProbe,
  smtpProbe,
  storageProbe,
} from './dependency-diagnostics';
import { MetricsService } from './metrics.service';

describe('runDiagnostics', () => {
  it('reports each dependency independently and records dependency_up', async () => {
    const metrics = new MetricsService();
    const report = await runDiagnostics(
      [
        smtpProbe(async () => true),
        storageProbe(async () => {
          throw Object.assign(new Error('AccessDenied for key AKIASECRET'), {
            name: 'AccessDenied',
          });
        }),
        scannerProbe(async () => 'PONG\0'),
        paymentProbe(null),
      ],
      { metrics },
    );
    const byDep = Object.fromEntries(report.results.map((r) => [r.dependency, r]));
    expect(byDep.smtp.status).toBe('up');
    expect(byDep.storage).toEqual({
      dependency: 'storage',
      status: 'down',
      latencyMs: null,
      errorType: 'AccessDenied',
    });
    expect(byDep.scanner.status).toBe('up');
    expect(byDep.payment.status).toBe('not_configured');
    expect(JSON.stringify(report)).not.toContain('AKIASECRET');

    const text = await metrics.metrics();
    expect(text).toContain('dependency_up{dependency="smtp"} 1');
    expect(text).toContain('dependency_up{dependency="storage"} 0');
    // An intentionally absent integration is not reported as down.
    expect(text).not.toContain('dependency_up{dependency="payment"}');
  });

  it('times out a hung probe without waiting for it, and aborts its signal', async () => {
    let aborted = false;
    const t0 = Date.now();
    const report = await runDiagnostics(
      [
        storageProbe(
          (signal) =>
            new Promise(() => {
              signal.addEventListener('abort', () => (aborted = true));
            }),
        ),
      ],
      { timeoutMs: 50 },
    );
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(report.results[0].status).toBe('timeout');
    expect(aborted).toBe(true);
  });

  it('treats a non-PONG scanner reply as down', async () => {
    const report = await runDiagnostics([scannerProbe(async () => 'UNKNOWN COMMAND')]);
    expect(report.results[0]).toMatchObject({ status: 'down', errorType: 'ScannerProbeError' });
  });

  it('a probe that throws synchronously is contained', async () => {
    const report = await runDiagnostics([
      smtpProbe(() => {
        throw new Error('sync');
      }),
    ]);
    expect(report.results[0].status).toBe('down');
  });

  it('a failing diagnostics run never throws to its caller', async () => {
    const metrics = {
      dependencyUp: {
        set: () => {
          throw new Error('metrics broken');
        },
      },
    };
    await expect(
      runDiagnostics([smtpProbe(async () => undefined)], { metrics: metrics as never }),
    ).resolves.toBeDefined();
  });
});
