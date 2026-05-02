import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import { RealtimeEventsPublisher } from './realtime-events.publisher';

function makeEvent(over: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    v: 1,
    type: 'notification.created',
    userId: 'user-1',
    occurredAt: new Date('2026-05-02T10:00:00Z').toISOString(),
    payload: { hello: 'world' },
    ...over,
  } as RealtimeEvent;
}

describe('RealtimeEventsPublisher', () => {
  it('emits a published event to the user-scoped subscriber', async () => {
    const pub = new RealtimeEventsPublisher();
    const received: RealtimeEvent[] = [];
    const sub = pub.subscribe('user-1').subscribe((e) => received.push(e));

    pub.publish(makeEvent({ userId: 'user-1' }));
    // Synchronous — EventEmitter is sync.
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('notification.created');
    sub.unsubscribe();
  });

  it('does NOT cross-deliver events between users', () => {
    const pub = new RealtimeEventsPublisher();
    const aReceived: RealtimeEvent[] = [];
    const bReceived: RealtimeEvent[] = [];
    pub.subscribe('user-a').subscribe((e) => aReceived.push(e));
    pub.subscribe('user-b').subscribe((e) => bReceived.push(e));

    pub.publish(makeEvent({ userId: 'user-a' }));
    pub.publish(makeEvent({ userId: 'user-b' }));
    pub.publish(makeEvent({ userId: 'user-b' }));

    expect(aReceived).toHaveLength(1);
    expect(bReceived).toHaveLength(2);
  });

  it('publishFor wraps the envelope with v=1 and an ISO occurredAt', () => {
    const pub = new RealtimeEventsPublisher();
    const received: RealtimeEvent[] = [];
    pub.subscribe('user-x').subscribe((e) => received.push(e));

    pub.publishFor('user-x', 'message.created', { id: 'm-1', body: 'hi' });
    expect(received[0]).toMatchObject({
      v: 1,
      type: 'message.created',
      userId: 'user-x',
      payload: { id: 'm-1', body: 'hi' },
    });
    expect(new Date(received[0].occurredAt).toString()).not.toBe('Invalid Date');
  });

  it('teardown removes the listener (no leaks after unsubscribe)', () => {
    const pub = new RealtimeEventsPublisher();
    const received: RealtimeEvent[] = [];
    const sub = pub.subscribe('user-1').subscribe((e) => received.push(e));
    sub.unsubscribe();
    pub.publish(makeEvent({ userId: 'user-1' }));
    expect(received).toHaveLength(0);
  });
});
