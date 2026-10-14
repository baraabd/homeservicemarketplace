import type { Dependency } from './telemetry.service';
import type { MetricsService } from './metrics.service';

// R23 — deep dependency diagnostics, kept apart from liveness and readiness.
//
//   /health/live    process-local: is this process running? Never touches the
//                   network, so a vendor outage cannot cause a restart loop.
//   /health/ready   the dependencies needed to serve requests at all
//                   (Postgres, Redis, Mongo when enabled). Unchanged here.
//   diagnostics     SMTP, object storage, the malware scanner and the payment
//                   provider. Their failure degrades a feature and must page
//                   someone, but it must not remove the API from the load
//                   balancer or have an orchestrator kill it.
//
// These are leaf providers. Mounting them on a route or a schedule is global
// wiring owned by the coordinator (shared-change-requests/CR-03); until then
// they are exercised by their tests and can be called by an operator script.

export type DiagnosticStatus = 'up' | 'down' | 'timeout' | 'not_configured';

export interface DiagnosticProbe {
  readonly dependency: Dependency;
  /** Resolve when reachable, reject otherwise. Honour the signal. */
  check(signal: AbortSignal): Promise<void>;
  /** False when the integration is intentionally absent (e.g. no payment rail). */
  readonly configured: boolean;
}

export interface DiagnosticResult {
  dependency: Dependency;
  status: DiagnosticStatus;
  latencyMs: number | null;
  /** Error class only. Messages are never returned: they carry hosts, users
   *  and sometimes credentials of the dependency. */
  errorType?: string;
}

export interface DiagnosticsReport {
  checkedAt: string;
  results: DiagnosticResult[];
}

const DEFAULT_TIMEOUT_MS = 3_000;

export async function runDiagnostics(
  probes: readonly DiagnosticProbe[],
  opts: { timeoutMs?: number; metrics?: Pick<MetricsService, 'dependencyUp'> } = {},
): Promise<DiagnosticsReport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results = await Promise.all(probes.map((p) => runOne(p, timeoutMs)));
  if (opts.metrics) {
    for (const r of results) {
      if (r.status === 'not_configured') continue;
      try {
        opts.metrics.dependencyUp.set({ dependency: r.dependency }, r.status === 'up' ? 1 : 0);
      } catch {
        // Recording is best-effort; the report is still returned.
      }
    }
  }
  return { checkedAt: new Date().toISOString(), results };
}

async function runOne(probe: DiagnosticProbe, timeoutMs: number): Promise<DiagnosticResult> {
  if (!probe.configured)
    return { dependency: probe.dependency, status: 'not_configured', latencyMs: null };
  const controller = new AbortController();
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => probe.check(controller.signal))
        .then(() => 'up' as const),
      timeout,
    ]);
    const latencyMs = Math.round(performance.now() - start);
    return {
      dependency: probe.dependency,
      status: outcome,
      latencyMs: outcome === 'up' ? latencyMs : null,
    };
  } catch (err) {
    return {
      dependency: probe.dependency,
      status: 'down',
      latencyMs: null,
      errorType:
        err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(err.name) ? err.name : 'Error',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── probe adapters ─────────────────────────────────────────────────────────
//
// Each adapter takes the narrowest function it needs, so this module does not
// import the mail, storage or scanner modules (owned by other lanes) and their
// tests can supply contract doubles.

/** nodemailer's `transporter.verify()` performs connect + EHLO + AUTH. */
export function smtpProbe(verify: (() => Promise<unknown>) | null): DiagnosticProbe {
  return {
    dependency: 'smtp',
    configured: verify !== null,
    check: async () => {
      await verify?.();
    },
  };
}

/** e.g. S3 `HeadBucket` on each configured bucket. Reads no object. */
export function storageProbe(
  headBuckets: ((signal: AbortSignal) => Promise<unknown>) | null,
): DiagnosticProbe {
  return {
    dependency: 'storage',
    configured: headBuckets !== null,
    check: async (signal) => {
      await headBuckets?.(signal);
    },
  };
}

/** clamd answers `PING` with `PONG`; anything else is down. */
export function scannerProbe(
  ping: ((signal: AbortSignal) => Promise<string>) | null,
): DiagnosticProbe {
  return {
    dependency: 'scanner',
    configured: ping !== null,
    check: async (signal) => {
      const reply = await ping?.(signal);
      if (typeof reply !== 'string' || reply.trim().replace(/\0/gu, '') !== 'PONG') {
        throw new ScannerProbeError();
      }
    },
  };
}

/**
 * No payment rail is enabled (R16/R18 D-1). The probe reports
 * `not_configured` until an approved provider adapter supplies a check.
 */
export function paymentProbe(
  check: ((signal: AbortSignal) => Promise<unknown>) | null,
): DiagnosticProbe {
  return {
    dependency: 'payment',
    configured: check !== null,
    check: async (signal) => {
      await check?.(signal);
    },
  };
}

export class ScannerProbeError extends Error {
  override name = 'ScannerProbeError';
}
