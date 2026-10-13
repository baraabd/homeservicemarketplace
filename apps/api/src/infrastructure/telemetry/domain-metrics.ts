import { Counter, Gauge, Histogram, type Registry } from 'prom-client';

import { EnumLabel, OVERFLOW_LABEL } from './label-bounds';

// R23 — the extension interface for domain instrumentation.
//
// Later sprints (R29–R34: booking, notification, mail, scanning, payment,
// support) add their own metrics through MetricsService.domainCounter /
// domainGauge / domainHistogram, without editing the telemetry module. The
// rules enforced here are what keep their metrics cheap and private:
//
//   name    `<domain>_<what>[_<unit>]`, snake_case, unit suffix per
//           Prometheus conventions (`_total` for counters, `_seconds`,
//           `_bytes`, `_unixtime`, `_ratio`). Prefixes owned by the platform
//           (http_, dependency_, background_job_, telemetry_, process_,
//           nodejs_) are reserved.
//   labels  every label declares its complete value set up front. A value not
//           in the set is recorded as `other` and counted in
//           telemetry_label_overflow_total — so a user id, an email or a free
//           text reason cannot become a label by accident.
//
// Recording never throws into the caller. A broken metric is a telemetry
// incident, not a failed booking.

export interface DomainMetricSpec<L extends string> {
  /** e.g. `notification`, `payment`. Lower-case letters and digits. */
  domain: string;
  /** Full metric name; must start with `${domain}_`. */
  name: string;
  help: string;
  /** Label name → complete set of allowed values. */
  labels?: Readonly<Record<L, readonly string[]>>;
}

const DOMAIN = /^[a-z][a-z0-9]{1,23}$/u;
const METRIC_NAME = /^[a-z][a-z0-9_]{2,79}$/u;
const LABEL_NAME = /^[a-z][a-z0-9_]{0,39}$/u;
const RESERVED_PREFIXES = [
  'http_',
  'dependency_',
  'background_job_',
  'telemetry_',
  'process_',
  'nodejs_',
  'outbox_',
];
const MAX_LABELS = 4;
const MAX_VALUES_PER_LABEL = 64;

export class DomainMetricSpecError extends Error {}

function validate<L extends string>(
  spec: DomainMetricSpec<L>,
  kind: 'counter' | 'gauge' | 'histogram',
) {
  if (!DOMAIN.test(spec.domain)) throw new DomainMetricSpecError(`invalid domain "${spec.domain}"`);
  if (!METRIC_NAME.test(spec.name) || !spec.name.startsWith(`${spec.domain}_`)) {
    throw new DomainMetricSpecError(
      `metric "${spec.name}" must be snake_case and start with "${spec.domain}_"`,
    );
  }
  if (RESERVED_PREFIXES.some((p) => spec.name.startsWith(p))) {
    throw new DomainMetricSpecError(`metric "${spec.name}" uses a reserved prefix`);
  }
  if (kind === 'counter' && !spec.name.endsWith('_total')) {
    throw new DomainMetricSpecError(`counter "${spec.name}" must end with _total`);
  }
  if (kind !== 'counter' && spec.name.endsWith('_total')) {
    throw new DomainMetricSpecError(`only counters may end with _total ("${spec.name}")`);
  }
  if (!spec.help.trim()) throw new DomainMetricSpecError(`metric "${spec.name}" needs help text`);
  const labels = Object.entries(spec.labels ?? {}) as [string, readonly string[]][];
  if (labels.length > MAX_LABELS) {
    throw new DomainMetricSpecError(
      `metric "${spec.name}" declares more than ${MAX_LABELS} labels`,
    );
  }
  for (const [name, values] of labels) {
    if (!LABEL_NAME.test(name)) throw new DomainMetricSpecError(`invalid label "${name}"`);
    if (values.length === 0 || values.length > MAX_VALUES_PER_LABEL) {
      throw new DomainMetricSpecError(
        `label "${name}" must declare 1–${MAX_VALUES_PER_LABEL} values`,
      );
    }
    if (values.includes(OVERFLOW_LABEL)) {
      throw new DomainMetricSpecError(
        `label "${name}" must not declare the reserved value "other"`,
      );
    }
  }
}

