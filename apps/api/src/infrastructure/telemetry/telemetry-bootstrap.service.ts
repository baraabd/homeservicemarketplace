import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { runtimeSourceSha } from '../health/health.service';
import { setTraceSampleRatio } from '../logger/pino-http-options';
import { OtlpHttpJsonExporter } from './span-pipeline';
import { TelemetryService } from './telemetry.service';

@Injectable()
export class TelemetryBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly config: AppConfigService,
    private readonly telemetry: TelemetryService,
  ) {}

  onApplicationBootstrap(): void {
    setTraceSampleRatio(this.config.get('OTEL_TRACES_SAMPLER_RATIO'));
    const endpoint = this.config.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
    if (!endpoint) return;
    const headers: Record<string, string> = Object.create(null);
    for (const pair of (this.config.get('OTEL_EXPORTER_OTLP_HEADERS') ?? '').split(',')) {
      if (!pair.trim()) continue;
      const separator = pair.indexOf('=');
      headers[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
    }
    this.telemetry.enableSpanExport(
      new OtlpHttpJsonExporter({
        endpoint,
        serviceName: 'hsm-api',
        serviceVersion: runtimeSourceSha(),
        headers,
      }),
      { maxQueueSize: this.config.get('OTEL_SPAN_QUEUE_MAX') },
    );
  }
}
