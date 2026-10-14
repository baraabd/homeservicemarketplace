import {
  classifyOutboxFailure,
  OutboxDeadlineExceededError,
  OutboxLeaseLostError,
  OutboxPermanentError,
  OutboxTransientError,
  retryAfterHintMs,
} from './outbox.errors';
import { validateHandlerRegistry, type OutboxHandler } from './outbox.handler';

describe('outbox failure classification', () => {
  it('defaults untyped failures to transient (pre-R22 behaviour)', () => {
    expect(classifyOutboxFailure(new Error('boom'))).toBe('transient');
    expect(classifyOutboxFailure('string thrown')).toBe('transient');
    expect(classifyOutboxFailure(undefined)).toBe('transient');
    expect(classifyOutboxFailure(new OutboxDeadlineExceededError(10))).toBe('transient');
  });

  it('recognises permanent, transient and lease-lost failures', () => {
    expect(classifyOutboxFailure(new OutboxPermanentError('bad payload'))).toBe('permanent');
    expect(classifyOutboxFailure(new OutboxTransientError('later', 5_000))).toBe('transient');
    expect(classifyOutboxFailure(new OutboxLeaseLostError('e1'))).toBe('lease-lost');
  });

  it('classifies a permanent error from another module copy by its marker', () => {
    const foreign = Object.assign(new Error('x'), { outboxFailure: 'permanent' });
    expect(classifyOutboxFailure(foreign)).toBe('permanent');
  });

  it('extracts only valid retry-after hints', () => {
    expect(retryAfterHintMs(new OutboxTransientError('x', 2_500))).toBe(2_500);
    expect(retryAfterHintMs(new OutboxTransientError('x'))).toBeUndefined();
    expect(retryAfterHintMs(new OutboxTransientError('x', -1))).toBeUndefined();
    expect(
      retryAfterHintMs(new OutboxTransientError('x', Number.POSITIVE_INFINITY)),
    ).toBeUndefined();
    expect(retryAfterHintMs(null)).toBeUndefined();
  });
});

describe('outbox handler registry validation', () => {
  const h = (name: string, eventTypes: string[]): OutboxHandler => ({
    name,
    eventTypes,
    handle: async () => undefined,
  });

  it('accepts the production naming style', () => {
    expect(
      validateHandlerRegistry([
        h('notification.created.publish.v1', ['notification.created']),
        h('request-available.dispatch', ['request.available']),
        h('evidence-erased.receipt.v1', ['evidence.erased.v1']),
      ]),
    ).toEqual([]);
  });

  it('rejects duplicate names, which would share one idempotency marker', () => {
    const problems = validateHandlerRegistry([h('money.post', ['a']), h('money.post', ['b'])]);
    expect(problems).toEqual(['duplicate handler name "money.post"']);
  });

  it('rejects handlers that consume nothing or list a type twice', () => {
    expect(validateHandlerRegistry([h('empty.handler', [])])).toEqual([
      'handler "empty.handler" consumes no event types',
    ]);
    expect(validateHandlerRegistry([h('twice.handler', ['a', 'a'])])).toEqual([
      'handler "twice.handler" lists an event type twice',
    ]);
  });

  it('rejects names that are not stable low-cardinality keys', () => {
    expect(validateHandlerRegistry([h('Has Spaces', ['a'])])).toHaveLength(1);
    expect(validateHandlerRegistry([h('x'.repeat(81), ['a'])])).toHaveLength(1);
  });
});