type LabelInput<L extends string> = Partial<Record<L, string>>;

function boundLabels<L extends string>(spec: DomainMetricSpec<L>, overflow: Counter<'metric'>) {
  const guards = Object.entries(spec.labels ?? {}).map(
    ([name, values]) => [name, new EnumLabel(values as readonly string[])] as const,
  );
  return (input: LabelInput<L> = {}): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, guard] of guards) {
      const raw = (input as Record<string, string | undefined>)[name];
      const v = guard.value(raw);
      if (v === OVERFLOW_LABEL) overflow.inc({ metric: spec.name });
      out[name] = v;
    }
    return out;
  };
}

function guarded(fn: () => void): void {
  try {
    fn();
  } catch {
    // See header: recording never throws into the caller.
  }
}

function existing(registry: Registry, name: string) {
  return registry.getSingleMetric(name);
}

export interface DomainCounter<L extends string> {
  inc(labels?: LabelInput<L>, value?: number): void;
}

export interface DomainGauge<L extends string> {
  set(labels: LabelInput<L>, value: number): void;
}

export interface DomainHistogram<L extends string> {
  observe(labels: LabelInput<L>, value: number): void;
}

export function defineDomainCounter<L extends string>(
  registry: Registry,
  spec: DomainMetricSpec<L>,
  overflow: Counter<'metric'>,
): DomainCounter<L> {
  validate(spec, 'counter');
  if (existing(registry, spec.name))
    throw new DomainMetricSpecError(`"${spec.name}" already registered`);
  const metric = new Counter({
    name: spec.name,
    help: spec.help,
    labelNames: Object.keys(spec.labels ?? {}),
    registers: [registry],
  });
  const bind = boundLabels(spec, overflow);
  return {
    inc: (labels, value = 1) =>
      guarded(() => {
        if (Number.isFinite(value) && value >= 0) metric.inc(bind(labels), value);
      }),
  };
}

export function defineDomainGauge<L extends string>(
  registry: Registry,
  spec: DomainMetricSpec<L>,
  overflow: Counter<'metric'>,
): DomainGauge<L> {
  validate(spec, 'gauge');
  if (existing(registry, spec.name))
    throw new DomainMetricSpecError(`"${spec.name}" already registered`);
  const metric = new Gauge({
    name: spec.name,
    help: spec.help,
    labelNames: Object.keys(spec.labels ?? {}),
    registers: [registry],
  });
  const bind = boundLabels(spec, overflow);
  return {
    set: (labels, value) =>
      guarded(() => {
        if (Number.isFinite(value)) metric.set(bind(labels), value);
      }),
  };
}

export function defineDomainHistogram<L extends string>(
  registry: Registry,
  spec: DomainMetricSpec<L> & { buckets: readonly number[] },
  overflow: Counter<'metric'>,
): DomainHistogram<L> {
  validate(spec, 'histogram');
  if (existing(registry, spec.name))
    throw new DomainMetricSpecError(`"${spec.name}" already registered`);
  if (spec.buckets.length === 0 || spec.buckets.length > 20) {
    throw new DomainMetricSpecError(`histogram "${spec.name}" needs 1–20 buckets`);
  }
  const metric = new Histogram({
    name: spec.name,
    help: spec.help,
    labelNames: Object.keys(spec.labels ?? {}),
    buckets: [...spec.buckets],
    registers: [registry],
  });
  const bind = boundLabels(spec, overflow);
  return {
    observe: (labels, value) =>
      guarded(() => {
        if (Number.isFinite(value)) metric.observe(bind(labels), value);
      }),
  };
}
