import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('exposes a Prometheus content type', () => {
    const svc = new MetricsService();
    const ct = svc.contentType();
    expect(ct).toMatch(/text\/plain/);
    expect(ct).toMatch(/version=/);
  });

  it('registers the declared http_* series on its private registry', async () => {
    const svc = new MetricsService();
    const out = await svc.metrics();
    expect(out).toContain('# HELP http_requests_total Total HTTP requests');
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('# HELP http_request_duration_seconds HTTP request duration in seconds');
    expect(out).toContain('# TYPE http_request_duration_seconds histogram');
  });

  it('records counter increments that survive into the scrape output', async () => {
    const svc = new MetricsService();
    svc.httpRequestsTotal.inc({ method: 'GET', route: '/x', status: '200' });
    svc.httpRequestsTotal.inc({ method: 'GET', route: '/x', status: '200' });
    const out = await svc.metrics();
    expect(out).toMatch(/http_requests_total\{[^}]*method="GET"[^}]*\} 2/);
  });

  it('emits default Node process metrics after onModuleInit', async () => {
    const svc = new MetricsService();
    svc.onModuleInit();
    const out = await svc.metrics();
    expect(out).toContain('process_cpu_user_seconds_total');
    expect(out).toContain('process_resident_memory_bytes');
  });
});
